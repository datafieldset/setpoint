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

// Meter headline, spike-then-drop form (v22.9, Na's wording): hand-built hourly candles, numbers written out.
{
  const { meterMovesFrom, meterHeadline, checkMeter } = await import(new URL("../lib/meter.js", import.meta.url));
  const H = 3600e3, t0 = Date.parse("2026-11-01T00:00:00Z"); // 200 bars end Nov 9 07:00 UTC = Nov 8 evening in Honolulu
  const m = { stage: "sideways-ranging", phase: "building", level: 3, label: "x" };
  // path: flat 100,000 to bar 110, run to 110,000 at bar 130 (the high), fall to `lowPx` at bar `lowAt`, then drift to `endPx` by the last bar
  const series = (lowPx, lowAt, endPx) => {
    const px = [];
    for (let i = 0; i < 200; i++) {
      let v;
      if (i < 110) v = 100000; else if (i <= 130) v = 100000 + (i - 110) * 500; else if (i <= lowAt) v = 110000 + (lowPx - 110000) * ((i - 130) / (lowAt - 130)); else v = lowPx + (endPx - lowPx) * ((i - lowAt) / (199 - lowAt));
      px.push(v);
    }
    return px.map((v, i) => ({ time: t0 + i * H, open: v, close: v, high: v + (i === 130 ? 10 : 0), low: v - 0 }));
  };
  const run = (name, cs, want, mustNot = []) => {
    const mv = { ...meterMovesFrom(cs), vs50: -5 };
    const h = meterHeadline(m, mv);
    for (const w of want) if (!h.includes(w)) problems.push(`meter spike: ${name}: wanted "${w}" in: ${h}`);
    for (const w of mustNot) if (h.includes(w)) problems.push(`meter spike: ${name}: did not want "${w}" in: ${h}`);
    for (const e of checkMeter(m, mv)) problems.push(`meter spike: ${name}: ${e}`);
  };
  // low at bar 195 (today in Honolulu), price back up to 97 from 95 (+2.1%), under where the run started (100)
  run("gave it all back", series(95000, 195, 97000), ["spiked to $110,000 on", "gave it all back, down 11.8% from the peak", "Today it dropped to $95,000 and has since bounced 2.1% off the low"]);
  // price ends at 101, above where the run started: no "gave it all back"
  run("not all back", series(95000, 195, 101000), ["then fell 8.2%", "has since bounced 6.3% off the low"], ["gave it all back"]);
  // price still at the low
  run("near the low", series(95000, 195, 95100), ["is still sitting near the low"], ["bounced"]);
  // low two days earlier: weekday name
  run("older low", series(95000, 120 + 25, 97000), ["it dropped to $95,000"], ["Today it dropped"]);
  // low BEFORE the high: old wording stays
    const pre = []; for (let i = 0; i < 200; i++) { const v = i < 20 ? 100000 : i < 60 ? 90000 : i < 130 ? 90000 + (i - 60) * (20000 / 70) : 110000 - (i - 130) * (14000 / 69); pre.push({ time: t0 + i * H, open: v, close: v, high: v, low: v }); }
  run("low before high", pre, ["Bitcoin hit its high of"], ["dropped to"]);
  // v23.5: the same spike and drop, but the high is now 5 days old: no story, no weekday, no old price. The headline describes the week only.
  const old = series(95000, 195, 97000); for (let i = 200; i < 248; i++) old.push({ time: t0 + i * H, open: 97000, close: 97000, high: 97000, low: 97000 });
  run("old high", old, ["Bitcoin $97,000,"], ["spiked", "$110,000", "gave it all back", "dropped to", "hit its high of", "Bitcoin is"]);
  // exactly 3 days old still tells the story (the base series ends 3 days after its high)
  // v24.4 (Na's wording): a quiet or sideways short term is replaced by where price sits in the last 24 hours, with the price up front.
  // Week: 100,000 flat for 140 bars, then a down week to 94,000; the last 24 bars wander so we can set where price ends inside them.
  const day = (endPx, loPx, hiPx) => { const cs = []; for (let i = 0; i < 200; i++) { const v = i < 160 ? 100000 : 100000 - (i - 160) * 100; cs.push({ time: t0 + i * H, open: v, close: v, high: v, low: v }); }
    for (let i = 176; i < 200; i++) { const b = cs[i]; b.open = 96000; b.close = 96000; b.high = 96000; b.low = 96000; }
    cs[180] = { ...cs[180], high: hiPx, low: hiPx, open: hiPx, close: hiPx }; cs[190] = { ...cs[190], high: loPx, low: loPx, open: loPx, close: loPx }; cs[199] = { ...cs[199], open: endPx, close: endPx, high: endPx, low: endPx }; return cs; };
  const wk = (cs) => ({ ...meterMovesFrom(cs), vs50: -5 });
  const lowDay = day(94300, 94000, 98000), midDay = day(96000, 94000, 98000), topDay = day(97800, 94000, 98000), flatDay = day(96000, 95800, 96100);
  const rr = (name, cs, want, mustNot = []) => { const mv = wk(cs); const h = meterHeadline(m, mv); for (const w of want) if (!h.includes(w)) problems.push(`meter range: ${name}: wanted "${w}" in: ${h}`); for (const w of mustNot) if (h.includes(w)) problems.push(`meter range: ${name}: did not want "${w}" in: ${h}`); for (const e of checkMeter(m, mv)) problems.push(`meter range: ${name}: ${e}`); };
  rr("bottom", lowDay, ["Bitcoin $94,300, down", "still near the bottom of today's range, low $94,000."], ["short term", "moving sideways"]);
  rr("middle", midDay, ["Bitcoin $96,000, down", "in the middle of today's range."], ["short term", "near the bottom"]);
  rr("top", topDay, ["near the top of today's range, high $98,000."], ["still near the top", "short term"]); // a down week, so no "still"
  rr("tiny range", flatDay, ["short term it's moving sideways"], ["today's range"]);   // 0.3% range: no position, old wording
  for (const stage of ["bearish-trending", "high-volatility", "bullish-trending", "low-volatility"]) { // v24.5: every short-term read ends with the range line
    const mv = wk(lowDay); const st = { stage, phase: "building", level: 3, label: "x" }; const h = meterHeadline(st, mv);
    if (!h.endsWith("still near the bottom of today's range, low $94,000.") || h.includes("short term")) problems.push(`meter range: ${stage} should end with the range line: ` + h);
    for (const e of checkMeter(st, mv)) problems.push(`meter range: ${stage}: ${e}`);
  }
  { // an up week near the top says "still"; hand-set numbers
    const mv = { h1: 0, h24: 0.2, w1: 5, dd7: -0.5, hiDay: "Monday", hiAgo: 1, hi7: 100500, hiAt: 0, lo7: 95000, loAt: 0, loAgo: 6, loDay: "Friday", runStart: 95000, px: 100000, hi24: 100500, lo24: 98000, vs50: 3, fresh: null };
    const h = meterHeadline(m, mv);
    if (!h.includes("Bitcoin $100,000, up 5% this week and holding above its 50-day, still near the top of today's range, high $100,500.")) problems.push("meter range: up-week wording: " + h);
    for (const e of checkMeter(m, mv)) problems.push("meter range: up-week: " + e);
  }
}

