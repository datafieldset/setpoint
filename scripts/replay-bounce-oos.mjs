// Out-of-sample check of the Bounce volatility filter on BTC 1h Aug 2017 to Dec 2019 (the filter was found on 2020 to 2026). Binance mirror.
const T = await import("../lib/trend.js"), F = await import("../lib/flush.js");
const out = []; let t = Date.UTC(2017, 7, 17); const END = Date.UTC(2020, 0, 1);
while (t < END) { const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${t}&limit=1000`); const k = await r.json(); if (!k.length) break; for (const x of k) if (x[0] < END) out.push({ time: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], vol: +x[5] }); t = k[k.length - 1][0] + 36e5; if (k.length < 1000) break; }
const B = out, pre = T.precompute(B);
console.log("1h bars", B.length, new Date(B[0].time).toISOString().slice(0, 10), "to", new Date(B[B.length - 1].time).toISOString().slice(0, 10));
const COST = 0.20, avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
function walk(k0, E, S, tgt) { const risk = E - S; for (let k = k0; k < Math.min(B.length, k0 + 600); k++) { if (B[k].low <= S) return -1 - (COST / 100) * E / risk; if (B[k].high >= tgt) return 3 - (COST / 100) * E / risk; } return null; }
function rowsFor(DROP) {
  const rows = []; let last = -1e9;
  for (let i = 60; i < B.length - 1; i++) {
    const b = B[i]; if ((b.open - b.low) / b.open < DROP / 100) continue; let lo = Infinity; for (let j = i - 48; j < i; j++) lo = Math.min(lo, B[j].low); if (!(b.low < lo) || i - last <= F.FLUSH_COOLDOWN) continue; last = i;
    const atr = pre.atr[i]; if (!(atr > 0)) continue; const p = F.flushPlan(b, atr); if (!p) continue;
    let fill = -1; for (let k = i + 1; k <= i + F.FLUSH_WAIT && k < B.length; k++) { if (B[k].low <= p.stop) break; if (B[k].low <= p.entry) { fill = k; break; } }
    if (fill < 0) continue; const r = walk(fill, p.entry, p.stop, p.target); if (r == null) continue;
    rows.push({ t: B[fill].time, r, atrPct: atr / b.close * 100 });
  } return rows;
}
const show = (name, a) => { if (!a.length) return console.log(name, "no trades"); const rs = a.map((x) => x.r), s = rs.slice().sort((p, q) => q - p); const mid = a[Math.floor(a.length / 2)].t; console.log(`${name.padEnd(28)} n=${String(a.length).padStart(3)} win ${(100 * rs.filter((v) => v > 0).length / rs.length).toFixed(0)}% ${f(avg(rs))}R -best5% ${f(avg(s.slice(Math.floor(s.length * 0.05))))} halves ${f(avg(a.filter((x) => x.t < mid).map((x) => x.r)))}/${f(avg(a.filter((x) => x.t >= mid).map((x) => x.r)))}`); };
for (const DROP of [1.5, 2.5]) { const rows = rowsFor(DROP); console.log("\nflush >= " + DROP + "%"); show("no filter", rows); for (const th of [0.8, 1.0, 1.2, 1.5]) show("ATR >= " + th + "%", rows.filter((x) => x.atrPct >= th)); const lowv = rows.filter((x) => x.atrPct < 1.0); show("ATR under 1.0% (skipped)", lowv); }
