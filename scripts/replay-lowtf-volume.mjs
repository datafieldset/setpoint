// Volume / buyer-flow event study, 15m BTC Aug 2017 to now (plan in memory/overhaul-plan.md Nov 22). F=<BTC_15m_tb.json> node scripts/replay-lowtf-volume.mjs
import fs from "fs";
const B = JSON.parse(fs.readFileSync(process.env.F)); const COST = 0.20;
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? "  n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
function atrOf(B, n = 14) { const o = []; let a = null; B.forEach((b, i) => { const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i < n ? null : a); }); return o; }
const atr = atrOf(B), N = B.length; const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
const vr = new Array(N).fill(null); { let s = 0; const q = []; for (let i = 0; i < N; i++) { if (q.length === 96) { vr[i] = B[i].vol / (s / 96); s -= q.shift(); } q.push(B[i].vol); s += B[i].vol; } }
const bs = B.map((b) => (b.vol > 0 ? b.tb / b.vol : 0.5)), mv = B.map((b, i) => (atr[i] ? (b.close - b.open) / atr[i] : 0));
const ret = (i, h) => (i + h < N ? (B[i + h].close - B[i].close) / B[i].close * 100 : null);
const dn1h = B.map((b, i) => (i >= 4 ? (b.close - B[i - 4].open) / B[i - 4].open * 100 : 0));
function ev(name, pick) { // events: dir = +1 means "push up". Report follow (trade in push direction) and fade, 4 and 16 bars, net of cost
  const rows = []; let last = -99; for (let i = 120; i < N - 17; i++) { if (i - last < 4) continue; const d = pick(i); if (!d) continue; rows.push({ i, d, y: new Date(B[i].time).getUTCFullYear() }); last = i; }
  if (rows.length < 40) return console.log(name.padEnd(58), "n=" + rows.length);
  const out = [name.padEnd(58) + " n=" + String(rows.length).padStart(5)];
  for (const h of [4, 16]) { const fo = rows.map((r) => r.d * ret(r.i, h) - COST); const t = [...fo].sort((a, b) => b - a), t5 = avg(t.slice(Math.floor(t.length * 0.05))); const er = eras.map(([a, b]) => { const z = rows.filter((r) => r.y >= a && r.y <= b).map((r) => r.d * ret(r.i, h) - COST); return z.length >= 8 ? f(avg(z)) : "  -"; }).join(" ");
    out.push(`${h * 15 / 60}h follow ${f(avg(fo))}% (top5-off ${f(t5)}) fade ${f(avg(rows.map((r) => -r.d * ret(r.i, h) - COST)))}% | follow by era ${er}`); }
  console.log(out.join("  ")); }
for (const V of [2, 3, 4]) { ev(`vol x${V}+ and big UP bar (>=1.5 ATR)`, (i) => (vr[i] >= V && mv[i] >= 1.5 ? 1 : 0)); ev(`vol x${V}+ and big DOWN bar (<=-1.5 ATR)`, (i) => (vr[i] >= V && mv[i] <= -1.5 ? -1 : 0)); }
ev("vol x3+, buyers >=65% (push up)", (i) => (vr[i] >= 3 && bs[i] >= 0.65 ? 1 : 0)); ev("vol x3+, sellers >=65% (push down)", (i) => (vr[i] >= 3 && bs[i] <= 0.35 ? -1 : 0));
ev("vol x2+, buyers >=60% and bar up", (i) => (vr[i] >= 2 && bs[i] >= 0.6 && mv[i] > 0.5 ? 1 : 0)); ev("vol x2+, sellers >=60% and bar down", (i) => (vr[i] >= 2 && bs[i] <= 0.4 && mv[i] < -0.5 ? -1 : 0));
ev("CLIMAX down: vol x4+ and 1h drop >=2%", (i) => (vr[i] >= 4 && dn1h[i] <= -2 ? -1 : 0)); ev("CLIMAX up: vol x4+ and 1h rise >=2%", (i) => (vr[i] >= 4 && dn1h[i] >= 2 ? 1 : 0));
ev("big DOWN bar on LOW volume (<x0.8)", (i) => (vr[i] != null && vr[i] <= 0.8 && mv[i] <= -1.5 ? -1 : 0)); ev("big UP bar on LOW volume (<x0.8)", (i) => (vr[i] != null && vr[i] <= 0.8 && mv[i] >= 1.5 ? 1 : 0));
// 3 bars in a row of rising volume and falling price
ev("3 bars: volume rising, price falling", (i) => (vr[i] >= 1.5 && B[i].vol > B[i - 1].vol && B[i - 1].vol > B[i - 2].vol && B[i].close < B[i - 2].open ? -1 : 0));
