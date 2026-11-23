// Fade study (Na, Nov 22: "if it loses 70-80%, the opposite is the winner"). Take each 15m 96-bar breakout and trade the OPPOSITE side.
// F=<BTC_15m_full.json> COST=0.2 node scripts/replay-lowtf-fade.mjs  Stop S ATR against the fade, target k R, 8-bar pause.
import fs from "fs";
const B = JSON.parse(fs.readFileSync(process.env.F)); const COST = +(process.env.COST ?? 0.2);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? " n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
function atrOf(B, n = 14) { const o = []; let a = null; B.forEach((b, i) => { const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i < n ? null : a); }); return o; }
const atr = atrOf(B), eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
function run(bd, S, k, G) { // bd = breakout direction; we trade -bd
  const dir = -bd, out = []; let free = 0;
  for (let i = 120; i < B.length - 1; i++) {
    if (i < free) continue; const a = atr[i]; if (!a || a / B[i].close * 100 < G) continue;
    let ex = bd > 0 ? -1e18 : 1e18; for (let j = i - 96; j < i; j++) ex = bd > 0 ? Math.max(ex, B[j].high) : Math.min(ex, B[j].low);
    if (!(bd > 0 ? B[i].close > ex : B[i].close < ex)) continue;
    const E = B[i + 1].open, risk = S * a, stop = E - dir * risk, tgt = E + dir * k * risk; let r = null, end = null;
    for (let j = i + 1; j < Math.min(B.length, i + 400); j++) { if (dir > 0 ? B[j].low <= stop : B[j].high >= stop) { r = -1; end = j; break; } if (dir > 0 ? B[j].high >= tgt : B[j].low <= tgt) { r = k; end = j; break; } }
    if (r == null) continue; out.push({ r: r - COST / 100 * E / risk, y: new Date(B[i + 1].time).getUTCFullYear() }); free = end + 8;
  }
  return out;
}
console.log("cost", COST + "%");
for (const bd of [1, -1]) for (const [S, k] of [[2, 1], [2, 2], [2, 3], [1, 1], [3, 1]]) for (const G of [0, 0.5]) {
  const tr = run(bd, S, k, G); if (tr.length < 30) continue; const s = tr.map((x) => x.r).sort((a, b) => b - a);
  console.log(`fade the ${bd > 0 ? "UP breakout (go short)" : "DOWN breakdown (go long)"} stop ${S}ATR target ${k}R atr>=${G}% n=${tr.length} win ${(100 * tr.filter((x) => x.r > 0).length / tr.length).toFixed(0)}% ${f(avg(tr.map((x) => x.r)))}R top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} | ${eras.map(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : "-"; }).join(" ")}`);
}
