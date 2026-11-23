// Trailing-exit low-timeframe study (Nov 22). F=<BTC_15m_full.json> node scripts/replay-lowtf-trail.mjs
import fs from "fs";
const B = JSON.parse(fs.readFileSync(process.env.F)); const H = 3600e3, COST = +(process.env.COST ?? 0.2);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? " n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
function atrOf(B, n = 14) { const o = []; let a = null; B.forEach((b, i) => { const tr = i ? Math.max(b.high - b.low, Math.abs(b.high - B[i - 1].close), Math.abs(b.low - B[i - 1].close)) : b.high - b.low; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i < n ? null : a); }); return o; }
const atr = atrOf(B);
const HB = (() => { const m = new Map(); for (const b of B) { const h = Math.floor(b.time / H) * H; const x = m.get(h); if (!x) m.set(h, { time: h, high: b.high, low: b.low, close: b.close, open: b.open }); else { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); x.close = b.close; } } return [...m.values()].sort((a, b) => a.time - b.time); })();
const ha = atrOf(HB), hp = new Map(HB.map((b, i) => [b.time, ha[i] ? ha[i] / b.close * 100 : null]));
const hourPct = (t) => hp.get(Math.floor(t / H) * H - H);
const eras = [[2017, 2019], [2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]];
function run(dir, look, m, G, H1G) {
  const out = []; let free = 0;
  for (let i = look + 20; i < B.length - 1; i++) {
    if (i < free) continue; const a = atr[i]; if (!a || a / B[i].close * 100 < G) continue;
    if (H1G != null) { const h = hourPct(B[i].time); if (h == null || h < H1G) continue; }
    let ex = dir > 0 ? -1e18 : 1e18; for (let j = i - look; j < i; j++) ex = dir > 0 ? Math.max(ex, B[j].high) : Math.min(ex, B[j].low);
    if (!(dir > 0 ? B[i].close > ex : B[i].close < ex)) continue;
    const E = B[i + 1].open, risk = 2 * a; let stop = E - dir * risk, best = E, end = null, px = null;
    for (let j = i + 1; j < B.length; j++) {
      if (dir > 0 ? B[j].low <= stop : B[j].high >= stop) { px = stop; end = j; break; }
      best = dir > 0 ? Math.max(best, B[j].high) : Math.min(best, B[j].low);
      const t = best - dir * m * a; stop = dir > 0 ? Math.max(stop, t) : Math.min(stop, t);
    }
    if (end == null) continue;
    out.push({ r: dir * (px - E) / risk - COST / 100 * E / risk, t: B[i + 1].time, t2: B[end].time, y: new Date(B[i + 1].time).getUTCFullYear() }); free = end + 8;
  }
  return out;
}
// big 72h moves (8%+ close-to-close extremes) for coverage
const big = []; for (let i = 288; i < B.length; i += 96) { const w = B.slice(i - 288, i); const hi = Math.max(...w.map((b) => b.high)), lo = Math.min(...w.map((b) => b.low)); const hiI = w.findIndex((b) => b.high === hi), loI = w.findIndex((b) => b.low === lo); if (Math.abs(hi / lo - 1) >= 0.08) big.push({ t0: w[Math.min(hiI, loI)].time, t1: w[Math.max(hiI, loI)].time, dir: hiI < loI ? -1 : 1 }); }
const uniq = []; for (const b of big) if (!uniq.length || b.t0 - uniq[uniq.length - 1].t1 > 3 * 864e5) uniq.push(b);
console.log("big 72h swings (8%+):", uniq.length);
for (const dir of [1, -1]) for (const m of [3, 4, 6]) for (const [G, H1G] of [[0, null], [0.5, null], [0, 1.5]]) {
  const tr = run(dir, 96, m, G, H1G); if (tr.length < 30) continue;
  const mean = avg(tr.map((x) => x.r)), s = tr.map((x) => x.r).sort((a, b) => b - a), cov = uniq.filter((u) => u.dir === -dir || true).filter((u) => tr.some((x) => x.dir !== 0 && x.t < u.t1 && x.t2 > u.t0)).length;
  console.log(`${dir > 0 ? "LONG " : "SHORT"} look96 trail${m}ATR atr>=${G}% h1>=${H1G ?? "-"} n=${tr.length} win ${(100 * tr.filter((x) => x.r > 0).length / tr.length).toFixed(0)}% ${f(mean)}R top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} | ${eras.map(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : "-"; }).join(" ")} | covers ${cov}/${uniq.length} swings`);
}
