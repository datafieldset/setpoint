// Crash-short study (Nov 21, written to memory/overhaul-plan.md BEFORE running). BTC only.
// Usage: BTC_DIR=<folder with BTC_5m.json and BTC_1d.json> node scripts/replay-crash-short.mjs
// Regime (finished bars only): price under the last COMPLETED daily 200-day and 50-day averages AND at least X% under its 7 day high.
// Tries: 33 breakdown short (1h), 34 failed-bounce short (1h), 35 breakdown short (4h). Cost 0.20% per trade. Stop 2 ATR, target k R.
import fs from "fs";
const T = await import("../lib/trend.js");
const DIR = process.env.BTC_DIR || ".";
const c5 = JSON.parse(fs.readFileSync(DIR + "/BTC_5m.json"));
const d1 = JSON.parse(fs.readFileSync(DIR + "/BTC_1d.json"));
const NOW = Date.now() + 1e12;
const H1 = T.splitBars(c5, 3600, 300, NOW).done, H4 = T.splitBars(c5, 14400, 300, NOW).done;
const COST = 0.20; // percent per trade
const DAY = 864e5;
// daily SMAs, keyed by day start; the value for a bar is the one from the day BEFORE the bar's day (completed bars only)
const dc = d1.map((d) => d.close), sma = (n) => dc.map((_, i) => (i + 1 < n ? null : dc.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
const s50 = sma(50), s200 = sma(200), dIdx = new Map(d1.map((d, i) => [Math.floor(d.time / DAY) * DAY, i]));
const dailyAvg = (t) => { const i = dIdx.get(Math.floor(t / DAY) * DAY - DAY); return i == null || s200[i] == null ? null : { a50: s50[i], a200: s200[i] }; };
const ema = (bars, n) => { const k = 2 / (n + 1), o = []; let e = null; bars.forEach((b, i) => { e = e == null ? b.close : b.close * k + e * (1 - k); o.push(i < n ? null : e); }); return o; };
const eras = [["20-21", 2020, 2021], ["22", 2022, 2022], ["23-24", 2023, 2024], ["25-26", 2025, 2026]];
const LOCK_START = Date.UTC(2025, 10, 7), LOCK_END = Date.UTC(2026, 10, 7); // Nov 7 2025 to Nov 6 2026 (end exclusive)
const CRASH_START = Date.UTC(2026, 10, 7);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const f = (v) => (isNaN(v) ? "  n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));

function prep(B, barsPerWeek) {
  const pre = T.precompute(B), e20 = ema(B, 20);
  const hi7 = B.map((_, i) => { let m = 0; for (let j = Math.max(0, i - barsPerWeek + 1); j <= i; j++) m = Math.max(m, B[j].high); return m; });
  return { B, atr: pre.atr, e20, hi7 };
}
function regimeAt(P, i, X) {
  const d = dailyAvg(P.B[i].time); if (!d) return false;
  const c = P.B[i].close;
  return c < d.a200 && c < d.a50 && c <= P.hi7[i] * (1 - X / 100);
}
// signal at bar i (bar closed). returns true if the entry rule fires.
const SIG = {
  breakdown: (P, i, look) => { if (i < look + 1) return false; let lo = 1e18; for (let j = i - look; j < i; j++) lo = Math.min(lo, P.B[j].low); return P.B[i].close < lo; },
  failedBounce: (P, i) => { if (i < 30 || P.e20[i] == null) return false; if (!(P.B[i].close < P.e20[i])) return false; for (let j = i - 6; j < i; j++) if (P.e20[j] != null && P.B[j].close > P.e20[j]) return true; return false; },
};
// short at the next bar's open. returns { net, end, t, ... } or null
function sim(P, i, k) {
  const B = P.B, atr = P.atr[i]; if (!atr || i + 1 >= B.length) return null;
  const E = B[i + 1].open, risk = 2 * atr, stop = E + risk, tgt = E - k * risk;
  const lim = Math.min(B.length - 1, i + 600);
  for (let j = i + 1; j <= lim; j++) {
    if (B[j].high >= stop) return { r: -1 - (COST / 100) * E / risk, end: j, t: B[i + 1].time };
    if (B[j].low <= tgt) return { r: k - (COST / 100) * E / risk, end: j, t: B[i + 1].time };
  }
  return null; // never resolved inside 600 bars: dropped (counted below)
}
function run(P, sig, k, X, usePause = 12) {
  const out = []; let free = 0, open = 0;
  for (let i = 40; i < P.B.length - 1; i++) {
    if (i < free) continue;
    if (X != null && !regimeAt(P, i, X)) continue;
    if (!sig(P, i)) continue;
    const r = sim(P, i, k); if (!r) { open++; continue; }
    out.push({ ...r, y: new Date(r.t).getUTCFullYear() }); free = r.end + usePause;
  }
  out.dropped = open; return out;
}
// luck: random bars inside the same regime, same gate, same stop/target, same count
function luck(P, k, X, n, draws = 200) {
  const cand = []; for (let i = 40; i < P.B.length - 1; i++) if (regimeAt(P, i, X)) cand.push(i);
  const means = [];
  for (let d = 0; d < draws; d++) {
    const order = cand.slice(); for (let a = order.length - 1; a > 0; a--) { const b = Math.floor(Math.random() * (a + 1)); [order[a], order[b]] = [order[b], order[a]]; }
    const taken = []; const busy = [];
    for (const i of order) { if (taken.length >= n) break; if (busy.some(([s, e]) => i >= s && i < e)) continue; const r = sim(P, i, k); if (!r) continue; taken.push(r.r); busy.push([i, r.end + 12]); }
    if (taken.length >= Math.max(5, n * 0.8)) means.push(avg(taken));
  }
  return means;
}
function episodes(tr) { let n = 0, last = -1e18; for (const t of tr.map((x) => x.t).sort((a, b) => a - b)) { if (t - last > 14 * DAY) n++; last = t; } return n; }
function report(name, P, sig, k, X) {
  const tr = run(P, sig, k, X);
  if (!tr.length) { console.log(name.padEnd(46), "no trades"); return tr; }
  const w = tr.filter((x) => x.r > 0).length, m = avg(tr.map((x) => x.r));
  const sorted = tr.map((x) => x.r).sort((a, b) => b - a), cut = Math.floor(sorted.length * 0.05);
  const trimmed = avg(sorted.slice(cut));
  const era = eras.map(([n, s, e]) => { const z = tr.filter((x) => x.y >= s && x.y <= e); return n + ":" + (z.length ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : "-"); }).join(" ");
  const ex = tr.filter((x) => x.t >= LOCK_START && x.t < LOCK_END), post = tr.filter((x) => x.t >= CRASH_START);
  let lk = "";
  if (X != null) { const L = luck(P, k, X, tr.length); if (L.length) { const beat = L.filter((v) => v < m).length / L.length; lk = ` luck: beats ${(beat * 100).toFixed(0)}% of ${L.length} draws (avg ${f(avg(L))})`; } }
  console.log(`${name.padEnd(46)} n=${String(tr.length).padStart(3)} win ${(100 * w / tr.length).toFixed(0)}% net ${f(m)}R minus top5% ${f(trimmed)} | ${era} | episodes ${episodes(tr)} | exam12m n=${ex.length} ${f(avg(ex.map((x) => x.r)))} | after lock n=${post.length} ${post.map((x) => new Date(x.t).toISOString().slice(5, 13) + "Z " + f(x.r)).join(", ")}${lk}`);
  return tr;
}

const P1 = prep(H1, 168), P4 = prep(H4, 42);
console.log("1h bars", H1.length, "4h bars", H4.length, "to", new Date(H1[H1.length - 1].time).toISOString().slice(0, 16), "| cost", COST + "% per trade");
let regimeBars = {}; for (const X of [8, 10, 12]) { let n = 0; for (let i = 40; i < H1.length; i++) if (regimeAt(P1, i, X)) n++; regimeBars[X] = n; }
console.log("1h bars in the crash regime:", JSON.stringify(regimeBars), "of", H1.length);
const sigs = [
  ["T33 breakdown 1h (24 bar low)", P1, (P, i) => SIG.breakdown(P, i, 24)],
  ["T34 failed bounce 1h", P1, (P, i) => SIG.failedBounce(P, i)],
  ["T35 breakdown 4h (24 bar low)", P4, (P, i) => SIG.breakdown(P, i, 24)],
];
for (const [name, P, sig] of sigs) {
  console.log("\n== " + name);
  for (const X of [10, 8, 12]) for (const k of [3, 2, 4]) report(`  X=${X}% target ${k}R${X === 10 && k === 3 ? "  <- MAIN" : ""}`, P, sig, k, X);
  report("  CHECK no regime, target 3R", P, sig, 3, null);
}
