// scripts/collect-market.mjs (Nov 23)
//
// Research collector, NOT part of the site. Every INTERVAL seconds for DURATION minutes it saves a small snapshot of four public order books and the
// latest OKX liquidations to JSON lines, so the order-book and liquidation ideas can be tested after a few weeks (there is no free history of either).
// Sources (all public, no keys): Coinbase BTC-USD level 2, Binance spot BTCUSDT depth (data-api mirror), KuCoin futures XBTUSDTM depth (the venue Na trades),
// OKX BTC-USDT-SWAP books, OKX liquidation orders (the last 100, so a poll every minute misses none).
// Per book we store only numbers: best bid/ask, and total size resting within 0.05%, 0.1%, 0.25% and 0.5% of the mid on each side. KuCoin futures sizes are
// in contracts (1 contract = 0.001 BTC), OKX swap sizes in contracts (1 = 0.01 BTC); the others are BTC.
// Output: OUT/market-YYYY-MM-DD.jsonl (one snapshot per line) and OUT/liq-YYYY-MM-DD.jsonl (one liquidation per line, duplicates possible across runs: dedupe by ts+px+sz).
// Usage: OUT=./out DURATION=285 INTERVAL=60 node scripts/collect-market.mjs
import fs from "fs";
const OUT = process.env.OUT || "./out", DURATION = +(process.env.DURATION || 285), INTERVAL = +(process.env.INTERVAL || 60);
fs.mkdirSync(OUT, { recursive: true });
const BANDS = [0.05, 0.1, 0.25, 0.5];
const j = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "setpoint-research" } }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); };
function book(bids, asks) { // bids/asks: [[price, size], ...] best first
  const b = bids.map((x) => [+x[0], +x[1]]), a = asks.map((x) => [+x[0], +x[1]]);
  const bb = b[0][0], ba = a[0][0], mid = (bb + ba) / 2, out = { bb, ba, mid };
  for (const p of BANDS) { const lo = mid * (1 - p / 100), hi = mid * (1 + p / 100); out[`b${p}`] = +b.filter((x) => x[0] >= lo).reduce((s, x) => s + x[1], 0).toFixed(4); out[`a${p}`] = +a.filter((x) => x[0] <= hi).reduce((s, x) => s + x[1], 0).toFixed(4); }
  out.levels = Math.min(b.length, a.length); out.bbSize = b[0][1]; out.baSize = a[0][1];
  return out;
}
const SOURCES = {
  cb: async () => { const d = await j("https://api.exchange.coinbase.com/products/BTC-USD/book?level=2"); return book(d.bids, d.asks); },
  bn: async () => { const d = await j("https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=100"); return book(d.bids, d.asks); },
  kcf: async () => { const d = (await j("https://api-futures.kucoin.com/api/v1/level2/depth20?symbol=XBTUSDTM")).data; return book(d.bids, d.asks); },
  okx: async () => { const d = (await j("https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=50")).data[0]; return book(d.bids, d.asks); },
};
const day = (t) => new Date(t).toISOString().slice(0, 10), seen = new Set();
async function tick() {
  const t = Date.now(), row = { t };
  await Promise.all(Object.entries(SOURCES).map(async ([k, f]) => { try { row[k] = await f(); } catch (e) { row[k] = null; } }));
  fs.appendFileSync(`${OUT}/market-${day(t)}.jsonl`, JSON.stringify(row) + "\n");
  try {
    const d = (await j("https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled")).data[0].details, fresh = [];
    for (const x of d) { const key = x.ts + x.bkPx + x.sz; if (seen.has(key)) continue; seen.add(key); fresh.push({ ts: +x.ts, px: +x.bkPx, sz: +x.sz, side: x.side, pos: x.posSide }); }
    if (fresh.length) fs.appendFileSync(`${OUT}/liq-${day(t)}.jsonl`, fresh.map((x) => JSON.stringify(x)).join("\n") + "\n");
  } catch { /* a missed liquidation poll is fine, the next one overlaps */ }
  return row;
}
const end = Date.now() + DURATION * 60000; let n = 0;
while (Date.now() < end) { const s = Date.now(); const r = await tick(); n++; if (n <= 3 || n % 60 === 0) console.log(new Date().toISOString(), n, Object.keys(SOURCES).map((k) => k + ":" + (r[k] ? "ok" : "fail")).join(" ")); await new Promise((res) => setTimeout(res, Math.max(1000, INTERVAL * 1000 - (Date.now() - s)))); }
console.log("done", n, "snapshots");
