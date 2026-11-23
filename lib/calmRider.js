// lib/calmRider.js
//
// Calm Rider (v25.2, Nov 22; customers see "Spark"): a Bitcoin buy after a strong up candle, taken ONLY when the market is calm. A public test.
// It is the old Momentum signal's long side (a candle that closes up by the chart's threshold, stop and 2R target from that chart's ATR,
// all straight from computeSignals in lib/signals.js) with one new gate: the hourly ATR (Bitcoin's normal 1 hour swing) must be under 1.2% of price.
// Pure logic, no network or database, like lib/flush.js and lib/flow.js, so the replay and the cron run the same rules.
//
// Evidence (BTC 30 minute and 1 hour charts together, Jan 2020 to Nov 2026, cost 0.20% per trade, memory/overhaul-plan.md Nov 22, scripts/replay-bring-back.mjs):
// Momentum buys as built made +0.04R per trade (650 trades, -0.06R without the best 5%). With the calm gate (hourly ATR under 1.2%): 245 trades (about 37 a year),
// 46% win, +0.21R, +0.12R without the best 5%, halves +0.26 / +0.15, eras +0.15 / +0.44 / +0.21 / +0.09, 4.0% chance by luck. A walk-forward that picked the cutoff each
// year from earlier years only (0.8 / 1.0 / 1.2 / 1.5 / none) gave 136 trades at +0.33R vs +0.10R unfiltered (2022 to 2026); 1.2% was chosen in 2022 to 2024, 0.8% in 2025 and 2026.
// Honest caveats: the idea came from looking at what the volatility filter removed (a lead the walk-forward then supported, not a pre-registered test); 2024 was flat (-0.03R);
// at the shipped 1.2% cutoff the locked exam year (Nov 7 2025 to Nov 6 2026) is weak: 29 trades, +0.06R (the tighter 0.8% cutoff had 12 trades at +0.53R, too few to trust);
// it fires far less often than Momentum did; and the study dropped trades that had not reached the stop or target after 200 bars while live they simply stay open until one is hit.
// The study's 30m and 1h bars carried no volume, so volume is passed as undefined here too (the detector's fire and its levels do not read it).

import { splitBars, precompute } from "./trend.js";
import { computeSignals, thresholdsFor, marketBias, windowPct, reversalRisk } from "./signals.js";

export const CALM_LABEL = "Calm Rider";
export const CALM_TFS = ["1h", "30m"];        // 1h first: the Market Meter row reads the 1 hour chart
export const CALM_COIN = "BTC";               // Bitcoin only: BTC is the test bed
export const CALM_MAX_ATR_PCT = 1.2;          // hourly ATR at the signal must be under this % of price
export const CALM_WINDOW = 300;               // bars handed to the detector, as in the study
export const CALM_MAX_AGE_MS = 20 * 60 * 1000; // a buy is only alerted while its candle is this fresh
export const CALM_DETECTOR_LABEL = "Momentum";
const HOUR = 3600 * 1000;
const BAR_MS = { "1h": HOUR, "30m": 1800 * 1000 };
// Where each chart's bars come from: [candle size in seconds, pages of 300] (the runner fetches exactly these).
export const CALM_SRC = { "1h": [3600, 2], "30m": [900, 2] };

// Finished bars for one chart in the exact shape the detector was studied on.
export function calmBars(tf, candles, now) {
  const src = CALM_SRC[tf];
  if (!src || !candles) return [];
  const sec = BAR_MS[tf] / 1000;
  return splitBars(candles, sec, src[0], now).done.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volumeto: undefined }));
}

// Hourly ATR as a % of price for the hour that closed just before `t` (the signal's own time), or null if unknown.
export function hourAtrPct(hourBars, hourAtr, t) {
  if (!hourBars || !hourAtr) return null;
  const want = Math.floor(t / HOUR) * HOUR - HOUR;
  let i = hourBars.length - 1;
  while (i >= 0 && hourBars[i].time > want) i--;
  if (i < 0 || hourBars[i].time !== want) return null;
  const a = hourAtr[i];
  return a > 0 && hourBars[i].close > 0 ? (a / hourBars[i].close) * 100 : null;
}

// Every Calm Rider buy on a finished bar that is still fresh. `bars` = calmBars() for the chart, `hourBars` = finished 1 hour bars
// (same shape), `now` and `scanMs` as in the other scans. Returns [{ barTime, entry, stop, target, atrPct }], oldest first.
export function calmFires(tf, bars, hourBars, now, scanMs) {
  const baseMs = BAR_MS[tf];
  if (!baseMs || bars.length < 60 || !hourBars || hourBars.length < 30) return [];
  const th = thresholdsFor(tf);
  const hatr = precompute(hourBars).atr;
  const out = [];
  const age = Math.min(scanMs, CALM_MAX_AGE_MS);
  for (let i = bars.length - 1; i >= 1; i--) {
    const end = bars[i].time + baseMs;
    if (end <= now - age) break;                       // older than the scan window
    if (end > now) continue;                           // not finished yet (cannot happen for finished bars, kept as a guard)
    if (bars[i - 1].time !== bars[i].time - baseMs) continue; // feed gap right before this bar
    const slice = bars.slice(Math.max(0, i - CALM_WINDOW + 1), i + 1);
    let sig;
    try {
      const bias = marketBias([{ sym: "BTC", pct: windowPct(slice, 8), isBTC: true }]);
      ({ signals: sig } = computeSignals(slice, tf, th, { now: end, marketBias: bias, reversalRisk: reversalRisk(bias, null) }));
    } catch { continue; }
    const s = (sig || []).find((x) => x.label === CALM_DETECTOR_LABEL && x.dir === "bull" && x.stop > 0 && x.target > 0);
    if (!s) continue;
    const ap = hourAtrPct(hourBars, hatr, end);
    if (ap == null || !(ap < CALM_MAX_ATR_PCT)) continue;
    const entry = bars[i].close;
    if (!(s.stop < entry && s.target > entry)) continue;
    out.push({ barTime: bars[i].time, entry, stop: s.stop, target: s.target, atrPct: Number(ap.toFixed(2)) });
  }
  return out.reverse();
}
