// Gated test of the old hidden signals (plan in memory/overhaul-plan.md Nov 22 evening). Needs bg_5m/15m/30m/1h.json (scripts/replay-background.mjs), BTC_5m.json, BTC_1d.json, BTC_15m_tb.json.
// BG=<folder with BTC_5m.json> BGDIR=<folder with bg_*.json> D1=<BTC_1d.json> TB=<BTC_15m_tb.json> node scripts/replay-gated-old.mjs
import fs from "fs";
const T = await import("../lib/trend.js"), FL = await import("../lib/flow.js");
const COST = 0.20, FAR = Date.now() + 1e12, DAY = 864e5, H = 3600e3;
const c5 = JSON.parse(fs.readFileSync(process.env.BG + "/BTC_5m.json")), d1 = JSON.parse(fs.readFileSync(process.env.D1)), tb = JSON.parse(fs.readFileSync(process.env.TB));
const h1 = T.splitBars(c5, 3600, 300, FAR).done, hatr = T.precompute(h1).atr, hIdx = new Map(h1.map((b, i) => [b.time, i]));
const hourAtrPct = (t) => { const i = hIdx.get(Math.floor(t / H) * H - H); return i != null && hatr[i] ? hatr[i] / h1[i].close * 100 : null; };
const dc = new Map(d1.map((d) => [Math.floor(d.time / DAY) * DAY, d.close])), dkeys = [...dc.keys()].sort((a, b) => a - b);
const a200 = new Map(); for (let i = 200; i < dkeys.length; i++) { let s = 0; for (let j = i - 200; j < i; j++) s += dc.get(dkeys[j]); a200.set(dkeys[i], s / 200); }
const ser = FL.flowSeries(tb), tbIdx = new Map(tb.map((b, i) => [b.time, i]));
const flowAt = (t) => { const i = tbIdx.get(Math.floor(t / 900e3) * 900e3 - 900e3); return i == null ? null : FL.flowZ(ser, tb, i); };
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const eras = [[2020, 2021], [2022, 2022], [2023, 2024], [2025, 2026]], LOCK = Date.UTC(2025, 10, 7), SEC = { "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3 };
function stats(tr, base) {
  const s = tr.map((x) => x.r).sort((a, b) => b - a), half = Math.floor(tr.length / 2), ex = tr.filter((x) => x.tt >= LOCK);
  const m = avg(tr.map((x) => x.r)), h1m = avg(tr.slice(0, half).map((x) => x.r)), h2m = avg(tr.slice(half).map((x) => x.r));
  const eraOk = eras.every(([a, b]) => { const z = tr.filter((x) => x.y >= a && x.y <= b); return z.length < 8 || avg(z.map((x) => x.r)) > 0; });
  let luck = 1; if (base && base.length > tr.length) { let c = 0; for (let d = 0; d < 3000; d++) { let t = 0; for (let k = 0; k < tr.length; k++) t += base[Math.floor(Math.random() * base.length)].r; if (t / tr.length >= m) c++; } luck = c / 3000; }
  return { n: tr.length, win: tr.filter((x) => x.r > 0).length / tr.length, m, top5: avg(s.slice(Math.floor(s.length * 0.05))), h1m, h2m, exn: ex.length, exm: avg(ex.map((x) => x.r)), eraOk, luck };
}
const f = (v) => (isNaN(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
const rows = [];
for (const tf of ["5m", "15m", "30m", "1h"]) {
  const file = `${process.env.BGDIR}/bg_${tf}.json`; if (!fs.existsSync(file)) continue;
  const raw = JSON.parse(fs.readFileSync(file)), keys = new Set(raw.map((x) => x.label + "|" + x.dir));
  for (const k of keys) {
    const [label, dir] = k.split("|");
    const base = raw.filter((x) => x.label === label && x.dir === dir).map((x) => { const t = x.t + SEC[tf], rp = Math.abs(x.entry - x.stop) / x.entry * 100, day = Math.floor(t / DAY) * DAY; return { ...x, tt: t, r: x.r - COST / rp, y: new Date(t).getUTCFullYear(), a1: hourAtrPct(t), above: a200.has(day) ? x.entry > a200.get(day) : null, z: flowAt(t) }; }).filter((x) => x.a1 != null);
    if (base.length < 100) continue;
    const bs = stats(base, null);
    const V = { "V1 volatile": base.filter((x) => x.a1 >= 1.0), "V2 calm": base.filter((x) => x.a1 < 1.0), "V3 trend-aligned": base.filter((x) => x.above != null && (dir === "bull" ? x.above : !x.above)), "V4 flow-against": base.filter((x) => x.z != null && (dir === "bull" ? x.z <= -1 : x.z >= 1)) };
    rows.push({ tf, label, dir, v: "V0 base", ...bs, pass: false });
    for (const [name, tr] of Object.entries(V)) {
      if (tr.length < 50) { rows.push({ tf, label, dir, v: name, n: tr.length, pass: false, small: true }); continue; }
      const s = stats(tr, base);
      const beats = tr.length >= 2 && s.h1m > avg(base.slice(0, Math.floor(base.length / 2)).map((x) => x.r)) && s.h2m > avg(base.slice(Math.floor(base.length / 2)).map((x) => x.r));
      const pass = s.n >= 50 && s.eraOk && s.top5 > 0 && s.h1m > 0 && s.h2m > 0 && s.luck < 0.05 && s.exn > 0 && s.exm > 0 && beats;
      rows.push({ tf, label, dir, v: name, ...s, pass });
    }
  }
}
const cells = rows.filter((r) => r.v !== "V0 base" && !r.small);
console.log(`cells tested (variants with 50+ trades): ${cells.length}; expected luck passes at 5% luck-only: about ${(cells.length * 0.05).toFixed(1)}; passed full bar: ${cells.filter((r) => r.pass).length}`);
for (const r of rows.filter((r) => r.pass)) console.log("PASS", r.tf, r.label, r.dir, r.v, JSON.stringify({ n: r.n, win: +(r.win * 100).toFixed(0), m: +r.m.toFixed(2), top5: +r.top5.toFixed(2), h: [+r.h1m.toFixed(2), +r.h2m.toFixed(2)], exam: [r.exn, +r.exm.toFixed(2)], luck: r.luck }));
console.log("\nTop 12 variants by mean R (n>=50), with base in front:");
for (const r of cells.sort((a, b) => b.m - a.m).slice(0, 12)) { const b = rows.find((x) => x.tf === r.tf && x.label === r.label && x.dir === r.dir && x.v === "V0 base"); console.log(`${r.tf} ${r.label} ${r.dir} ${r.v}: n=${r.n} win ${(r.win * 100).toFixed(0)}% ${f(r.m)}R top5-off ${f(r.top5)} halves ${f(r.h1m)}/${f(r.h2m)} exam n=${r.exn} ${f(r.exm)} erasOK=${r.eraOk} luck ${(r.luck * 100).toFixed(1)}% | base n=${b.n} ${f(b.m)}R`); }
console.log("\nBases that are positive (n>=100):"); for (const r of rows.filter((r) => r.v === "V0 base" && r.m > 0)) console.log(`${r.tf} ${r.label} ${r.dir}: n=${r.n} ${f(r.m)}R top5-off ${f(r.top5)}`);
