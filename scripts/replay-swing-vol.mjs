// Does a volatility gate help Swing Rider (Trend, 4h)? Live detector (lib/trend.js analyze, 4h config), BTC Aug 2017 to now built from 15m candles.
// F=<BTC_15m_full.json> node scripts/replay-swing-vol.mjs   Cost 0.20% per trade, stop 2 ATR, target 3R from the live config.
import fs from "fs";
const T = await import("../lib/trend.js");
const rows = JSON.parse(fs.readFileSync(process.env.F)); const FAR = Date.now() + 1e12, COST = 0.2;
const dm = new Map(); for (const r of rows) { const d = Math.floor(r.time / 864e5); const x = dm.get(d); if (!x) dm.set(d, { time: d * 864e5, close: r.close }); else x.close = r.close; }
const days = [...dm.entries()].sort((a, b) => a[0] - b[0]); const sma = new Map(); { const q = []; let s = 0; for (const [d, x] of days) { if (q.length === 200) s -= q.shift(); q.push(x.close); s += x.close; if (q.length === 200) sma.set(d + 1, s / 200); } }
const cfg = T.TREND_TFS["4h"], B = T.splitBars(rows, 14400, 900, FAR).done, pre = T.precompute(B), H1 = T.splitBars(rows, 3600, 900, FAR).done, h1 = T.precompute(H1);
const h1Idx = new Map(H1.map((b, i) => [b.time, i]));
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? " n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
const all = [];
for (let i = 300; i < B.length - 2; i++) {
  const fb = B[i + 1];
  const a = T.analyze(cfg, B, pre, i, { time: fb.time, open: fb.open, high: fb.high, low: fb.low, close: fb.open }, { sma: sma.get(Math.floor(fb.time / 864e5)), htf: null });
  if (!a || !a.bull || !a.bull.fire) continue;
  const E = a.bull.entry, S = a.bull.stop, r0 = E - S, tgt = E + 3 * r0; let res = null;
  for (let k = i + 1; k < Math.min(B.length, i + 400); k++) { if (B[k].low <= S) { res = { r: -1, end: k }; break; } if (B[k].high >= tgt) { res = { r: 3, end: k }; break; } }
  if (!res) continue;
  const hi = h1Idx.get(Math.floor(B[i].time / 3600e3) * 3600e3 + 3 * 3600e3); // last hourly bar inside the signal 4h bar
  all.push({ t: fb.time, y: new Date(fb.time).getUTCFullYear(), r: res.r - COST / 100 * E / r0, a4: pre.atr[i] / B[i].close * 100, a1: hi != null && h1.atr[hi] ? h1.atr[hi] / H1[hi].close * 100 : null }); i = res.end;
}
const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
const show = (name, tr) => { if (tr.length < 8) return console.log(name.padEnd(34), "n=" + tr.length); const s = tr.map((x) => x.r).sort((a, b) => b - a); console.log(`${name.padEnd(34)} n=${String(tr.length).padStart(3)} win ${(100 * tr.filter((x) => x.r > 0).length / tr.length).toFixed(0)}% ${f(avg(tr.map((x) => x.r)))}R top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} | ${eras.map(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : "-"; }).join(" ")}`); };
show("Swing Rider as live (no gate)", all);
for (const g of [1.5, 2, 2.5, 3]) { show(`4h ATR% >= ${g}`, all.filter((x) => x.a4 >= g)); show(`4h ATR% <  ${g}`, all.filter((x) => x.a4 < g)); }
for (const g of [0.8, 1.0, 1.5]) { show(`1h ATR% >= ${g}`, all.filter((x) => x.a1 != null && x.a1 >= g)); show(`1h ATR% <  ${g}`, all.filter((x) => x.a1 != null && x.a1 < g)); }
const med = all.map((x) => x.a4).sort((a, b) => a - b)[Math.floor(all.length / 2)]; console.log("median 4h ATR% at entries:", med.toFixed(2));
function perm(name, sel) { const m = avg(sel.map((x) => x.r)), n = sel.length; let c = 0; const N = 20000; for (let d = 0; d < N; d++) { let s = 0; for (let k = 0; k < n; k++) s += all[Math.floor(Math.random() * all.length)].r; if (s / n >= m) c++; } console.log(`luck test ${name}: n=${n} mean ${f(m)}R, a random ${n} of the ${all.length} does this well ${(100 * c / N).toFixed(1)}% of the time`); }
perm("1h ATR >= 0.8", all.filter((x) => x.a1 != null && x.a1 >= 0.8)); perm("1h ATR >= 1.0", all.filter((x) => x.a1 != null && x.a1 >= 1)); perm("4h ATR >= 2", all.filter((x) => x.a4 >= 2));
const yrs = (all.at(-1).t - all[0].t) / (365.25 * 864e5); console.log("years", yrs.toFixed(1), "| trades/yr ungated", (all.length / yrs).toFixed(1), "gated 0.8:", (all.filter((x) => x.a1 >= 0.8).length / yrs).toFixed(1));
