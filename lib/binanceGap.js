// lib/binanceGap.js (v20.1, Oct 29)
//
// Rebound Rider's 5 minute filter on Bitcoin: skip a trade when Coinbase's price has run ahead of Binance's, in the
// trade's own direction. Replay study on 1,156 BTC trades (memory/lessons-learned.md, Oct 29): trades with the gap at
// or below zero won 61.4% (+0.075R), trades above zero won 53.2% (-0.069R), same story in both halves of the six months
// and in all three thirds.
//
// The gap, in plain words: the Coinbase close divided by the Binance close, minus 1, on the last finished 5 minute bar,
// compared with its own average over the 60 bars before it (a z-score). Positive means Coinbase is richer than usual,
// signed so that a positive number always means "ahead in the direction of the trade".
//
// Prices come from Binance's market-data-only mirror (data-api.binance.vision). binance.com itself refuses US servers.
// If the mirror can't be reached, or any bar is missing, the filter is simply OFF for that run and the rule behaves as it
// did before (fail open). A failed fetch is never allowed to block a trade or break the scan.
const URL = "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=240";
const KEEP_MS = 60 * 1000;
export const GAP_LOOKBACK = 60;
let memo = { at: 0, map: null };

// Map of 5 minute bar open time (ms) -> Binance close, or null when unavailable.
export async function getBinance5m(fetchFn = fetch, now = Date.now()) {
  if (memo.map && now - memo.at < KEEP_MS) return memo.map;
  try {
    const r = await fetchFn(URL, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length < GAP_LOOKBACK + 2) return null;
    const map = new Map(raw.map((k) => [Number(k[0]), Number(k[4])]));
    memo = { at: now, map };
    return map;
  } catch {
    return null;
  }
}

// Unsigned gap z-score for the bar that opens at `barTime`, or null if there isn't a full, contiguous history.
// `bars` are completed Coinbase 5 minute bars ({ time (ms), close }), ascending.
export function gapAt(bars, binMap, barTime, barMs = 300000) {
  if (!binMap) return null;
  const idx = bars.findIndex((b) => b.time === barTime);
  if (idx < GAP_LOOKBACK) return null;
  const p = [];
  for (let k = 0; k <= GAP_LOOKBACK; k++) {
    const b = bars[idx - k];
    if (!b || b.time !== barTime - k * barMs) return null;
    const bn = binMap.get(b.time);
    if (!bn) return null;
    p.push(b.close / bn - 1);
  }
  const rest = p.slice(1);
  const mean = rest.reduce((s, x) => s + x, 0) / rest.length;
  const sd = Math.sqrt(rest.reduce((s, x) => s + (x - mean) ** 2, 0) / rest.length);
  return (p[0] - mean) / (sd + 1e-12);
}