// "How close is an alert" (v23.9): the meter section reads the signals' own rules and uses the customer-facing names.
{
  const R = await import(new URL("../lib/readiness.js", import.meta.url));
  const S = await import(new URL("../lib/signals.js", import.meta.url));
  const T = await import(new URL("../lib/trend.js", import.meta.url));
  const { brandName } = await import(new URL("../lib/brand.js", import.meta.url));
  if (brandName("Swing Rider") !== "Trend" || brandName("Flush Rider") !== "Bounce") problems.push("ready: Swing Rider and Flush Rider should show as Trend and Bounce");
  const live = S.ALL_SIGNALS.filter((x) => S.isSignalVisible(x.name));
  for (const x of live) if (!x.ready || !R.READY[x.ready]) problems.push(`ready: live signal ${x.name} has no readiness kind (add ready: to its ALL_SIGNALS entry, or a function to READY)`);
  const swing = S.ALL_SIGNALS.find((x) => x.name === "Swing Rider"), flush = S.ALL_SIGNALS.find((x) => x.name === "Flush Rider");
  const H4 = 14400e3, H1 = 3600e3;
  // steady climb on 4h: every check met when the 200-day sits 10% under price
  const up = []; for (let i = 0; i < 120; i++) { const p = 100 + i * 0.5; up.push({ time: i * H4, open: p, high: p + 1, low: p - 1, close: p + 0.5 }); }
  const now4 = 120 * H4 + 1000, last = up[119].close;
  const all = R.signalReadiness(swing, { candles: up, sma: last / 1.1, now: now4, open: false });
  if (!all || all.badge !== "Ready" || all.lines.filter((l) => l.ok === true).length !== 4) problems.push("ready: a strong uptrend should read Ready with 4 met checks: " + JSON.stringify(all));
  const under = R.signalReadiness(swing, { candles: up, sma: last * 1.05, now: now4, open: false });
  if (!under || under.badge !== "3 of 4 met" || !under.lines.at(-1).text.startsWith("Waiting: price needs to get back above its 200-day line (now 4.8% under)")) problems.push("ready: under the 200-day should read 3 of 4 with the waiting line last: " + JSON.stringify(under));
  const far = R.signalReadiness(swing, { candles: up, sma: last / 1.3, now: now4, open: false });
  if (!far || far.badge !== "3 of 4 met" || !far.lines.at(-1).text.includes("stretched too far")) problems.push("ready: 30% above the 200-day should wait on the stretch check: " + JSON.stringify(far));
  if (R.signalReadiness(swing, { candles: up, sma: last, now: now4, open: true })?.badge !== "Alert open") problems.push("ready: an open trade should read Alert open");
  if (R.signalReadiness(swing, { candles: up.slice(0, 10), sma: last, now: now4, open: false }) !== null) problems.push("ready: too few candles should return nothing, not a guess");
  if (T.TREND_TFS["4h"].noStretch) problems.push("ready: test assumes the stretch check is on");
  // flat 1h market at 100: quiet, names the 2-day low (99) and the distance (1.0%)
  const flat = []; for (let i = 0; i < 100; i++) flat.push({ time: i * H1, open: 100, high: 100.5, low: 99, close: 100 });
  const q = R.signalReadiness(flush, { candles: flat, now: 100 * H1 + 1000, open: false });
  if (!q || q.badge !== "Quiet" || !q.lines[0].text.includes("2-day low ($99, 1.0% below price)")) problems.push("ready: a flat market should read Quiet with the 2-day low: " + JSON.stringify(q));
  // a flush 3 bars ago (open 100, low 96, close 98), price since at 98: the buy is armed just above 96
  const fl = flat.map((b) => ({ ...b })); fl[96] = { time: 96 * H1, open: 100, high: 100, low: 96, close: 98 }; for (const k of [97, 98, 99]) fl[k] = { time: k * H1, open: 98, high: 98.5, low: 97.6, close: 98 };
  const ar = R.signalReadiness(flush, { candles: fl, now: 100 * H1 + 1000, open: false });
  if (!ar || ar.badge !== "Armed" || !ar.lines[0].text.includes("a sharp drop hit $96")) problems.push("ready: a fresh flush that has not been retested should read Armed: " + JSON.stringify(ar));
  // the same flush, but price already came back to the buy level: no longer armed (it is an open alert by then)
  const fd = fl.map((b) => ({ ...b })); fd[98] = { ...fd[98], low: 96.05 };
  if (R.signalReadiness(flush, { candles: fd, now: 100 * H1 + 1000, open: false })?.badge === "Armed") problems.push("ready: a flush that already filled should not read Armed");
}

