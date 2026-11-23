// Bounce winner-vs-loser study, Nov 22 (plan in memory/overhaul-plan.md, written first). BTC_DIR = folder with BTC_5m.json and BTC_1d.json.
import fs from "fs";
const T = await import("../lib/trend.js"), F = await import("../lib/flush.js");
const D = process.env.BTC_DIR || ".";
const c5 = JSON.parse(fs.readFileSync(D + "/BTC_5m.json")), d1 = JSON.parse(fs.readFileSync(D + "/BTC_1d.json"));
const B = T.splitBars(c5, 3600, 300, Date.now() + 1e12).done, pre = T.precompute(B);
const DAY = 864e5, dc = d1.map((d) => d.close), sma = (n) => dc.map((_, i) => (i + 1 < n ? null : dc.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
const s50 = sma(50), s200 = sma(200), dIdx = new Map(d1.map((d, i) => [Math.floor(d.time / DAY) * DAY, i]));
const COST = 0.20, DROP = 1.5, avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
const eras = [["20-21", 2020, 2021], ["22", 2022, 2022], ["23-24", 2023, 2024], ["25-26", 2025, 2026]];
const LOCK0 = Date.UTC(2025, 10, 7), LOCK1 = Date.UTC(2026, 10, 7);
function walk(k0, E, S, tgt) { const risk = E - S; for (let k = k0; k < Math.min(B.length, k0 + 600); k++) { if (B[k].low <= S) return -1 - (COST / 100) * E / risk; if (B[k].high >= tgt) return 3 - (COST / 100) * E / risk; } return null; }
const isFB = (i) => { if (i < 48) return false; const b = B[i]; if ((b.open - b.low) / b.open < DROP / 100) return false; let lo = Infinity; for (let j = i - 48; j < i; j++) lo = Math.min(lo, B[j].low); return b.low < lo; };
const rows = []; let last = -1e9;
for (let i = 60; i < B.length - 1; i++) {
  if (!isFB(i) || i - last <= F.FLUSH_COOLDOWN) continue; last = i;
  const atr = pre.atr[i]; if (!(atr > 0)) continue;
  const p = F.flushPlan(B[i], atr); if (!p) continue;
  let fill = -1; for (let k = i + 1; k <= i + F.FLUSH_WAIT && k < B.length; k++) { if (B[k].low <= p.stop) break; if (B[k].low <= p.entry) { fill = k; break; } }
  if (fill < 0) continue; const r = walk(fill, p.entry, p.stop, p.target); if (r == null) continue;
  const b = B[i], di = dIdx.get(Math.floor(b.time / DAY) * DAY - DAY); if (di == null || s200[di] == null) continue;
  let v24 = 0; for (let j = i - 24; j < i; j++) v24 += B[j].vol; v24 /= 24; let lo48 = Infinity; for (let j = i - 48; j < i; j++) lo48 = Math.min(lo48, B[j].low);
  const h = new Date(b.time).getUTCHours();
  rows.push({ t: B[fill].time, r, size: (b.open - b.low) / b.open * 100, closeLoc: (b.close - b.low) / (b.high - b.low), vol: b.vol / v24, prior24: (b.open / B[i - 24].open - 1) * 100, prior72: (b.open / B[i - 72].open - 1) * 100, under50: (b.close / s50[di] - 1) * 100, under200: (b.close / s200[di] - 1) * 100, atrPct: atr / b.close * 100, depth: (lo48 - b.low) / lo48 * 100, us: h >= 13 && h <= 21 ? 1 : 0 });
}
rows.sort((a, b) => a.t - b.t);
console.log("Bounce fills at flush >= " + DROP + "%:", rows.length, "avg", f(avg(rows.map((x) => x.r))) + "R");
const feats = ["size", "closeLoc", "vol", "prior24", "prior72", "under50", "under200", "atrPct", "depth", "us"];
const half = Math.floor(rows.length / 2);
function diffFor(arr, k, med) { const hi = arr.filter((x) => x[k] > med), lo = arr.filter((x) => x[k] <= med); return hi.length && lo.length ? { d: avg(hi.map((x) => x.r)) - avg(lo.map((x) => x.r)), hi: avg(hi.map((x) => x.r)), lo: avg(lo.map((x) => x.r)), nh: hi.length, nl: lo.length } : { d: 0, hi: NaN, lo: NaN, nh: 0, nl: 0 }; }
const med = (arr, k) => { const s = arr.map((x) => x[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const real = {};
for (const k of feats) { const m = med(rows, k), all = diffFor(rows, k, m), a = diffFor(rows.slice(0, half), k, m), b = diffFor(rows.slice(half), k, m); real[k] = { m, all, a, b }; console.log(k.padEnd(9), "median", m.toFixed(2).padStart(7), "| above-median avg", f(all.hi), "(" + all.nh + ") vs below", f(all.lo), "(" + all.nl + ") | diff", f(all.d), "| older half", f(a.d), "newer half", f(b.d), a.d * b.d > 0 ? "same side" : "DISAGREE"); }
// family-wise luck: shuffle results, take the best |diff| over the ten features
const maxReal = Math.max(...feats.map((k) => Math.abs(real[k].all.d))); let beat = 0; const S = 1000;
for (let s = 0; s < S; s++) { const rs = rows.map((x) => x.r); for (let i = rs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rs[i], rs[j]] = [rs[j], rs[i]]; } const sh = rows.map((x, i) => ({ ...x, r: rs[i] })); const mx = Math.max(...feats.map((k) => Math.abs(diffFor(sh, k, real[k].m).d))); if (mx >= maxReal) beat++; }
console.log("\nbest single difference", f(maxReal) + "R; the best of ten looks this good by pure chance in", (100 * beat / S).toFixed(1) + "% of 1000 shuffles");

function grade(name, arr) {
  if (!arr.length) { console.log(name, "no trades"); return; }
  const rs = arr.map((x) => x.r), w = rs.filter((v) => v > 0).length, srt = rs.slice().sort((a, b) => b - a), trim = avg(srt.slice(Math.floor(srt.length * 0.05)));
  const era = eras.map(([n, a, b]) => { const z = arr.filter((x) => { const y = new Date(x.t).getUTCFullYear(); return y >= a && y <= b; }); return n + ":" + f(avg(z.map((x) => x.r))) + "(" + z.length + ")"; }).join(" ");
  const mid = arr[Math.floor(arr.length / 2)].t, ex = arr.filter((x) => x.t >= LOCK0 && x.t < LOCK1), post = arr.filter((x) => x.t >= LOCK1);
  console.log(`${name.padEnd(34)} n=${String(arr.length).padStart(3)} win ${(100 * w / arr.length).toFixed(0)}% ${f(avg(rs))}R -best5% ${f(trim)} halves ${f(avg(arr.filter((x) => x.t < mid).map((x) => x.r)))}/${f(avg(arr.filter((x) => x.t >= mid).map((x) => x.r)))} | ${era} | exam n=${ex.length} ${f(avg(ex.map((x) => x.r)))} | after Nov 6: ${post.map((x) => new Date(x.t).toISOString().slice(5, 13) + "Z " + f(x.r)).join(", ") || "none"}`);
}
console.log("\n--- ATR filter (volatility as % of price at the flush), flush >= 1.5%");
grade("no filter", rows);
for (const t of [0.6, 0.8, 1.0, 1.2, 1.5]) grade(`ATR >= ${t}%`, rows.filter((x) => x.atrPct >= t));
console.log("--- same filter on flush >= 2.5% only");
grade("no filter 2.5%", rows.filter((x) => x.size >= 2.5));
for (const t of [0.8, 1.0, 1.2]) grade(`2.5% and ATR >= ${t}%`, rows.filter((x) => x.size >= 2.5 && x.atrPct >= t));
