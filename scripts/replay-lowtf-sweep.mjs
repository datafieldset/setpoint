// Sweep reversal and chop-regime study (plan in memory/overhaul-plan.md Nov 22). F=<BTC_15m_full.json> node scripts/replay-lowtf-sweep.mjs
import fs from "fs";
const B = JSON.parse(fs.readFileSync(process.env.F)); const H = 3600e3, COST = +(process.env.COST ?? 0.2);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? " n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
function atrOf(B, n = 14) { const o = []; let a = null; B.forEach((b, i) => { const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i < n ? null : a); }); return o; }
const atr = atrOf(B); const HB = (() => { const m = new Map(); for (const b of B) { const h = Math.floor(b.time / H) * H; const x = m.get(h); if (!x) m.set(h, { time: h, high: b.high, low: b.low, close: b.close, open: b.open }); else { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); x.close = b.close; } } return [...m.values()].sort((a, b) => a.time - b.time); })();
const ha = atrOf(HB), hp = new Map(HB.map((b, i) => [b.time, ha[i] ? ha[i] / b.close * 100 : null])), hourPct = (t) => hp.get(Math.floor(t / H) * H - H);
const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
const fmt = (name, tr) => { if (tr.length < 30) return console.log(name.padEnd(52), "n=" + tr.length); const s = tr.map((x) => x.r).sort((a, b) => b - a); console.log(`${name.padEnd(52)} n=${String(tr.length).padStart(4)} win ${(100 * tr.filter((x) => x.r > 0).length / tr.length).toFixed(0)}% ${f(avg(tr.map((x) => x.r)))}R top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} | ${eras.map(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : "-"; }).join(" ")}`); };
function trade(i, dir, E, S, k) { const risk = Math.abs(E - S), tgt = E + dir * k * risk; for (let j = i + 1; j < Math.min(B.length, i + 400); j++) { if (dir > 0 ? B[j].low <= S : B[j].high >= S) return { r: -1 - COST / 100 * E / risk, end: j, y: new Date(B[i + 1].time).getUTCFullYear() }; if (dir > 0 ? B[j].high >= tgt : B[j].low <= tgt) return { r: k - COST / 100 * E / risk, end: j, y: new Date(B[i + 1].time).getUTCFullYear() }; } return null; }
// (A) sweep reversal
function sweep(k, minWick, H1G) { const out = []; let free = 0;
  for (let i = 120; i < B.length - 2; i++) { if (i < free) continue; const a = atr[i]; if (!a) continue; if (H1G != null) { const h = hourPct(B[i].time); if (h == null || h < H1G) continue; }
    let hi = -1e18, lo = 1e18; for (let j = i - 96; j < i; j++) { hi = Math.max(hi, B[j].high); lo = Math.min(lo, B[j].low); }
    let dir = 0, wick = 0; if (B[i].high > hi && B[i].close < hi) { dir = -1; wick = B[i].high - hi; } else if (B[i].low < lo && B[i].close > lo) { dir = 1; wick = lo - B[i].low; }
    if (!dir || wick < minWick * a) continue; const E = B[i + 1].open, S = dir < 0 ? B[i].high + 0.25 * a : B[i].low - 0.25 * a; if (Math.abs(E - S) / E * 100 < 0.15) continue;
    const r = trade(i, dir, E, S, k); if (!r) continue; out.push({ ...r, dir }); free = r.end + 4; } return out; }
for (const k of [1.5, 2, 3]) for (const [mw, g] of [[0, null], [0.5, null], [0.5, 1.5]]) { const tr = sweep(k, mw, g); fmt(`SWEEP both ${k}R wick>=${mw}ATR h1>=${g ?? "-"}`, tr); fmt(`   sweep LONG only`, tr.filter((x) => x.dir > 0)); fmt(`   sweep SHORT only`, tr.filter((x) => x.dir < 0)); }
// (B) chop regime: breakouts (96 bar, 2ATR stop, 1R target) outcome history decides follow or fade
function breakoutOutcomes() { const ev = []; let free = 0;
  for (let i = 120; i < B.length - 2; i++) { if (i < free) continue; const a = atr[i]; if (!a) continue; let hi = -1e18, lo = 1e18; for (let j = i - 96; j < i; j++) { hi = Math.max(hi, B[j].high); lo = Math.min(lo, B[j].low); }
    const dir = B[i].close > hi ? 1 : B[i].close < lo ? -1 : 0; if (!dir) continue; const E = B[i + 1].open, S = E - dir * 2 * a, r = trade(i, dir, E, S, 1); if (!r) continue; ev.push({ i, dir, ok: r.r > 0, end: r.end }); free = r.end + 8; } return ev; }
const ev = breakoutOutcomes();
for (const N of [3, 5]) for (const mode of ["fade after fails", "follow after wins"]) { const out = [];
  for (let q = N; q < ev.length; q++) { const last = ev.slice(q - N, q); if (last[N - 1].end >= ev[q].i) continue; const cond = mode === "fade after fails" ? last.every((x) => !x.ok) : last.every((x) => x.ok); if (!cond) continue; const i = ev[q].i, a = atr[i], dir = mode === "fade after fails" ? -ev[q].dir : ev[q].dir; const E = B[i + 1].open, S = E - dir * 2 * a, r = trade(i, dir, E, S, 2); if (r) out.push(r); }
  fmt(`CHOP ${mode}, last ${N} breakouts, 2ATR/2R`, out); }