// The Market Meter's share image (v24.7): lib/meterCard.js builds every word and number on it from the same code the meter reads.
{
  const { buildMeterCard } = await import(new URL("../lib/meterCard.js", import.meta.url));
  const H = 3600e3, t0 = Date.parse("2026-11-01T00:00:00Z");
  const fall = []; for (let i = 0; i < 200; i++) { const p = 100000 - i * 60; fall.push({ time: t0 + i * H, open: p, close: p, high: p + 20, low: p - 20 }); } // ends 88,060
  const weekly = { daily50: 95000, daily200: 90000, sma: 70000 };
  const c = buildMeterCard({ candles1h: fall, candles5m: null, weekly, fng: { value: 28, label: "Fear" }, now: Date.parse("2026-11-12T20:14:00Z") });
  const bad = (msg) => problems.push("share card: " + msg);
  if (!c) bad("returned nothing for good data");
  else {
    if (c.verdict !== "BEARISH" || c.bull) bad("price under the 50-day should read BEARISH");
    if (c.price !== "$88,060") bad("price should be $88,060, got " + c.price);
    if (!c.sentence.startsWith("Down ") || !c.sentence.includes("still below its 50-day") || !c.sentence.endsWith("near the bottom of today's range, low $88,040.") || c.sentence.includes("$88,060,")) bad("sentence: " + c.sentence);
    if (c.ladder.map((r) => r.name).join("|") !== "50-day|200-day|Current price|200-week") bad("ladder order: " + c.ladder.map((r) => r.name).join("|"));
    if (c.ladder[0].note !== "+7.9% to break" || c.ladder[1].note !== "+2.2% to reach" || c.ladder[3].note !== "+25.8% above") bad("ladder notes: " + c.ladder.map((r) => r.note).join(" | "));
    if (c.range.note !== "Near the low" || c.range.low !== "$88,040" || !(c.range.at >= 0 && c.range.at <= 0.25)) bad("range: " + JSON.stringify(c.range));
    if (c.moves.map((x) => x.k).join("|") !== "1h|1 day|1 week" || c.moves.some((x) => x.up !== false)) bad("moves: " + JSON.stringify(c.moves));
    if (!c.goldenCross || c.fng?.value !== 28) bad("golden cross or Fear & Greed wrong");
    if (c.flip.pre !== "Below the 200-day (" || c.flip.hi !== "$90,000" || c.flip.tone !== "red" || c.ladder.filter((r) => r.hi).map((r) => r.name).join() !== "200-day") bad("highlight should be the closest line (200-day, 2.2% under, red): " + JSON.stringify(c.flip));
    if (c.stamp !== "Nov 12, 10:14 AM HST") bad("time stamp (Honolulu): " + c.stamp);
    if (/Rider|Trend|Bounce|alert/i.test(JSON.stringify(c).replace(/Alerts?\b/g, "").replace(/Bitcoin trend/gi, ""))) bad("the card must not name our signals");
  }
  const up = fall.map((b, i) => { const p = 80000 + i * 60; return { ...b, open: p, close: p, high: p + 20, low: p - 20 }; }); // ends 91,940, above the 50-day
  const u = buildMeterCard({ candles1h: up, candles5m: null, weekly: { daily50: 90000, daily200: 85000, sma: 70000 }, fng: null, now: Date.now() });
  if (!u || u.verdict !== "BULLISH" || !u.flip.pre.startsWith("Above the 50-day (") || u.fng !== null) bad("price over the 50-day should read BULLISH with the stay-above line and no Fear & Greed when missing");
  // v24.8: the highlighted line follows the closest line, however far (v24.9) and its colour says danger or opportunity.
  const hl = (w) => { const r = buildMeterCard({ candles1h: fall, candles5m: null, weekly: w, fng: null }); const h = r && r.ladder.find((x) => x.hi); return r && h ? { line: h.name, tone: h.tone, flip: r.flip, hiCount: r.ladder.filter((x) => x.hi).length } : null; };
  const cases = [
    [{ daily50: 130000, daily200: 120000, sma: 87500 }, "200-week", "amber", "Holding above the 200-week ("],   // 0.6% above: being tested from above
    [{ daily50: 130000, daily200: 88500, sma: 60000 }, "200-day", "amber", "A close back above the 200-day ("],   // 0.5% below: being tested from below
    [{ daily50: 130000, daily200: 120000, sma: 85000 }, "200-week", "green", "Above the 200-week ("],             // 3.6% above: cushion
    [{ daily50: 91000, daily200: 120000, sma: 60000 }, "50-day", "red", "Flip the story with a daily close above"], // 3.2% below, within 5%, red
    [{ daily50: 100000, daily200: 120000, sma: 60000 }, "50-day", "red", "Flip the story with a daily close above"], // 11.9% below, still the closest
    [{ daily50: 130000, daily200: 100000, sma: 60000 }, "200-day", "red", "Below the 200-day ("],   // 11.9% below the 200-day, no 5% cutoff any more
    [{ daily50: 130000, daily200: 110000, sma: 94500 }, "200-week", "red", "Below the 200-week ("],  // 6.8% below the 200-week (Nov 14 case): not the far 50-day
  ];
  for (const [w, line, tone, text] of cases) {
    const r = hl(w);
    const want = text;
    if (!r || r.line !== line || r.tone !== tone || r.hiCount !== 1 || !r.flip.pre.startsWith(want) || r.flip.tone !== tone) bad("highlight " + JSON.stringify(w) + " expected " + line + " " + tone + " '" + want + "', got " + JSON.stringify(r));
  }
  if (buildMeterCard({ candles1h: fall.slice(0, 50), candles5m: null, weekly, fng: null }) !== null) bad("too few candles should return nothing, not a guess");
  if (buildMeterCard({ candles1h: fall, candles5m: null, weekly: null, fng: null }) !== null) bad("missing averages should return nothing, not a guess");
}

