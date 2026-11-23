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
    rows.push({ size: (b.open - b.low) / b.open * 100, t: B[fill].time, y: new Date(B[fill].time).getUTCFullYear(), r, atrPct: atr / b.close * 100 });
  } return rows;
}
const rows = rowsFor(1.5);
const show = (name, z) => { const s = z.map((x) => x.r).sort((a, b) => b - a); const yrs = {}; z.forEach((x) => (yrs[x.y] = (yrs[x.y] || 0) + 1)); const pos = [...new Set(z.map((x) => x.y))].filter((y) => avg(z.filter((x) => x.y === y).map((x) => x.r)) > 0).length, ny = new Set(z.map((x) => x.y)).size; console.log(`${name.padEnd(46)} n=${String(z.length).padStart(3)} (${(z.length / 9.3).toFixed(0)}/yr) win ${(100 * z.filter((x) => x.r > 0).length / z.length).toFixed(0)}% ${f(avg(z.map((x) => x.r)))}R minus best 5% ${f(avg(s.slice(Math.floor(s.length * 0.05))))} | years positive ${pos} of ${ny} | last 3 yrs n=${z.filter((x) => x.y >= 2024).length} ${f(avg(z.filter((x) => x.y >= 2024).map((x) => x.r)))}`); };
show("live Bounce today (flush 2.5%, any volatility)", rows.filter((x) => x.size >= 2.5));
show("flush 1.5% + hourly swing 1.5%+", rows.filter((x) => x.atrPct >= 1.5));
show("UNION: 2.5% any OR 1.5% + swing 1.5%+", rows.filter((x) => x.size >= 2.5 || x.atrPct >= 1.5));
show("flush 1.5% + swing 1.2%+", rows.filter((x) => x.atrPct >= 1.2));
show("UNION: 2.5% any OR 1.5% + swing 1.2%+", rows.filter((x) => x.size >= 2.5 || x.atrPct >= 1.2));
show("flush 2.0% + swing 1.5%+", rows.filter((x) => x.size >= 2.0 && x.atrPct >= 1.5));
