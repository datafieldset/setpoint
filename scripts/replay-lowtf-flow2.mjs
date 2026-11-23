// Follow-up: heavy sell flow 24h while under the 50-day -> short, hold 72h. F=<BTC_15m_tb.json> node scripts/replay-lowtf-flow2.mjs
import fs from "fs";
const B = JSON.parse(fs.readFileSync(process.env.F)); const COST = 0.20, N = B.length;
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? "  n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
const dm = new Map(); for (const b of B) dm.set(Math.floor(b.time / 864e5), b.close); const dd = [...dm.entries()].sort((a, b) => a[0] - b[0]), s50 = new Map(); for (let i = 49; i < dd.length; i++) s50.set(dd[i][0] + 1, avg(dd.slice(i - 49, i + 1).map((x) => x[1])));
const net = B.map((b) => 2 * b.tb - b.vol);
const Wb = 96; const num = new Array(N).fill(null); { let sn = 0, sv = 0; for (let i = 0; i < N; i++) { sn += net[i]; sv += B[i].vol; if (i >= Wb) { sn -= net[i - Wb]; sv -= B[i - Wb].vol; } if (i >= Wb - 1) num[i] = sn / sv; } }
const z = new Array(N).fill(null); { const L = 96 * 30; let s = 0, s2 = 0, c = 0; const q = []; for (let i = 0; i < N; i++) { if (num[i] == null) continue; if (q.length >= L) { const o = q.shift(); s -= o; s2 -= o * o; c--; } if (c > 500) { const m = s / c, v = Math.max(1e-12, s2 / c - m * m); z[i] = (num[i] - m) / Math.sqrt(v); } q.push(num[i]); s += num[i]; s2 += num[i] * num[i]; c++; } }
const below = (i) => { const a = s50.get(Math.floor(B[i].time / 864e5)); return a != null && B[i].close < a; };
const H = 288; // 72h
function shortTrade(i, stopPct) { const E = B[i + 1].open; let px = B[Math.min(N - 1, i + 1 + H)].close; if (stopPct) for (let j = i + 1; j <= Math.min(N - 1, i + 1 + H); j++) if (B[j].high >= E * (1 + stopPct / 100)) { px = E * (1 + stopPct / 100); break; } return (E - px) / E * 100 - COST; }
const evs = []; let last = -1e9; for (let i = 96 * 40; i < N - H - 2; i++) { if (z[i] == null || i - last < 48 || z[i] > -1.5 || !below(i)) continue; evs.push(i); last = i; }
const cand = []; for (let i = 96 * 40; i < N - H - 2; i += 8) if (below(i)) cand.push(i);
for (const stop of [0, 3, 5]) { const r = evs.map((i) => ({ r: shortTrade(i, stop), y: new Date(B[i].time).getUTCFullYear() })); const s = r.map((x) => x.r).sort((a, b) => b - a), m = avg(r.map((x) => x.r));
  let c = 0; const D = 3000; for (let d = 0; d < D; d++) { let t = 0; for (let k = 0; k < r.length; k++) t += shortTrade(cand[Math.floor(Math.random() * cand.length)], stop); if (t / r.length >= m) c++; }
  const base = avg(cand.filter((_, k) => k % 7 === 0).map((i) => shortTrade(i, stop)));
  console.log(`SHORT after heavy 24h sell flow under 50d, hold 72h, stop ${stop || "none"}%: n=${r.length} (${(r.length / 9.3).toFixed(0)}/yr) win ${(100 * r.filter((x) => x.r > 0).length / r.length).toFixed(0)}% ${f(m)}% top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} | random short under 50d ${f(base)}% | luck ${(100 * c / D).toFixed(1)}% | eras ${eras.map(([a, b]) => { const z2 = r.filter((x) => x.y >= a && x.y <= b); return z2.length >= 8 ? f(avg(z2.map((x) => x.r))) + "(" + z2.length + ")" : " -"; }).join(" ")}`); }
const recent = evs.filter((i) => B[i].time > Date.UTC(2026, 9, 1)); console.log("events since Oct 1 2026:", recent.map((i) => new Date(B[i].time).toISOString().slice(5, 16) + " " + f(shortTrade(i, 0))).join(", "));