// Swing Rider and retirements (v23.4): the 4 hour chart is Swing Rider, entered at the open of a new bar when the trend checks pass (no breakout),
// target 3 times the stop distance. Trend Rider (every other chart) and Rebound Rider are retired: no entries in ALL_SIGNALS, no charts scanned.
{
  const T = await import(new URL("../lib/trend.js", import.meta.url));
  const S = await import(new URL("../lib/signals.js", import.meta.url));
  const RB = await import(new URL("../lib/rebound.js", import.meta.url));
  if (T.riderFor("4h") !== "Swing Rider" || T.tfsFor("Swing Rider").join() !== "4h") problems.push("swing: 4h is not Swing Rider");
  if (T.tfsFor("Trend Rider").length) problems.push("retire: Trend Rider still owns a chart");
  for (const tf of ["1h", "30m", "15m", "5m", "1m"]) if (!T.TREND_TFS[tf].retired) problems.push(`retire: ${tf} is not retired`);
  if (T.TREND_TFS["4h"].retired) problems.push("retire: the 4 hour chart must not be retired");
  if (RB.REBOUND_TFS.length) problems.push("retire: Rebound Rider still scans a chart");
  for (const n of ["Trend Rider", "Rebound Rider"]) if (S.ALL_SIGNALS.some((x) => x.name === n) || S.VISIBLE_SIGNALS.includes(n) || S.isSignalVisible(n)) problems.push(`retire: ${n} is still listed or visible`);
  if (S.RETIRED_SIGNALS.join() !== "Trend Rider,Rebound Rider") problems.push("retire: RETIRED_SIGNALS should list Trend Rider and Rebound Rider");
  if (S.RETIRED_SIGNALS.some((n) => S.PUBLIC_TESTING.includes(n))) problems.push("retire: a retired signal is still a public test");
  if (S.VISIBLE_SIGNALS.join() !== "Swing Rider,Flush Rider,Flow Rider,Calm Rider") problems.push("retire: VISIBLE_SIGNALS should be Swing Rider, Flush Rider, Flow Rider and Calm Rider");
  // hand-built steady climb (every bar up, so RSI and ADX are high). Last finished bar closes near 275.
  const cfg = T.TREND_TFS["4h"];
  const B = []; for (let i = 0; i < 400; i++) { const p = 100 + i * 0.5; B.push({ time: i * cfg.baseSec * 1000, open: p, high: p + 1, low: p - 1, close: p + 0.5, vol: 1 }); }
  const pre = T.precompute(B), i = 350, t = B[i + 1].time;
  const at = (open, sma) => T.analyze(cfg, B, pre, i, { time: t, open, high: open, low: open, close: open }, { sma, htf: null })?.bull;
  const e = at(276, 250); // 10% above the 200-day: fires, with no breakout needed (the bar's high equals its open)
  if (!e || !e.fire) problems.push("swing: did not fire in a strong trend at the bar's open");
  else {
    if (e.entry !== 276) problems.push(`swing: entry ${e.entry} is not the bar's open 276`);
    if (Math.abs((e.target - e.entry) / (e.entry - e.stop) - 3) > 1e-9) problems.push("swing: target is not 3 times the stop distance");
    if (Math.abs((e.entry - e.stop) - 2 * pre.atr[i]) > 1e-9) problems.push("swing: stop is not 2 ATR away");
  }
  if (at(276, 300)?.fire) problems.push("swing: fired under the 200-day average");
  if (at(276, 200)?.fire) problems.push("swing: fired while stretched more than 20% above the 200-day average (v23.8 put the check back)");
  if (T.TREND_TFS["4h"].noStretch) problems.push("swing: the 4 hour chart should not have noStretch set (v23.8)");
  if (T.analyze(cfg, B, pre, i, null, { sma: 250, htf: null })?.bull.fire) problems.push("swing: fired with no new bar");
  // a falling series: RSI is low, so no buy
  const D = B.map((b, k) => { const p = 400 - k * 0.5; return { ...b, open: p, high: p + 1, low: p - 1, close: p - 0.5 }; });
  const pd = T.precompute(D);
  if (T.analyze(cfg, D, pd, i, { time: t, open: 224, high: 224, low: 224, close: 224 }, { sma: 210, htf: null })?.bull.fire) problems.push("swing: fired in a falling market");
}

