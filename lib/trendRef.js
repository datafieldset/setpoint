// lib/trendRef.js
//
// What the EXACT live rules did on history, per timeframe, shown beside the
// live scoreboard so a new trader can compare real results with the test.
// Produced by replaying lib/trend.js (the same code the cron runs) over
// Coinbase candles on Oct 13 2026: 4h and 1h over 6 years, 30m and 15m over
// 1 year, 5m over 6 months, 1m over 62 days. Win rate counts any trade that
// ends above zero. Short windows are weak evidence (see the trade counts).
export const TREND_REF = {
  "4h": { buys: { winPct: 44, avgR: 0.51, trades: 43, window: "6 years" }, sells: { winPct: 34, avgR: 0.03, trades: 102, window: "6 years" } },
  "1h": { buys: { winPct: 39, avgR: 0.3, trades: 162, window: "6 years" }, sells: { winPct: 38, avgR: 0.08, trades: 299, window: "6 years" } },
  "30m": { buys: { winPct: 24, avgR: 0.1, trades: 38, window: "1 year" }, sells: { winPct: 38, avgR: 0.08, trades: 152, window: "1 year" } },
  "15m": { buys: { winPct: 45, avgR: 0.29, trades: 47, window: "1 year" }, sells: { winPct: 38, avgR: 0.09, trades: 230, window: "1 year" } },
  "5m": { buys: { winPct: 40, avgR: 0.29, trades: 105, window: "6 months" }, sells: { winPct: 42, avgR: 0.1, trades: 260, window: "6 months" } },
  "1m": { buys: { winPct: 42, avgR: 0.19, trades: 483, window: "2 months" }, sells: { winPct: 39, avgR: 0.21, trades: 87, window: "2 months" } },
};
