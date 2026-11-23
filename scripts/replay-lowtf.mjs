// Lower-timeframe study (Nov 22, rules in memory/overhaul-plan.md BEFORE running). BTC 15m, Aug 2017 to now.
// Usage: F=<BTC_15m_full.json> node scripts/replay-lowtf.mjs
import fs from "fs";
const rows = JSON.parse(fs.readFileSync(process.env.F));
const COST = 0.20, H = 3600e3;
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const f = (v) => (isNaN(v) ? " n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
function atrOf(B, n = 14) { const o = []; let a = null; B.forEach((b, i) => { const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i < n ? null : a); }); return o; }
function agg(B, k) { const o = []; for (let i = 0; i + k <= B.length; i += k) { const s = B.slice(i, i + k); o.push({ time: s[0].time, open: s[0].open, high: Math.max(...s.map((x) => x.high)), low: Math.min(...s.map((x) => x.low)), close: s[k - 1].close }); } return o; }
// hourly ATR% regime known at the end of the last COMPLETED hour, mapped onto 15m bars
const HB = (() => { const m = new Map(); for (const b of rows) { const h = Math.floor(b.time / H) * H; const x = m.get(h); if (!x) m.set(h, { time: h, open: b.open, high: b.high, low: b.low, close: b.close }); else { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); x.close = b.close; } } return [...m.values()].sort((a, b) => a.time - b.time); })();
const hatr = atrOf(HB), hAtrPct = new Map(HB.map((b, i) => [b.time, hatr[i] ? hatr[i] / b.close * 100 : null]));
const hourPct = (t) => hAtrPct.get(Math.floor(t / H) * H - H);
const TFS = { "15m": rows, "30m": agg(rows, 2) };
const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
function sim(B, atr, i, dir, k, stopAtr) {
  const a = atr[i]; if (!a || i + 1 >= B.length) return null;
  const E = B[i + 1].open, risk = stopAtr * a, stop = E - dir * risk, tgt = E + dir * k * risk;
  for (let j = i + 1; j < Math.min(B.length, i + 400); j++) {
    if (dir > 0 ? B[j].low <= stop : B[j].high >= stop) return { r: -1 - COST / 100 * E / risk, end: j, t: B[i + 1].time };
    if (dir > 0 ? B[j].high >= tgt : B[j].low <= tgt) return { r: k - COST / 100 * E / risk, end: j, t: B[i + 1].time };
  }
  return null;
}
function run(B, atr, dir, look, k, G, H1G, pause = 8) {
  const out = []; let free = 0;
  for (let i = look + 20; i < B.length - 1; i++) {
    if (i < free) continue; const a = atr[i]; if (!a) continue;
    if (a / B[i].close * 100 < G) continue;
    if (H1G != null) { const h = hourPct(B[i].time); if (h == null || h < H1G) continue; }
    let ex = dir > 0 ? -1e18 : 1e18; for (let j = i - look; j < i; j++) ex = dir > 0 ? Math.max(ex, B[j].high) : Math.min(ex, B[j].low);
    if (!(dir > 0 ? B[i].close > ex : B[i].close < ex)) continue;
    const r = sim(B, atr, i, dir, k, 2); if (!r) continue; out.push({ ...r, y: new Date(r.t).getUTCFullYear(), i }); free = r.end + pause;
  }
  return out;
}
function luck(B, atr, dir, k, G, H1G, n, draws = 150) {
  const cand = []; for (let i = 40; i < B.length - 1; i++) { if (!atr[i] || atr[i] / B[i].close * 100 < G) continue; if (H1G != null) { const h = hourPct(B[i].time); if (h == null || h < H1G) continue; } cand.push(i); }
  const ms = []; for (let d = 0; d < draws; d++) { const taken = [], busy = []; for (let c = 0; c < n * 4 && taken.length < n; c++) { const i = cand[Math.floor(Math.random() * cand.length)]; if (busy.some(([s, e]) => i >= s && i < e)) continue; const r = sim(B, atr, i, dir, k, 2); if (!r) continue; taken.push(r.r); busy.push([i, r.end + 8]); } if (taken.length >= n * 0.8) ms.push(avg(taken)); } return ms;
}
const NOW = Date.now(), WK = NOW - 28 * 864e5;
for (const [tf, B] of Object.entries(TFS)) {
  const atr = atrOf(B);
  for (const dir of [1, -1]) for (const look of [48, 96]) for (const [G, H1G] of [[0, null], [0.5, null], [0.75, null], [0, 1.5], [0.5, 1.5]]) for (const k of [2, 3]) {
    const tr = run(B, atr, dir, look, k, G, H1G); if (tr.length < 30) continue;
    const m = avg(tr.map((x) => x.r)), s = tr.map((x) => x.r).sort((a, b) => b - a), t5 = avg(s.slice(Math.floor(s.length * 0.05)));
    const era = eras.map(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : "-"; }).join(" ");
    let lk = ""; if (m > 0.1 && tr.length >= 50) { const L = luck(B, atr, dir, k, G, H1G, tr.length); if (L.length) lk = ` luck ${(100 - 100 * L.filter((v) => v < m).length / L.length).toFixed(0)}%`; }
    console.log(`${tf} ${dir > 0 ? "LONG " : "SHORT"} look${look} atr>=${G}% h1>=${H1G ?? "-"} ${k}R n=${tr.length} win ${(100 * tr.filter((x) => x.r > 0).length / tr.length).toFixed(0)}% ${f(m)}R top5-off ${f(t5)} | ${era}${lk}`);
  }
}
