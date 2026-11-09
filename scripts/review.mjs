// scripts/review.mjs
//
// Pre-reply check ("prove your work", see memory/review/README.md).
// Run from the repo root: node scripts/review.mjs
// Exits 1 if anything is wrong. Checks:
//   1. every .js/.jsx under app/, lib/, scripts/ parses
//   2. every named import from a relative file really exists there
//   3. no computeSignals call is handed bare DEFAULT_TH (must use thresholdsFor)
//   4. the one-copy rules that have drifted before
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { createRequire } from "module";

const root = process.cwd();
const problems = [];
const fail = (f, m) => problems.push(`${path.relative(root, f)}: ${m}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "out"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : /\.(m?js|jsx)$/.test(e.name) && out.push(p);
  }
  return out;
}

function loadBabel() {
  const tmp = path.join(os.tmpdir(), "setpoint-review-babel");
  const req = createRequire(path.join(tmp, "x.js"));
  try { return req("@babel/parser"); } catch { /* install below */ }
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), "{}");
  execSync("npm i @babel/parser --silent --no-audit --no-fund", { cwd: tmp, stdio: "ignore" });
  return req("@babel/parser");
}

const files = ["app", "lib", "scripts"].filter((d) => fs.existsSync(path.join(root, d))).flatMap((d) => walk(path.join(root, d)));
const babel = loadBabel();
const src = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  src.set(f, text);
  try { babel.parse(text, { sourceType: "module", plugins: ["jsx"] }); } catch (e) { fail(f, `does not parse: ${e.message}`); }
}

// exports of a file
const exportsOf = new Map();
function exportsFor(f) {
  if (exportsOf.has(f)) return exportsOf.get(f);
  const t = src.get(f) || "";
  const names = new Set();
  for (const m of t.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of t.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  if (/export\s+default/.test(t)) names.add("default");
  exportsOf.set(f, names);
  return names;
}
function resolveRel(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + ".js", base + ".jsx", path.join(base, "index.js")]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}
for (const [f, t] of src) {
  for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = resolveRel(f, m[2]);
    if (!target) { fail(f, `imports from missing file ${m[2]}`); continue; }
    if (!src.has(target)) continue; // not a JS file we track
    const have = exportsFor(target);
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && !have.has(name)) fail(f, `imports "${name}" but ${path.relative(root, target)} does not export it`);
    }
  }
  // drift trap: bare DEFAULT_TH handed to computeSignals
  for (const m of t.matchAll(/computeSignals\s*\(([^)]*)\)/g)) {
    if (/\bDEFAULT_TH\b/.test(m[1]) && !/thresholdsFor/.test(m[1])) fail(f, "computeSignals called with bare DEFAULT_TH, use thresholdsFor(tfKey) so the move-size rule matches live");
  }
}

// The Market Meter sentence must agree with the numbers next to it (lib/meter.js, added Nov 6).
{
  const { checkMeter } = await import(new URL("../lib/meter.js", import.meta.url));
  const LAB = { "sideways-ranging": "No real direction yet", "bullish-trending": "Real uptrend, room left to run", "bearish-trending": "Real downtrend, room left to fall", "high-volatility": "Sharp swings", "low-volatility": "Quiet" };
  let bad = 0, n = 0;
  for (const stage of Object.keys(LAB)) for (const w1 of [-12, -5, -2, -1.7, -0.6, -0.5, -0.4, 0, 0.5, 1.7, 8]) for (const h24 of [-6, -1.4, -0.2, 0.3, 1.5, 4]) for (const vs50 of [-12, -7.4, -0.5, 0.5, 6]) for (const dd7 of [0, -4.9, -5, -9]) {
    n++;
    for (const e of checkMeter({ stage, phase: "building", level: 3, label: LAB[stage] }, { h1: 0.1, h24, w1, vs50, dd7, hiDay: "Wednesday", hiAgo: 3, hi7: 81100 })) { if (bad++ < 5) problems.push("meter: " + e); }
  }
  if (bad > 5) problems.push(`meter: ${bad} disagreements between headline and numbers in ${n} cases`);
}

// Freshness (v22.7): the meter must name a flush that just happened, and stay silent when there was none. Independent of lib/meter.js:
// the flush is built by hand here, and the expected sentence parts are written out, not read from the module's constants.
{
  const { meterMovesFrom, meterFreshLine, checkMeter } = await import(new URL("../lib/meter.js", import.meta.url));
  const flat = () => Array.from({ length: 200 }, (_, i) => ({ time: i * 3600e3, open: 75000, high: 75100, low: 74900, close: 75000 }));
  const withFlush = (ago, lowPx = 73000) => { const cs = flat(); const j = 199 - ago; cs[j] = { time: j * 3600e3, open: 75000, high: 75050, low: lowPx, close: 74000 }; for (let i = j + 1; i < 200; i++) cs[i] = { time: i * 3600e3, open: 74000, high: 74300, low: 73900, close: 74200 }; return cs; };
  for (const ago of [0, 1, 3, 6]) {
    const line = meterFreshLine(meterMovesFrom(withFlush(ago)));
    if (!line) problems.push(`meter freshness: a flush ${ago} hours ago is not named`);
    else if (!line.includes("$73,000") || !line.includes("48-hour low")) problems.push(`meter freshness: line misses the low or the 48-hour wording: ${line}`);
  }
  for (const ago of [7, 20]) if (meterFreshLine(meterMovesFrom(withFlush(ago)))) problems.push(`meter freshness: a flush ${ago} hours ago is still named`);
  if (meterFreshLine(meterMovesFrom(withFlush(1, 73900)))) problems.push("meter freshness: a 1.5% dip was called a flush");
  const old = withFlush(2); old[150].low = 72000; if (meterFreshLine(meterMovesFrom(old))) problems.push("meter freshness: a drop that did not break the 48-hour low was called new");
  const m = { stage: "bearish-trending", phase: "building", level: 3, label: "Real downtrend, room left to fall" };
  for (const e of checkMeter(m, { ...meterMovesFrom(withFlush(2)), vs50: -5 })) problems.push("meter freshness: " + e);
}

// Swing Rider (v22.8): the 4 hour chart belongs to it with a 3R target; every other chart stays Trend Rider at 0.75R. No chart may belong to both.
{
  const T = await import(new URL("../lib/trend.js", import.meta.url));
  const S = await import(new URL("../lib/signals.js", import.meta.url));
  if (T.riderFor("4h") !== "Swing Rider") problems.push("swing: 4h is not Swing Rider");
  for (const tf of ["1h", "30m", "15m", "5m", "1m"]) if (T.riderFor(tf) !== "Trend Rider") problems.push(`swing: ${tf} is not Trend Rider`);
  const own = (n) => S.ALL_SIGNALS.find((x) => x.name === n)?.tfs || [];
  if (own("Trend Rider").includes("4h") || own("Swing Rider").join() !== "4h") problems.push("swing: Trend Rider and Swing Rider overlap or Swing Rider lacks 4h");
  if (!S.VISIBLE_SIGNALS.includes("Swing Rider")) problems.push("swing: not in VISIBLE_SIGNALS");
  // hand-built breakout: flat bars, then a rise; target must be 3x the risk on 4h and 0.75x on 1h
  const mk = (sec) => { const b = []; for (let i = 0; i < 400; i++) { const p = 100 + i * 0.5; b.push({ time: i * sec * 1000, open: p, high: p + 1, low: p - 1, close: p + 0.5, vol: 1 }); } return b; };
  for (const [tf, want] of [["4h", 3], ["1h", 0.75]]) {
    const cfg = { ...T.TREND_TFS[tf], htf: [], buyConfirm: false, sellConfirm: false };
    const B = mk(cfg.baseSec), pre = T.precompute(B), i = 350, f = B[i + 1];
    const a = T.analyze(cfg, B, pre, i, { time: f.time, open: f.open, high: f.high + 50, low: f.low, close: f.open }, { sma: 50, htf: null });
    const e = a?.bull;
    if (!e || !e.touched) { problems.push(`swing: ${tf} test breakout did not touch`); continue; }
    const k = (e.target - e.entry) / (e.entry - e.stop);
    if (Math.abs(k - want) > 1e-9) problems.push(`swing: ${tf} target is ${k}R, wanted ${want}R`);
  }
}

// Flush Rider (lib/flush.js): the live detector must agree with the plain-English rules (v22.7). Built by hand, numbers written out.
{
  const { flushFires, FLUSH_MIN_RISK_PCT } = await import(new URL("../lib/flush.js", import.meta.url));
  const H = 3600e3, now = 300 * H;
  const bars = Array.from({ length: 100 }, (_, i) => ({ time: i * H, open: 100, high: 100.4, low: 99.6, close: 100 }));
  const atr = bars.map(() => 1.0);
  const flush = (arr) => { arr[80] = { time: 80 * H, open: 100, high: 100, low: 96, close: 97 }; return arr; }; // 4% drop, breaks the 48h low
  const fires = (arr, forming) => flushFires(arr, forming, atr, now, 1e12, H);
  // 1. a retest that touches the entry fills; entry 96.25, stop 95.25, target 99.25
  const b1 = flush(bars.map((b) => ({ ...b }))); for (let i = 81; i < 100; i++) b1[i] = { time: i * H, open: 98, high: 98.5, low: 97.5, close: 98 }; b1[90] = { time: 90 * H, open: 98, high: 98, low: 96.2, close: 97 };
  const f1 = fires(b1.slice(0, 99), b1[99]);
  if (f1.length !== 1 || Math.abs(f1[0].entry - 96.25) > 1e-9 || Math.abs(f1[0].stop - 95.25) > 1e-9 || Math.abs(f1[0].target - 99.25) > 1e-9) problems.push("flush: retest did not give entry 96.25 / stop 95.25 / target 99.25: " + JSON.stringify(f1));
  // 2. price never comes back: no trade
  const b2 = flush(bars.map((b) => ({ ...b }))); for (let i = 81; i < 100; i++) b2[i] = { time: i * H, open: 98, high: 98.5, low: 97.5, close: 98 };
  if (fires(b2.slice(0, 99), b2[99]).length) problems.push("flush: filled with no retest");
  // 3. stop breaks first: no trade
  const b3 = flush(bars.map((b) => ({ ...b }))); for (let i = 81; i < 100; i++) b3[i] = { time: i * H, open: 98, high: 98.5, low: 97.5, close: 98 }; b3[82] = { time: 82 * H, open: 97, high: 97, low: 95, close: 95.5 }; b3[90] = { time: 90 * H, open: 98, high: 98, low: 96.2, close: 97 };
  if (fires(b3.slice(0, 99), b3[99]).length) problems.push("flush: filled after the stop broke");
  // 4. only 1.9% drop: not a flush
  const b4 = bars.map((b) => ({ ...b })); b4[80] = { time: 80 * H, open: 100, high: 100, low: 98.1, close: 99 }; b4[90] = { time: 90 * H, open: 99, high: 99, low: 98.2, close: 99 };
  if (fires(b4.slice(0, 99), b4[99]).length) problems.push("flush: a 1.9% drop counted");
  // 5. tiny stop (risk under 0.6% of price): skipped
  const tiny = flushFires(flush(bars.map((b) => ({ ...b }))).slice(0, 99), null, bars.map(() => 0.3), now, 1e12, H);
  if (tiny.length) problems.push(`flush: a stop under ${FLUSH_MIN_RISK_PCT}% was not skipped`);
  // 6. an old fill is never backfilled
  if (flushFires(b1.slice(0, 99), b1[99], atr, now, 1 * H, H).length) problems.push("flush: an old fill was backfilled");
}

if (problems.length) {
  console.error(`REVIEW FAILED (${problems.length})\n` + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log(`review ok: ${files.length} files parse, imports resolve, no drift traps.`);
