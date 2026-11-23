// Bounce volatility gate, walk-forward on ALL BTC 1h history Aug 2017 to now (Binance mirror). Each test year picks its gate using ONLY earlier years.
const T = await import("../lib/trend.js"), F = await import("../lib/flush.js");
const B = []; let t = Date.UTC(2017, 7, 17);
while (t < Date.now()) { const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${t}&limit=1000`); const k = await r.json(); if (!k.length) break; for (const x of k) B.push({ time: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], vol: +x[5] }); t = k[k.length - 1][0] + 36e5; if (k.length < 1000) break; }
if (B.length && B[B.length - 1].time + 36e5 > Date.now()) B.pop();
const pre = T.precompute(B), COST = 0.20, avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
console.log("1h bars", B.length, new Date(B[0].time).toISOString().slice(0, 10), "to", new Date(B[B.length - 1].time).toISOString().slice(0, 16));
function walk(k0, E, S, tgt) { const risk = E - S; for (let k = k0; k < Math.min(B.length, k0 + 600); k++) { if (B[k].low <= S) return -1 - (COST / 100) * E / risk; if (B[k].high >= tgt) return 3 - (COST / 100) * E / risk; } return null; }
function rowsFor(DROP) {
  const rows = []; let last = -1e9;
  for (let i = 60; i < B.length - 1; i++) {
    const b = B[i]; if ((b.open - b.low) / b.open < DROP / 100) continue; let lo = Infinity; for (let j = i - 48; j < i; j++) lo = Math.min(lo, B[j].low); if (!(b.low < lo) || i - last <= F.FLUSH_COOLDOWN) continue; last = i;
    const atr = pre.atr[i]; if (!(atr > 0)) continue; const p = F.flushPlan(b, atr); if (!p) continue;
    let fill = -1; for (let k = i + 1; k <= i + F.FLUSH_WAIT && k < B.length; k++) { if (B[k].low <= p.stop) break; if (B[k].low <= p.entry) { fill = k; break; } }
    if (fill < 0) continue; const r = walk(fill, p.entry, p.stop, p.target); if (r == null) continue;
    rows.push({ t: B[fill].time, y: new Date(B[fill].time).getUTCFullYear(), r, atrPct: atr / b.close * 100 });
  } return rows;
}
const GATES = [0, 0.8, 1.0, 1.2, 1.5];
for (const DROP of [1.5, 2.5]) {
  const rows = rowsFor(DROP); console.log(`\n===== flush >= ${DROP}% : ${rows.length} trades, unfiltered ${f(avg(rows.map((x) => x.r)))}R =====`);
  console.log("by year (trades, avg R) unfiltered | ATR>=1.2%:");
  for (let y = 2017; y <= 2026; y++) { const a = rows.filter((x) => x.y === y), g = a.filter((x) => x.atrPct >= 1.2); if (a.length) console.log(" ", y, String(a.length).padStart(3), f(avg(a.map((x) => x.r))).padStart(6), "|", String(g.length).padStart(3), g.length ? f(avg(g.map((x) => x.r))).padStart(6) : "     -"); }
  // walk-forward: each year picks the gate (best avg R with 25+ trades) from earlier years only
  const wf = [], base = [], picks = [];
  for (let y = 2019; y <= 2026; y++) {
    const past = rows.filter((x) => x.y < y), test = rows.filter((x) => x.y === y); if (!test.length) continue;
    let best = 0, bv = -9; for (const g of GATES) { const z = past.filter((x) => x.atrPct >= g); if (z.length >= 25 && avg(z.map((x) => x.r)) > bv) { bv = avg(z.map((x) => x.r)); best = g; } }
    picks.push(y + ":" + best); wf.push(...test.filter((x) => x.atrPct >= best)); base.push(...test);
  }
  console.log("walk-forward gates chosen from earlier years only:", picks.join(" "));
  console.log(`  walk-forward (2019 to now): ${wf.length} trades ${f(avg(wf.map((x) => x.r)))}R   vs same years unfiltered: ${base.length} trades ${f(avg(base.map((x) => x.r)))}R`);
  // luck: drop the same share of 2019+ trades at random; how often does random skipping do as well?
  let beat = 0; const S = 2000; for (let s = 0; s < S; s++) { const keep = base.filter(() => true); for (let i = keep.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keep[i], keep[j]] = [keep[j], keep[i]]; } if (avg(keep.slice(0, wf.length).map((x) => x.r)) >= avg(wf.map((x) => x.r))) beat++; }
  console.log(`  luck: random skipping to the same trade count does as well ${(100 * beat / S).toFixed(1)}% of the time`);
  // fixed gates over all nine years
  for (const g of [0, 1.0, 1.2, 1.5]) { const z = rows.filter((x) => x.atrPct >= g), s = z.map((x) => x.r).sort((a, b) => b - a); let beat2 = 0; for (let k = 0; k < 2000; k++) { const sh = rows.map((x) => x.r); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; } if (g && avg(sh.slice(0, z.length)) >= avg(z.map((x) => x.r))) beat2++; }
    console.log(`  all years, gate ATR >= ${g}%: ${z.length} trades, ${(100 * z.filter((x) => x.r > 0).length / z.length).toFixed(0)}% win, ${f(avg(z.map((x) => x.r)))}R, minus best 5% ${f(avg(s.slice(Math.floor(s.length * 0.05))))}${g ? ", chance of this by random picking " + (100 * beat2 / 2000).toFixed(1) + "%" : ""}`); }
}
