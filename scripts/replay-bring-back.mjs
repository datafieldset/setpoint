// Momentum / Reversal watch with gates (plan in memory/overhaul-plan.md Nov 22 evening). Needs bg_30m.json, bg_1h.json (scripts/replay-background.mjs), BTC_5m.json, BTC_1d.json, BTC_15m_tb.json.
// BG=<folder with bg_*.json and BTC_5m.json> D1=<BTC_1d.json> TB=<BTC_15m_tb.json> node scripts/replay-bring-back.mjs
import fs from "fs";
const T = await import("../lib/trend.js"), FL = await import("../lib/flow.js");
const BG = process.env.BG, COST = 0.20, FAR = Date.now() + 1e12, DAY = 864e5, H = 3600e3;
const c5 = JSON.parse(fs.readFileSync(BG + "/BTC_5m.json")), d1 = JSON.parse(fs.readFileSync(process.env.D1)), tb = JSON.parse(fs.readFileSync(process.env.TB));
const h1 = T.splitBars(c5, 3600, 300, FAR).done, hatr = T.precompute(h1).atr, hIdx = new Map(h1.map((b, i) => [b.time, i]));
const hourAtrPct = (t) => { const i = hIdx.get(Math.floor(t / H) * H - H); return i != null && hatr[i] ? hatr[i] / h1[i].close * 100 : null; };
const dc = new Map(d1.map((d) => [Math.floor(d.time / DAY) * DAY, d.close])), dkeys = [...dc.keys()].sort((a, b) => a - b);
const a200 = new Map(); { for (let i = 200; i < dkeys.length; i++) { let s = 0; for (let j = i - 200; j < i; j++) s += dc.get(dkeys[j]); a200.set(dkeys[i], s / 200); } }
const ser = FL.flowSeries(tb), tbIdx = new Map(tb.map((b, i) => [b.time, i]));
const flowAt = (t) => { const i = tbIdx.get(Math.floor(t / 900e3) * 900e3 - 900e3); return i == null ? null : FL.flowZ(ser, tb, i); };
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? " n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
const eras = [[2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]], LOCK = Date.UTC(2025, 10, 7), SEC = { "30m": 1800e3, "1h": 3600e3 };
function load(tf, label, dir) { return JSON.parse(fs.readFileSync(`${BG}/bg_${tf}.json`)).filter((x) => x.label === label && x.dir === dir).map((x) => { const t = x.t + SEC[tf], rp = Math.abs(x.entry - x.stop) / x.entry * 100, day = Math.floor(t / DAY) * DAY; return { ...x, tt: t, r: x.r - COST / rp, y: new Date(t).getUTCFullYear(), a1: hourAtrPct(t), above200: a200.has(day) ? x.entry > a200.get(day) : null, z: flowAt(t) }; }); }
function show(name, tr, base) {
  if (tr.length < 25) return console.log(name.padEnd(46), "n=" + tr.length);
  const s = tr.map((x) => x.r).sort((a, b) => b - a), half = Math.floor(tr.length / 2), ex = tr.filter((x) => x.tt >= LOCK);
  let lk = ""; if (base && base.length > tr.length) { let c = 0; const m = avg(tr.map((x) => x.r)); for (let d = 0; d < 5000; d++) { let t = 0; for (let k = 0; k < tr.length; k++) t += base[Math.floor(Math.random() * base.length)].r; if (t / tr.length >= m) c++; } lk = ` luck ${(c / 50).toFixed(1)}%`; }
  console.log(`${name.padEnd(46)} n=${String(tr.length).padStart(3)} win ${(100 * tr.filter((x) => x.r > 0).length / tr.length).toFixed(0)}% ${f(avg(tr.map((x) => x.r)))}R top5-off ${f(avg(s.slice(Math.floor(s.length * 0.05))))} halves ${f(avg(tr.slice(0, half).map((x) => x.r)))}/${f(avg(tr.slice(half).map((x) => x.r)))} exam n=${ex.length} ${f(avg(ex.map((x) => x.r)))} | ${eras.map(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length >= 8 ? f(avg(z.map((x) => x.r))) + "(" + z.length + ")" : " -"; }).join(" ")}${lk}`);
}
for (const [label, dir] of [["Momentum", "bull"], ["Reversal watch", "bull"]]) for (const tf of ["30m", "1h"]) {
  const b = load(tf, label, dir).filter((x) => x.a1 != null);
  console.log(`\n== ${label} ${dir} ${tf}`);
  show("base (as built, cost 0.20%)", b, null);
  const vol = b.filter((x) => x.a1 >= 1.0), tr2 = b.filter((x) => x.above200 === true);
  show("+ volatility gate (hourly ATR >= 1.0%)", vol, b); show("+ trend gate (above 200-day)", tr2, b); show("+ both", b.filter((x) => x.a1 >= 1.0 && x.above200 === true), b);
  show("  NOT volatility (ATR < 1.0%)", b.filter((x) => x.a1 < 1.0), b);
  if (label === "Reversal watch") { const z = b.filter((x) => x.z != null && x.z <= -1); show("+ heavy 24h selling (flow z <= -1)", z, b); show("+ heavy selling AND volatility", z.filter((x) => x.a1 >= 1.0), b); }
}
// Follow-up (written after seeing the first run, so treat as a lead, not a pass): Momentum bull in CALM markets, 30m and 1h together, thresholds 0.8 / 1.0 / 1.2
{
  const all = [...load("30m", "Momentum", "bull"), ...load("1h", "Momentum", "bull")].filter((x) => x.a1 != null);
  console.log("\n== Momentum bull, 30m + 1h together");
  show("base", all, null);
  for (const g of [0.8, 1.0, 1.2]) show(`calm: hourly ATR < ${g}%`, all.filter((x) => x.a1 < g), all);
}
// Walk-forward on the calm cutoff: each year picks its cutoff from {0.8, 1.0, 1.2, 1.5, none} using only EARLIER years (best mean R, at least 30 trades), then trades that year with it.
{
  const all = [...load("30m", "Momentum", "bull"), ...load("1h", "Momentum", "bull")].filter((x) => x.a1 != null);
  const cuts = [0.8, 1.0, 1.2, 1.5, 99], oos = [], base = [];
  console.log("\n== walk-forward");
  for (let y = 2022; y <= 2026; y++) {
    const past = all.filter((x) => x.y < y); let best = null;
    for (const c of cuts) { const s = past.filter((x) => x.a1 < c); if (s.length >= 30) { const m = avg(s.map((x) => x.r)); if (!best || m > best.m) best = { c, m }; } }
    const now = all.filter((x) => x.y === y), pick = now.filter((x) => x.a1 < best.c); oos.push(...pick); base.push(...now);
    console.log(`${y}: cutoff ${best.c} (past ${f(best.m)}R) -> ${pick.length} of ${now.length} trades, ${f(avg(pick.map((x) => x.r)))}R vs all ${f(avg(now.map((x) => x.r)))}R`);
  }
  show("walk-forward 2022-2026 (out of sample)", oos, base); show("all trades 2022-2026", base, null);
}
