// T41 (Nov 22, plan in memory/overhaul-plan.md): Bounce shape on 15m/30m, long after a flush DOWN, short after a spike UP (mirror).
// Flush = bar moves >= D% from its open AND beyond the prior 48-bar extreme; plan = entry extreme -/+ 0.25 ATR, stop 0.75 ATR beyond, target 3R, fills within 24 bars before stop, 12-bar pause. Cost 0.20%.
import fs from "fs";
const rows = JSON.parse(fs.readFileSync(process.env.F)); const H = 3600e3, COST = 0.2;
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? " n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
function atrOf(B, n = 14) { const o = []; let a = null; B.forEach((b, i) => { const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i < n ? null : a); }); return o; }
function agg(B, k) { const o = []; for (let i = 0; i + k <= B.length; i += k) { const s = B.slice(i, i + k); o.push({ time: s[0].time, open: s[0].open, high: Math.max(...s.map((x) => x.high)), low: Math.min(...s.map((x) => x.low)), close: s[k - 1].close }); } return o; }
const HB = (() => { const m = new Map(); for (const b of rows) { const h = Math.floor(b.time / H) * H; const x = m.get(h); if (!x) m.set(h, { time: h, high: b.high, low: b.low, close: b.close, open: b.open }); else { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); x.close = b.close; } } return [...m.values()].sort((a, b) => a.time - b.time); })();
const ha = atrOf(HB), hp = new Map(HB.map((b, i) => [b.time, ha[i] ? ha[i] / b.close * 100 : null]));
const hourPct = (t) => hp.get(Math.floor(t / H) * H - H);
const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
function trades(B, dir, D, G, H1G) {
  const atr = atrOf(B), out = []; let last = -99;
  for (let i = 60; i < B.length - 2; i++) {
    if (i - last <= 12) continue; const b = B[i];
    let ex = dir > 0 ? 1e18 : -1e18; for (let j = i - 48; j < i; j++) ex = dir > 0 ? Math.min(ex, B[j].low) : Math.max(ex, B[j].high);
    const mv = dir > 0 ? (b.open - b.low) / b.open * 100 : (b.high - b.open) / b.open * 100;
    if (!(mv >= D && (dir > 0 ? b.low < ex : b.high > ex))) continue; last = i;
    const a = atr[i]; if (!a) continue; if (a / b.close * 100 < G) continue; if (H1G != null) { const h = hourPct(b.time); if (h == null || h < H1G) continue; }
    const ext = dir > 0 ? b.low : b.high, E = ext + dir * 0.25 * a, S = ext - dir * 0.75 * a, risk = Math.abs(E - S); if (risk / b.close * 100 < 0.6) continue;
    const T = E + dir * 3 * risk; let fill = -1;
    for (let j = i + 1; j <= Math.min(B.length - 1, i + 24); j++) { if (dir > 0 ? B[j].low <= S : B[j].high >= S) break; if (dir > 0 ? B[j].low <= E : B[j].high >= E) { fill = j; break; } }
    if (fill < 0) continue; let r = null;
    for (let j = fill; j < Math.min(B.length, fill + 400); j++) { const sh = dir > 0 ? B[j].low <= S : B[j].high >= S, th = dir > 0 ? B[j].high >= T : B[j].low <= T; if (sh) { r = -1; break; } if (th) { r = 3; break; } }
    if (r == null) continue; out.push({ r: r - COST / 100 * E / risk, t: b.time, y: new Date(b.time).getUTCFullYear() });
  }
  return out;
}
const sets = { "15m": rows, "30m": agg(rows, 2) };
for (const [tf, B] of Object.entries(sets)) for (const dir of [1, -1]) for (const D of [0.8, 1.2, 1.5]) for (const [G, H1G] of [[0, null], [0.5, null], [0.75, null], [0, 1.5]]) {
  const tr = trades(B, dir, D, G, H1G); if (tr.length < 25) continue;
  const m = avg(tr.map((x) => x.r)), s = tr.map((x) => x.r).sort((a, b) => b - a);
  console.log(`${tf} ${dir > 0 ? "LONG after flush down" : "SHORT after spike up "} move>=${D}% atr>=${G}% h1>=${H1G ?? "-"} n=${tr.length} win ${(100 * tr.filter((x) => x.r > 0).length / tr.length).toFixed(0)}% ${f(m)}R top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} | ${eras.map(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : "-"; }).join(" ")}`);
}