// Flush Rider (lib/flush.js): the live detector must agree with the plain-English rules (v22.7). Built by hand, numbers written out.
{
  const { flushFires, FLUSH_MIN_RISK_PCT, FLUSH_MIN_ATR_PCT, FLUSH_DROP_PCT } = await import(new URL("../lib/flush.js", import.meta.url));
  const H = 3600e3, now = 300 * H;
  const bars = Array.from({ length: 100 }, (_, i) => ({ time: i * H, open: 100, high: 100.4, low: 99.6, close: 100 }));
  const atr = bars.map(() => 1.6); // 1.6% of a 100 price: above the 1.5% volatility gate (v25.0)
  const flush = (arr) => { arr[80] = { time: 80 * H, open: 100, high: 100, low: 96, close: 97 }; return arr; }; // 4% drop, breaks the 48h low
  const fires = (arr, forming) => flushFires(arr, forming, atr, now, 1e12, H);
  // 1. a retest that touches the entry fills; entry 96.4, stop 94.8, target 101.2
  const b1 = flush(bars.map((b) => ({ ...b }))); for (let i = 81; i < 100; i++) b1[i] = { time: i * H, open: 98, high: 98.5, low: 97.5, close: 98 }; b1[90] = { time: 90 * H, open: 98, high: 98, low: 96.2, close: 97 };
  const f1 = fires(b1.slice(0, 99), b1[99]);
  if (f1.length !== 1 || Math.abs(f1[0].entry - 96.4) > 1e-9 || Math.abs(f1[0].stop - 94.8) > 1e-9 || Math.abs(f1[0].target - 101.2) > 1e-9) problems.push("flush: retest did not give entry 96.4 / stop 94.8 / target 101.2: " + JSON.stringify(f1));
  // 2. price never comes back: no trade
  const b2 = flush(bars.map((b) => ({ ...b }))); for (let i = 81; i < 100; i++) b2[i] = { time: i * H, open: 98, high: 98.5, low: 97.5, close: 98 };
  if (fires(b2.slice(0, 99), b2[99]).length) problems.push("flush: filled with no retest");
  // 3. stop breaks first: no trade
  const b3 = flush(bars.map((b) => ({ ...b }))); for (let i = 81; i < 100; i++) b3[i] = { time: i * H, open: 98, high: 98.5, low: 97.5, close: 98 }; b3[82] = { time: 82 * H, open: 97, high: 97, low: 94.5, close: 95 }; b3[90] = { time: 90 * H, open: 98, high: 98, low: 96.2, close: 97 };
  if (fires(b3.slice(0, 99), b3[99]).length) problems.push("flush: filled after the stop broke");
  // 4. only a 1.4% drop (under the 1.5% flush size): not a flush
  const b4 = bars.map((b) => ({ ...b })); b4[80] = { time: 80 * H, open: 100, high: 100, low: 98.6, close: 99 }; b4[90] = { time: 90 * H, open: 99, high: 99, low: 98.2, close: 99 };
  if (fires(b4.slice(0, 99), b4[99]).length) problems.push("flush: a 1.4% drop counted");
  // 4b. a 4% flush in a calm market (ATR 1.0% of price, under the 1.5% gate): no plan, no trade (v25.0)
  const calm = bars.map((b) => ({ ...b })); const bc = flush(calm); for (let i = 81; i < 100; i++) bc[i] = { time: i * H, open: 98, high: 98.5, low: 97.5, close: 98 }; bc[90] = { time: 90 * H, open: 98, high: 98, low: 96.2, close: 97 };
  if (flushFires(bc.slice(0, 99), bc[99], bars.map(() => 1.0), now, 1e12, H).length) problems.push(`flush: a flush with ATR under ${FLUSH_MIN_ATR_PCT}% of price still traded`);
  if (FLUSH_DROP_PCT !== 1.5 || FLUSH_MIN_ATR_PCT !== 1.5) problems.push("flush: the study's 1.5% flush and 1.5% volatility gate changed without a new study");
  // 5. tiny stop (risk under 0.6% of price): skipped
  const tiny = flushFires(flush(bars.map((b) => ({ ...b }))).slice(0, 99), null, bars.map(() => 0.3), now, 1e12, H);
  if (tiny.length) problems.push(`flush: a stop under ${FLUSH_MIN_RISK_PCT}% was not skipped`);
  // 6. an old fill is never backfilled
  if (flushFires(b1.slice(0, 99), b1[99], atr, now, 1 * H, H).length) problems.push("flush: an old fill was backfilled");
}

