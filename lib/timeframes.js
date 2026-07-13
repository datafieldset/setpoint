// lib/timeframes.js
// One definition of every timeframe. The 30m bug (Coinbase has no native 30m
// candle) happened because the client and the server each had their own copy of
// this config and only one of them accounted for it. Now there is exactly one.

// Coinbase native granularities (seconds): 60, 300, 900, 3600, 21600, 86400.
// 30m has no native candle, so it is built by merging two 15m candles.
export const TF = {
  "5m": { label: "5m", pctMin: 0.7, gran: 300, aggFactor: 1, cooldownMs: 5 * 60 * 1000 },
  "15m": { label: "15m", pctMin: 1.2, gran: 900, aggFactor: 1, cooldownMs: 15 * 60 * 1000 },
  "30m": { label: "30m", pctMin: 1.7, gran: 900, aggFactor: 2, cooldownMs: 30 * 60 * 1000 },
  "1h": { label: "1h", pctMin: 2.5, gran: 3600, aggFactor: 1, cooldownMs: 60 * 60 * 1000 },
};

export function barMs(tfKey) {
  const t = TF[tfKey] || TF["15m"];
  return t.gran * t.aggFactor * 1000;
}

export function isValidTf(tfKey) {
  return !!TF[tfKey];
}
