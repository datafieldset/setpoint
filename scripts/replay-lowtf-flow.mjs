// Delayed flow study (plan in memory/overhaul-plan.md). F=<BTC_15m_tb.json> node scripts/replay-lowtf-flow.mjs
import fs from "fs";
const B = JSON.parse(fs.readFileSync(process.env.F)); const COST = 0.20, N = B.length;
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), sd = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((v) => (v - m) ** 2))); };
const f = (v) => (isNaN(v) ? "  n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
// daily 50-day average from completed days
const dm = new Map(); for (const b of B) { const d = Math.floor(b.time / 864e5); const x = dm.get(d); if (!x) dm.set(d, b.close); else dm.set(d, b.close); }
const dd = [...dm.entries()].sort((a, b) => a[0] - b[0]), s50 = new Map(); for (let i = 49; i < dd.length; i++) s50.set(dd[i][0] + 1, avg(dd.slice(i - 49, i + 1).map((x) => x[1])));
const net = B.map((b) => 2 * b.tb - b.vol);
function flowSeries(Wb) { const num = new Array(N).fill(null); let sn = 0, sv = 0; for (let i = 0; i < N; i++) { sn += net[i]; sv += B[i].vol; if (i >= Wb) { sn -= net[i - Wb]; sv -= B[i - Wb].vol; } if (i >= Wb - 1) num[i] = sn / sv; }
  const z = new Array(N).fill(null), L = 96 * 30; let s = 0, s2 = 0, c = 0; const q = [];
  for (let i = 0; i < N; i++) { if (num[i] == null) continue; if (q.length >= L) { const o = q.shift(); s -= o; s2 -= o * o; c--; } if (c > 500) { const m = s / c, v = Math.max(1e-12, s2 / c - m * m); z[i] = (num[i] - m) / Math.sqrt(v); } q.push(num[i]); s += num[i]; s2 += num[i] * num[i]; c++; }
  return z; }
const fwd = (i, h) => (i + h < N ? (B[i + h].close - B[i].close) / B[i].close * 100 : null);
function study(W, Z, under50) {
  const z = flowSeries(W * 4); const ev = []; let last = -1e9;
  for (let i = 96 * 40; i < N - 96 * 7 - 1; i++) { if (z[i] == null || i - last < 48) continue; if (Math.abs(z[i]) < Z) continue;
    const a = s50.get(Math.floor(B[i].time / 864e5)); const below = a != null && B[i].close < a; if (under50 === true && !below) continue; if (under50 === false && below) continue;
    ev.push({ i, d: z[i] < 0 ? -1 : 1, y: new Date(B[i].time).getUTCFullYear() }); last = i; }
  for (const side of [-1, 1]) { const E = ev.filter((e) => e.d === side); if (E.length < 40) continue;
    const parts = [`flow ${W}h ${side < 0 ? "SELL-heavy" : "BUY-heavy "} |z|>=${Z} ${under50 === true ? "under50d" : under50 === false ? "above50d" : "any"} n=${String(E.length).padStart(3)}`];
    for (const [h, lab] of [[24, "6h"], [96, "24h"], [288, "72h"], [672, "7d"]]) { const fo = E.map((e) => e.d * fwd(e.i, h) - COST).filter((v) => !isNaN(v)); const fa = E.map((e) => -e.d * fwd(e.i, h) - COST).filter((v) => !isNaN(v)); parts.push(`${lab}: follow ${f(avg(fo))} fade ${f(avg(fa))}`); }
    const h = 96, er = eras.map(([a, b]) => { const zz = E.filter((e) => e.y >= a && e.y <= b).map((e) => e.d * fwd(e.i, h) - COST); return zz.length >= 8 ? f(avg(zz)) + "(" + zz.length + ")" : " -"; }).join(" "); parts.push("| follow 24h by era " + er);
    console.log(parts.join("  ")); } }
for (const W of [12, 24, 72]) for (const Z of [1.5, 2]) for (const u of [null, true]) study(W, Z, u);
