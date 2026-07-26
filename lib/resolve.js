// lib/resolve.js
//
// Everything about fetching real Coinbase candles and checking a signal's
// target/stop against them, in one place. This used to be copy-pasted
// across backtest/route.js, backtest/download/route.js, and
// close-alert/route.js separately, three or four copies of the same
// logic. That's exactly why the 1-minute ambiguous-bar fix needed four
// separate edits in one day, any future fix here now only needs to
// happen once.
import { TF, barMs } from "./timeframes.js";

export const HEADERS = { "User-Agent": "setpoint/1.0 (+https://setpoint.app)" };

export function aggregate(candles, gran, factor) {
  if (factor <= 1) return candles;
  const bucketMs = gran * factor * 1000;
  const map = new Map();
  for (const c of candles) {
    const b = Math.floor(c.time / bucketMs) * bucketMs;
    const cur = map.get(b);
    if (!cur) map.set(b, { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volumeto: c.volumeto });
    else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close; // candles are ascending, so last write is the latest close
      cur.volumeto += c.volumeto;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export async function fetchCoinbaseCandles(sym, tfKey) {
  const meta = TF[tfKey] || TF["15m"];
  const url = `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${meta.gran}`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 404 ? "not on Coinbase" : `feed ${r.status}`);
  const raw = await r.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("no data");
  const candles = raw
    .slice()
    .reverse()
    .map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4], volumeto: x[5] }))
    .filter((c) => c.close > 0);
  return meta.aggFactor > 1 ? aggregate(candles, meta.gran, meta.aggFactor) : candles;
}

// When a candle's high and low both touch target and stop, the OHLC data
// alone can't say which happened first. This fetches real 1-minute candles
// covering just that one bar's window and checks them in actual order, a
// real answer instead of assuming the worse outcome. Works the same
// regardless of the alert's own timeframe, 1-minute is finer than all of
// them. Pass a Map as `cache` so multiple signals landing on the same
// ambiguous bar within one run share a single fetch.
export async function fetchMinuteCandles(coin, barStartMs, barEndMs, cache) {
  const key = `${coin}:${barStartMs}`;
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const url = `https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=60&start=${new Date(barStartMs).toISOString()}&end=${new Date(barEndMs).toISOString()}`;
    const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (r.ok) {
      const raw = await r.json();
      if (Array.isArray(raw) && raw.length) result = raw.slice().reverse().map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2] }));
    }
  } catch { /* result stays null, caller falls back */ }
  cache.set(key, result);
  return result;
}

export function resolveFromMinuteCandles(minuteCandles, dir, target, stop) {
  if (!minuteCandles) return null;
  for (const c of minuteCandles) {
    const hitTarget = dir === "bull" ? c.high >= target : c.low <= target;
    const hitStop = dir === "bull" ? c.low <= stop : c.high >= stop;
    if (hitTarget && hitStop) continue; // still ambiguous even at 1-minute, exceedingly rare, keep scanning
    if (hitTarget) return "win";
    if (hitStop) return "loss";
  }
  return null;
}

// Walks a signal forward through candles starting at (or after) firedMs,
// checking each bar for a target/stop touch, drilling into 1-minute data
// on the rare ambiguous bar. Returns "win", "loss", or null (not resolved
// within the given candles).
export async function walkForwardOutcome(candles, firedMs, dir, target, stop, coin, tf, minuteCache) {
  const startIdx = candles.findIndex((c) => c.time >= firedMs);
  if (startIdx === -1) return null;
  for (let j = startIdx; j < candles.length; j++) {
    const c = candles[j];
    const hitTarget = dir === "bull" ? c.high >= target : c.low <= target;
    const hitStop = dir === "bull" ? c.low <= stop : c.high >= stop;
    if (hitTarget && hitStop) {
      const minuteCandles = await fetchMinuteCandles(coin, c.time, c.time + barMs(tf), minuteCache);
      return resolveFromMinuteCandles(minuteCandles, dir, target, stop) || "loss";
    }
    if (hitTarget) return "win";
    if (hitStop) return "loss";
  }
  return null;
}