// Flow Rider (lib/flow.js, v25.1): heavy selling while under the 50-day -> a short. Built by hand; the module must agree with the plain-English rules.
{
  const FL = await import(new URL("../lib/flow.js", import.meta.url));
  const S = await import(new URL("../lib/signals.js", import.meta.url));
  const { brandName } = await import(new URL("../lib/brand.js", import.meta.url));
  const { resolveOpenTrades } = await import(new URL("../lib/resolve.js", import.meta.url));
  const R = await import(new URL("../lib/readiness.js", import.meta.url));
  const B15 = 15 * 60e3, DAY = 864e5;
  if (FL.FLOW_Z !== -1.5 || FL.FLOW_STOP_PCT !== 5 || FL.FLOW_TARGET_PCT !== 10 || FL.FLOW_MAX_HOLD_MS !== 7 * DAY || FL.FLOW_AVG_DAYS !== 50 || FL.FLOW_WINDOW_BARS !== 96 || FL.FLOW_BASE_BARS !== 2880) problems.push("flow: the study's settings changed without a new study");
  const n = 3200, t0 = Math.floor(Date.UTC(2026, 0, 1) / DAY) * DAY;
  const mk = (heavy, price = 90) => Array.from({ length: n }, (_, i) => ({ time: t0 + i * B15, open: price, high: price + 0.2, low: price - 0.2, close: price, vol: 100, tb: heavy && i >= n - 96 ? 20 : 50 + ((i * 7) % 11) - 5 }));
  const lastDay = Math.floor((t0 + n * B15) / DAY) * DAY;
  const days = (close) => Array.from({ length: 60 }, (_, k) => ({ time: lastDay - (60 - k) * DAY, close }));
  const yday = (close) => { const d = days(close); d.push({ time: lastDay - DAY, close }); return d; };
  const dd = (close) => { const d = []; for (let k = 60; k >= 1; k--) d.push({ time: lastDay - k * DAY, close }); return d; };
  const done = (b) => b.slice(0, n - 1), forming = (b) => b[n - 1];
  const nowAt = t0 + (n - 1) * B15 + 3 * 60e3; // 3 minutes after the last full bar closed
  const all = mk(true).map((b, i) => (i === n - 1 ? { ...b, open: 89.5, close: 89.4 } : b));
  const f1 = FL.flowFires(all, dd(100), nowAt, 15 * 60e3);
  if (!f1.length) problems.push("flow: heavy selling under the 50-day did not fire");
  else {
    const f = f1[f1.length - 1];
    if (f.barTime !== t0 + (n - 2) * B15) problems.push("flow: wrong trigger bar");
    if (Math.abs(f.entry - 89.5) > 1e-9 || Math.abs(f.stop - 89.5 * 1.05) > 1e-9 || Math.abs(f.target - 89.5 * 0.9) > 1e-9) problems.push("flow: entry should be the next open, stop 5% above, target 10% below: " + JSON.stringify(f));
  }
  if (FL.flowFires(mk(false), dd(100), nowAt, 15 * 60e3).length) problems.push("flow: balanced flow fired");
  if (FL.flowFires(all, dd(80), nowAt, 15 * 60e3).length) problems.push("flow: fired while price was ABOVE its 50-day line");
  if (FL.flowFires(all, dd(100), nowAt + 6 * 3600e3, 15 * 60e3).length) problems.push("flow: an old trigger was backfilled");
  const hole = all.filter((_, i) => i !== 500);
  if (FL.flowFires(hole, dd(100), nowAt, 15 * 60e3).length) problems.push("flow: fired across a hole in the data");
  if (FL.flowFires(all.slice(-2000), dd(100), nowAt, 15 * 60e3).length) problems.push("flow: fired without the full 30 day history");
  const st = FL.flowState(all, dd(100), nowAt);
  if (!st || !st.below || !(st.z <= -1.5) || Math.abs(st.avg50 - 100) > 1e-9) problems.push("flow: state should read heavy selling under the 50-day: " + JSON.stringify(st));
  // readiness wording
  const fe = S.ALL_SIGNALS.find((x) => x.name === "Flow Rider");
  const rr = (z, below) => R.signalReadiness(fe, { extra: { flow: { z, avg50: 100, price: below ? 90 : 110, below } }, now: nowAt, open: false });
  if (rr(-2, true)?.badge !== "Ready" || rr(0, true)?.badge !== "1 of 2 met" || rr(0, false)?.badge !== "Quiet") problems.push("flow: readiness badges wrong");
  if (R.signalReadiness(fe, { now: nowAt, open: false }) !== null) problems.push("flow: readiness without data should show nothing");
  if (!fe || !fe.publicTest || !fe.serverOnly || fe.ready !== "flow" || fe.tfs.join() !== "4h" || brandName("Flow Rider") !== "Pressure") problems.push("flow: ALL_SIGNALS entry or brand name wrong");
  // the shared resolver: 7-day close (meta.maxHoldMs)
  const T0 = Date.UTC(2026, 10, 1), H4 = 4 * 3600e3;
  const run = async (open4h, nowMs, priceAt) => {
    const candles = Array.from({ length: 60 }, (_, i) => { const t = T0 + i * H4, p = open4h(i, t); return { time: t, open: p, high: p + 1, low: p - 1, close: p }; });
    const upd = [];
    const sql = async (strs, ...vals) => { const q = strs.join("?"); if (q.includes("SELECT")) return [{ id: 1, coin: "BTC", tf: "4h", dir: "bear", fired_at: new Date(T0), entry: "100", stop: "105", target: "90", meta: { maxHoldMs: 7 * DAY } }]; if (q.includes("UPDATE")) { upd.push(vals); return [{ id: 1 }]; } return []; };
    await resolveOpenTrades(sql, { fetchCandles: async () => candles, now: nowMs });
    return upd[0] || null;
  };
  const after7 = T0 + 7 * DAY + 3600e3;
  const u1 = await run((i, t) => (t >= T0 + 7 * DAY ? 97 : 100), after7); // flat, then 97 at the deadline: short made +3 on a 5 risk
  if (!u1 || u1[0] !== "win" || Math.abs(u1[2] - 97) > 1e-9 || Math.abs(u1[3] - 0.6) > 1e-9) problems.push("flow: 7-day close in profit should be a win at 97 with r 0.6: " + JSON.stringify(u1));
  const u2 = await run((i, t) => (t >= T0 + 7 * DAY ? 103 : 100), after7);
  if (!u2 || u2[0] !== "loss" || Math.abs(u2[3] + 0.6) > 1e-9) problems.push("flow: 7-day close at a loss should be a loss with r -0.6: " + JSON.stringify(u2));
  const u3 = await run((i, t) => 100, T0 + 3 * DAY);
  if (u3) problems.push("flow: a trade inside its 7 days with no stop or target touched must stay open");
  const u4 = await run((i, t) => (t >= T0 + 7 * DAY ? 106 : 100), after7); // price above the stop only AFTER the deadline: the close is at the deadline open (106), r = -1.2, not the stop
  if (!u4 || u4[0] !== "loss" || Math.abs(u4[3] + 1.2) > 1e-9) problems.push("flow: after the deadline the close is at the market, not at the stop: " + JSON.stringify(u4));
  // the entry candle: a short logged mid-candle whose stop is touched inside the candle after the entry, before the next 4 hour candle opens, must lose (checked in 1 minute candles)
  {
    const FROM = T0 + 4 * H4 + 90 * 60e3; // 1h30 into the 4th 4 hour candle
    const mkSql = (upd) => async (strs, ...vals) => { const q = strs.join("?"); if (q.includes("SELECT")) return [{ id: 1, coin: "BTC", tf: "4h", dir: "bear", fired_at: new Date(FROM), entry: "100", stop: "105", target: "90", meta: { maxHoldMs: 7 * DAY, scanFrom: FROM } }]; if (q.includes("UPDATE")) { upd.push(vals); return [{ id: 1 }]; } return []; };
    const flat = Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * H4, open: 100, high: 101, low: 99, close: 100 }));
    const spike = [{ time: FROM + 60e3, low: 99, high: 106 }], quiet = [{ time: FROM + 60e3, low: 99, high: 101 }];
    const upd1 = []; await resolveOpenTrades(mkSql(upd1), { fetchCandles: async () => flat, fetchMinute: async () => spike, now: T0 + 5 * H4 });
    if (!upd1[0] || upd1[0][0] !== "loss" || upd1[0][2] !== 105) problems.push("flow: a stop touched inside the entry candle was missed: " + JSON.stringify(upd1[0]));
    const upd2 = []; await resolveOpenTrades(mkSql(upd2), { fetchCandles: async () => flat, fetchMinute: async () => quiet, now: T0 + 5 * H4 });
    if (upd2[0]) problems.push("flow: a quiet entry candle closed the trade");
  }
  const u5 = await run((i, t) => (i === 5 ? 89 : 100), after7); // target touched on day 1: a normal win at the target
  if (!u5 || u5[0] !== "win" || u5[2] !== 90 || Math.abs(u5[3] - 2) > 1e-9) problems.push("flow: a target touch inside 7 days should win at 90 with r 2: " + JSON.stringify(u5));
}

