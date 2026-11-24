// Replays the LIVE Flow Rider module (lib/flow.js) over all BTC history, one trade at a time, so the shipped rule can be compared with the study (replay-lowtf-flow3.mjs).
// F=<BTC_15m_tb.json> node scripts/replay-flow-live.mjs
import fs from "fs";
const F = await import("../lib/flow.js");
const B = JSON.parse(fs.readFileSync(process.env.F)), N = B.length, COST = 0.2;
const dm = new Map(); for (const b of B) dm.set(Math.floor(b.time / 864e5) * 864e5, b.close); const days = [...dm.entries()].sort((a, b) => a[0] - b[0]).map(([time, close]) => ({ time, close }));
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length, f = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);
const series = F.flowSeries(B), rsi = F.rsiSeries(B), out = []; const USE_RSI = process.env.RSI !== "0"; let free = 0;
for (let i = F.FLOW_BASE_BARS + F.FLOW_WINDOW_BARS; i < N - 2; i++) {
  if (i < free) continue; const z = F.flowZ(series, B, i); if (z == null || z > F.FLOW_Z) continue;
  const a = F.avg50At(days, B[i].time); if (a == null || !(B[i].close < a)) continue; if (USE_RSI && !(rsi[i] > F.FLOW_RSI_MIN)) continue;
  const E = B[i + 1].open, p = F.flowPlan(E), dl = B[i + 1].time + F.FLOW_MAX_HOLD_MS; let px = null, end = i + 1;
  for (let j = i + 1; j < N; j++) { end = j; if (B[j].time >= dl) { px = B[j].open; break; } if (B[j].high >= p.stop) { px = p.stop; break; } if (B[j].low <= p.target) { px = p.target; break; } }
  if (px == null) break; out.push({ r: (E - px) / E * 100 - COST, t: B[i + 1].time, y: new Date(B[i + 1].time).getUTCFullYear() }); free = end + 1;
}
const s = out.map((x) => x.r).sort((a, b) => b - a), half = Math.floor(out.length / 2);
console.log(`live module replay: n=${out.length} win ${(100 * out.filter((x) => x.r > 0).length / out.length).toFixed(0)}% ${f(avg(out.map((x) => x.r)))}% top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} halves ${f(avg(out.slice(0, half).map((x) => x.r)))} / ${f(avg(out.slice(half).map((x) => x.r)))} | ${[[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]].map(([a, b]) => { const q = out.filter((x) => x.y >= a && x.y <= b); return q.length ? f(avg(q.map((x) => x.r))) + "(" + q.length + ")" : "-"; }).join(" ")} | exam year ${(() => { const q = out.filter((x) => x.t >= Date.UTC(2025, 10, 7)); return q.length + " " + f(avg(q.map((x) => x.r))); })()}`);
