// lib/flowFeed.js (v25.1)
//
// Binance's market-data-only mirror (data-api.binance.vision; binance.com itself refuses US servers) is the only free source of
// taker-buy volume, which Flow Rider (lib/flow.js) needs. Coinbase candles do not carry it. If any page fails or the data has a hole
// the result is null and Flow Rider simply does not fire that run (fail closed: a missing feed must never invent a trade).
import { FLOW_BAR_MS, FLOW_NEED_BARS } from "./flow.js";

const BASE = "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT";
const KEEP_MS = 60 * 1000;
let memo = { at: 0, data: null };

async function page(fetchFn, interval, limit, endTime) {
  const r = await fetchFn(`${BASE}&interval=${interval}&limit=${limit}&endTime=${endTime}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error("feed " + r.status);
  const raw = await r.json();
  if (!Array.isArray(raw)) throw new Error("bad feed");
  return raw;
}

// { k15: [{ time, open, high, low, close, vol, tb }], days: [{ time, close }] } (the last bar of each is still forming), or null.
export async function getFlowData(fetchFn = fetch, now = Date.now()) {
  if (memo.data && now - memo.at < KEEP_MS) return memo.data;
  try {
    const pages = Math.ceil(FLOW_NEED_BARS / 1000) + 1;
    const top = Math.floor(now / FLOW_BAR_MS) * FLOW_BAR_MS + FLOW_BAR_MS - 1;
    const reqs = [page(fetchFn, "1d", 70, now)];
    for (let k = 0; k < pages; k++) reqs.push(page(fetchFn, "15m", 1000, top - k * 1000 * FLOW_BAR_MS));
    const [d, ...rest] = await Promise.all(reqs);
    const map = new Map();
    for (const raw of rest) for (const x of raw) map.set(Number(x[0]), { time: Number(x[0]), open: +x[1], high: +x[2], low: +x[3], close: +x[4], vol: +x[5], tb: +x[9] });
    const k15 = [...map.values()].sort((a, b) => a.time - b.time);
    const days = d.map((x) => ({ time: Number(x[0]), close: +x[4] }));
    if (k15.length < FLOW_NEED_BARS || days.length < 55) return null;
    memo = { at: now, data: { k15, days } };
    return memo.data;
  } catch {
    return null;
  }
}