// Flow Rider through the real runner (lib/trendRunner.js scanFlow) with a stand-in database: it logs one short with the right numbers and a 7 day limit, and a missing feed logs nothing.
{
  const RT = await import(new URL("../lib/trendRunner.js", import.meta.url));
  const B15 = 900e3, DAY = 864e5, n = 3200, t0 = Math.floor(Date.UTC(2026, 0, 1) / DAY) * DAY;
  const k15 = Array.from({ length: n }, (_, i) => ({ time: t0 + i * B15, open: 90, high: 90.2, low: 89.8, close: 90, vol: 100, tb: i >= n - 96 ? 20 : 50 + ((i * 7) % 11) - 5 }));
  k15[n - 1] = { ...k15[n - 1], open: 89.5, close: 89.4 };
  const lastDay = Math.floor((t0 + n * B15) / DAY) * DAY, days = []; for (let k = 60; k >= 1; k--) days.push({ time: lastDay - k * DAY, close: 100 });
  const now = t0 + (n - 1) * B15 + 3 * 60e3, ins = [];
  const sql = async (strs, ...vals) => { if (/INSERT INTO signal_track/.test(strs.join("?"))) { ins.push(vals); return [{ id: 1 }]; } return []; };
  const fetchGran = async (s, p) => Array.from({ length: p * 300 }, (_, i) => ({ time: Math.floor(now / (s * 1000)) * s * 1000 - (p * 300 - 1 - i) * s * 1000, low: 99.9, high: 100.1, open: 100, close: 100, volumeto: 10 }));
  const deps = (getFlow) => ({ now, forceFull: true, coins: ["BTC"], fetchGran, getDailySMA: async () => 100, crowd: async () => null, getFlow, resolveIo: { fetchCandles: async () => [], now } });
  const r1 = await RT.runTrend(sql, null, deps(async () => ({ k15, days })));
  const row = ins.find((v) => v[2] === "Flow Rider");
  if (!row || ins.length !== 1 || row[3] !== "bear" || row[1] !== "4h" || Math.abs(row[5] - 89.5) > 1e-9 || Math.abs(row[6] - 89.5 * 1.05) > 1e-9 || Math.abs(row[7] - 89.5 * 0.9) > 1e-9) problems.push("flow runner: expected exactly one Flow Rider short 4h at 89.5 / 93.975 / 80.55: " + JSON.stringify(ins));
  else if (!JSON.parse(row[9]).maxHoldMs || JSON.parse(row[9]).maxHoldMs !== 7 * DAY) problems.push("flow runner: the row must carry the 7 day limit");
  if (r1.byCoin.BTC.byTf["flow:4h"]?.opened !== 1) problems.push("flow runner: result should count one opened trade");
  ins.length = 0;
  const r2 = await RT.runTrend(sql, null, deps(async () => null));
  if (ins.length || r2.byCoin.BTC.byTf["flow:4h"]?.skipped !== "feed_unavailable" || r2.byCoin.BTC.feedFailed) problems.push("flow runner: a missing Binance feed must log nothing and must not count as a failed scan");
}

// Calm Rider (lib/calmRider.js, v25.2): the Momentum buy, only while the hourly swings are calm. Built by hand; the module must agree with the plain-English rules.
{
  const C = await import(new URL("../lib/calmRider.js", import.meta.url));
  const S = await import(new URL("../lib/signals.js", import.meta.url));
  const { brandName } = await import(new URL("../lib/brand.js", import.meta.url));
  const R = await import(new URL("../lib/readiness.js", import.meta.url));
  const H = 3600e3, n = 400, t0 = Math.floor(Date.UTC(2026, 0, 1) / H) * H;
  if (C.CALM_MAX_ATR_PCT !== 1.2 || C.CALM_WINDOW !== 300 || C.CALM_DETECTOR_LABEL !== "Momentum" || C.CALM_TFS.join() !== "1h,30m") problems.push("calm: the study's settings changed without a new study");
  const mk = (rng, jump = 2.8) => Array.from({ length: n }, (_, i) => i === n - 1
    ? { time: t0 + i * H, open: 100, high: 100 * (1 + jump / 100 + 0.001), low: 99.95, close: 100 * (1 + jump / 100), volumeto: 5 }
    : { time: t0 + i * H, open: 100, high: 100 + rng, low: 100 - rng, close: 100 + (i % 2 ? 0.05 : -0.05), volumeto: 5 });
  const now = t0 + n * H + 2 * 60e3, fresh = 15 * 60e3;
  const calm = C.calmBars("1h", mk(0.15), now);
  const f1 = C.calmFires("1h", calm, calm, now, fresh);
  if (f1.length !== 1) problems.push("calm: a strong up candle in a calm market did not fire exactly once: " + JSON.stringify(f1));
  else {
    const f = f1[0];
    if (f.barTime !== t0 + (n - 1) * H || Math.abs(f.entry - 102.8) > 1e-9) problems.push("calm: entry should be the candle's close: " + JSON.stringify(f));
    if (!(f.stop < f.entry && f.target > f.entry) || Math.abs((f.target - f.entry) / (f.entry - f.stop) - 2) > 1e-6) problems.push("calm: stop must sit below and the target 2R above: " + JSON.stringify(f));
    if (!(f.atrPct < C.CALM_MAX_ATR_PCT)) problems.push("calm: fired with a swinging market");
  }
  const swingy = C.calmBars("1h", mk(1.6), now);
  if (C.calmFires("1h", swingy, swingy, now, fresh).length) problems.push("calm: fired while the hourly swings were big");
  if (C.calmFires("1h", C.calmBars("1h", mk(0.15, 1.0), now), calm, now, fresh).length) problems.push("calm: a weak up candle fired");
  if (C.calmFires("1h", calm, calm, now + 3 * H, fresh).length) problems.push("calm: an old candle was backfilled");
  const hole = calm.slice(); hole.splice(n - 2, 1);
  if (C.calmFires("1h", hole, calm, now, fresh).length) problems.push("calm: fired across a hole in the data");
  // 30 minute chart from 15 minute candles
  const k = Array.from({ length: 600 }, (_, i) => { const t = t0 + i * 900e3; return i >= 598 ? { time: t, open: 100, high: 101.9, low: 99.95, close: i === 599 ? 101.8 : 100.9, volumeto: 5 } : { time: t, open: 100, high: 100.1, low: 99.9, close: 100 + (i % 2 ? 0.03 : -0.03), volumeto: 5 }; });
  const now30 = t0 + 600 * 900e3 + 2 * 60e3, hrs = Array.from({ length: 200 }, (_, i) => ({ time: t0 + (i + 25) * H - 0, open: 100, high: 100.15, low: 99.85, close: 100, volumeto: 5 }));
  const b30 = C.calmBars("30m", k, now30), f30 = C.calmFires("30m", b30, hrs, now30, fresh);
  if (b30.length !== 300 || f30.length !== 1 || Math.abs(f30[0].entry - 101.8) > 1e-9) problems.push("calm: 30 minute chart should give 300 bars and one buy at 101.8: " + b30.length + " " + JSON.stringify(f30));
  // readiness
  const ce = S.ALL_SIGNALS.find((x) => x.name === "Calm Rider");
  const rc = (cs) => R.signalReadiness(ce, { candles: cs, now, open: false });
  if (rc(mk(0.15))?.badge !== "Calm" || rc(mk(1.6))?.badge !== "Quiet" || rc(null) !== null) problems.push("calm: readiness badges wrong");
  if (!ce || !ce.publicTest || !ce.serverOnly || ce.ready !== "calm" || ce.tfs.join() !== C.CALM_TFS.join() || ce.coins.join() !== "BTC" || brandName("Calm Rider") !== "Spark") problems.push("calm: ALL_SIGNALS entry or brand name wrong");
  if (!S.SERVER_ONLY_SIGNALS.includes("Calm Rider") || !S.PUBLIC_TESTING.includes("Calm Rider")) problems.push("calm: must be server-only and a public test");
}

// Calm Rider through the real runner (lib/trendRunner.js scanCalm) with a stand-in database: one Spark buy on the 1 hour chart with the right numbers.
{
  const RT = await import(new URL("../lib/trendRunner.js", import.meta.url));
  const H = 3600e3, now = Math.floor(Date.UTC(2026, 2, 1) / H) * H + 3 * 60e3, ins = [];
  const sql = async (strs, ...vals) => { if (/INSERT INTO signal_track/.test(strs.join("?"))) { ins.push(vals); return [{ id: 1 }]; } return []; };
  const fetchGran = async (s, p) => Array.from({ length: p * 300 }, (_, i) => {
    const time = Math.floor(now / (s * 1000)) * s * 1000 - (p * 300 - 1 - i) * s * 1000, last = i === p * 300 - 2 && s === 3600;
    return last ? { time, open: 100, high: 102.9, low: 99.95, close: 102.8, volumeto: 10 } : { time, open: 100, high: 100.15, low: 99.85, close: 100 + (i % 2 ? 0.05 : -0.05), volumeto: 10 };
  });
  const run = (gran) => RT.runTrend(sql, null, { now, forceFull: true, coins: ["BTC"], fetchGran: gran, getDailySMA: async () => 100, crowd: async () => null, getFlow: async () => null, resolveIo: { fetchCandles: async () => [], now } });
  const r1 = await run(fetchGran);
  const rows = ins.filter((v) => v[2] === "Calm Rider");
  if (rows.length !== 1 || rows[0][3] !== "bull" || rows[0][1] !== "1h" || Math.abs(rows[0][5] - 102.8) > 1e-9 || !(rows[0][6] < 102.8) || !(rows[0][7] > 102.8)) problems.push("calm runner: expected exactly one Calm Rider buy on 1h at 102.8: " + JSON.stringify(rows));
  else if (JSON.parse(rows[0][9]).scanFrom !== rows[0][8] + H) problems.push("calm runner: the resolver must start at the end of the signal candle");
  if (r1.byCoin.BTC.byTf["calm:1h"]?.opened !== 1 || r1.byCoin.BTC.byTf["calm:1h"]?.error) problems.push("calm runner: result should count one opened trade with no error: " + JSON.stringify(r1.byCoin.BTC.byTf["calm:1h"]));
  ins.length = 0;
  await run(async (s, p) => { if (s === 900) throw new Error("down"); return fetchGran(s, p); });
  if (ins.filter((v) => v[2] === "Calm Rider" && v[1] === "30m").length) problems.push("calm runner: a missing 30 minute feed must not log a 30m trade");
}

if (problems.length) {
  console.error(`REVIEW FAILED (${problems.length})\n` + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log(`review ok: ${files.length} files parse, imports resolve, no drift traps.`);
