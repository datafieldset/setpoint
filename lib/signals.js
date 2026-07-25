// lib/signals.js
// One copy of the indicator math and signal detection. Import this instead of
// redefining RSI/EMA/ATR/computeSignals in more than one place.

import { TF, barMs } from "./timeframes.js";

// The one set of default thresholds. The live dashboard and the research
// backtest both import this, so a backtest result always reflects the exact
// same settings a real user sees, not a second copy that could drift.
export const DEFAULT_TH = { volMult: 2.0, rsiLow: 30, rsiHigh: 70, paceMult: 2.2, accumVolTrend: 1.5 };

/* ----------------------------- indicator math ---------------------------- */
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
// Same math as rsi() above, but returns the full series instead of just the
// latest value. Reversal watch's divergence check needs RSI at a past swing
// point, not just now.
function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
export function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1), out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
export function atr(h, l, c, period = 14) {
  if (c.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < c.length; i++) trs.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}
export function levels(price, atrv, dir) {
  const risk = 1.5 * atrv;
  return dir === "bull"
    ? { entry: price, stop: price - risk, target: price + 2 * risk, rr: 2 }
    : { entry: price, stop: price + risk, target: price - 2 * risk, rr: 2 };
}
// ADX / +DI / -DI, Wilder's original 1978 method. This is the standard,
// widely-used way to tell a trending market from a ranging one: ADX above 25
// means a real trend is in force, below 20 means the market is chopping
// sideways. +DI vs -DI gives which direction that trend is running.
export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n < period * 2 + 1) return null;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const wilderSmooth = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const sTR = wilderSmooth(tr), sPlus = wilderSmooth(plusDM), sMinus = wilderSmooth(minusDM);
  const plusDI = sPlus.map((v, i) => (sTR[i] > 0 ? 100 * v / sTR[i] : 0));
  const minusDI = sMinus.map((v, i) => (sTR[i] > 0 ? 100 * v / sTR[i] : 0));
  const dx = plusDI.map((v, i) => { const s = v + minusDI[i]; return s > 0 ? 100 * Math.abs(v - minusDI[i]) / s : 0; });
  if (dx.length < period) return null;
  let a = dx.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < dx.length; i++) a = (a * (period - 1) + dx[i]) / period;
  return { adx: a, plusDI: plusDI[plusDI.length - 1], minusDI: minusDI[minusDI.length - 1] };
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
const clamp = (x) => Math.max(0, Math.min(1, x));

// Volume is the highest-priority context on every non-volume signal. A move,
// an RSI extreme, or an EMA cross means something different depending on
// whether real volume is behind it. This keeps that judgment inside the
// mechanical signal itself, not just in the AI commentary layer.
function volumeContext(volRatio) {
  if (volRatio >= 1.6) return { tag: "confirmed", boost: 0.18, phrase: `Volume backs it, running ${volRatio.toFixed(1)}x average.` };
  if (volRatio >= 1.15) return { tag: "rising", boost: 0.08, phrase: `Volume is picking up, ${volRatio.toFixed(1)}x average.` };
  if (volRatio <= 0.6) return { tag: "light", boost: -0.18, phrase: `Volume is light, just ${volRatio.toFixed(1)}x average.` };
  return { tag: null, boost: 0, phrase: null };
}

// The backtest showed this plainly: fades that fought a real trend lost badly
// (RSI overbought on 30m: 2W/29L), while the same signals riding the trend or
// firing during a genuine range did well. ADX below 20 means no real trend is
// in force, so no adjustment either way. ADX 20+ means a trend is running;
// a signal agreeing with it gets a boost, a signal fighting it gets a real
// discount, tuned harder than the volume discount given how stark the
// evidence was.
function trendContext(adxResult, signalDir) {
  if (!adxResult || adxResult.adx < 20) return { tag: null, boost: 0, phrase: null };
  const trendDir = adxResult.plusDI > adxResult.minusDI ? "bull" : "bear";
  const trendWord = trendDir === "bull" ? "uptrend" : "downtrend";
  if (signalDir === trendDir) {
    return { tag: "with", boost: 0.12, phrase: `Riding the ${trendWord}, ADX ${adxResult.adx.toFixed(0)}.` };
  }
  return { tag: "against", boost: -0.22, phrase: `Fighting the ${trendWord}, ADX ${adxResult.adx.toFixed(0)}.` };
}

// This is the highest-confidence context of all: actual measured outcomes,
// not a proxy. Updated by hand as fresh backtest runs come in, not a static
// one-time table. Each entry stores the win rate from the most recent
// backtest run that had a real sample (5+ fires) for that exact combo.
// 58% is the bar: at or above shows as PROVEN (visible by default on the
// dashboard), below shows as TESTED (hidden behind the toggle, but the
// percentage is shown so it's clear how far off it is, not just "weak").
// A combo with no entry here has never had a clean enough sample to judge.
//
// Last updated from the Jul 21 07:22 backtest run (single run, not yet
// averaged across multiple runs, since this is the first run under the new
// per-condition tracking). EMA cross up 30m bull and RSI oversold 15m bull
// (the original two proven signals) did not have a clean 58%+ baseline
// sample in that run, so they're marked needsRetest instead of carrying
// forward a stale number from before the tracking rebuild.
// This table is built from every backtest run collected so far, not just
// the first one. Where a combo has multiple consistent runs, the rate is
// averaged; where a newer, larger sample disagrees with an older, smaller
// one, the larger sample wins, small samples are noise until proven
// otherwise. Reversal watch is deliberately left out entirely: the
// confirmation-gate rebuild only fired 1-2 times per combo in its first
// run, nowhere near enough to score honestly yet.
export const SIGNAL_RATES = {
  // Weak but real and consistent across 3 runs (25%, 0%, 0%), not enough
  // reason to keep calling this needsRetest, the data already answered it.
  "EMA cross up|30m|bull": { rate: 0.10, runs: 3 },
  "EMA cross up|1h|bull": { rate: null, needsRetest: true }, // had partial condition-split data early on (40% aligned-w-bias, n=18) but never got a clean baseline entry — genuine gap in table-building, not missing data
  "RSI oversold|15m|bull": { rate: null, needsRetest: true },
  // Never had an entry at all despite 2 consistent runs (10%, 15%) sitting
  // right there in past backtests, found on a full audit, not new data.
  "RSI oversold|30m|bull": { rate: 0.15, runs: 2 },
  // Conflicting reads: 59% on a clean 22-sample run, but a 13% sub-slice
  // showed up in a later run's no-bias breakdown. Not confident enough to
  // call this proven until it's retested cleanly.
  "EMA cross up|5m|bull": { rate: null, needsRetest: true },
  // Consistent across three separate runs: 67%, 64%, 60%. Averaged, this
  // is the most reliable read we have of any signal so far.
  "Volume spike|15m|bull": { rate: 0.64, runs: 3 },
  "EMA cross down|1h|bear": { rate: 0.20, runs: 2 }, // 19% and 21%, consistent
  "Volume spike|30m|bull": { rate: 0.28, runs: 1 },
  // Updated from an older 30% single-run read, later blended with live
  // data below.
  // Blended with live data below.
  "EMA cross down|30m|bear": { rate: 0.00, runs: 2 }, // 0% twice, consistent
  "RSI overbought|30m|bear": { rate: null, needsRetest: true },
  // Only fired in one run so far, during a visibly bullish market, and
  // didn't fire enough to register at all in the next run. Real number,
  // but likely regime-dependent, watch whether it holds up in a
  // different market condition before trusting it as proven long-term.
  "RSI oversold|1h|bull": { rate: 0.71, runs: 1 },
  // Blended with live data below.
  "RSI overbought|1h|bear": { rate: 0.24, runs: 1 },
  "EMA cross down|5m|bear": { rate: 0.17, runs: 1, source: "live" }, // 6 fired
  
  // --- Below this line: numbers pulled from the live scoreboard
  // (/api/scoreboard), real signals that actually fired and resolved
  // against real price, not a historical replay. Where a combo already had
  // a backtest number above, the two are blended, weighted by sample size,
  // real trades count for more than a replay when there's enough of them.
  "Volume spike|5m|bull": { rate: 0.90, runs: 1, source: "live" }, // 10 fired, strongest live number so far
  "RSI oversold|5m|bull": { rate: 0.75, runs: 1, source: "live" }, // 8 fired
  "Quiet accumulation|30m|bull": { rate: 0.80, runs: 1, source: "live" }, // 5 fired
  "Quiet accumulation|5m|bull": { rate: 0.75, runs: 1, source: "live" }, // 20 fired, solid sample
  // Same signal, wildly different reliability by timeframe: strong on 5m
  // and 30m, weak on 15m, and this 1h number is a real, sizable warning.
  "Quiet accumulation|15m|bull": { rate: 0.40, runs: 1, source: "live" }, // 20 fired
  "Quiet accumulation|1h|bull": { rate: 0.11, runs: 1, source: "live" }, // 18 fired
  // Volume building early: a real, striking split. Every bull timeframe
  // runs 67-100% (small samples), every bear timeframe sits at 0%. May
  // only be trustworthy on the long side, worth watching as more data
  // comes in rather than fully trusting yet given the small samples.
  "Volume building early|15m|bull": { rate: 0.67, runs: 1, source: "live" }, // 9 fired
  "Volume building early|5m|bear": { rate: 0.00, runs: 1, source: "live" }, // 5 fired, part of a 0% pattern across all 4 bear timeframes (13 fired total)
  "RSI overbought|5m|bear": { rate: 0.00, runs: 1, source: "live" }, // 9 fired
  // Blended with the existing backtest number: backtest had 21% on 26
  // fires, live shows 13% on 8 fires. Weighted toward the larger backtest
  // sample.
  "EMA cross down|15m|bear": { rate: 0.19, runs: 2, source: "blended" },
  // Blended: backtest 19% on ~58 fires, live shows an almost identical
  // 18% on 11 fires, good agreement between two independent sources.
  "RSI overbought|15m|bear": { rate: 0.19, runs: 2, source: "blended" },
  // Blended: backtest 19% on 39 fires, live shows 0% on 11 fires, both
  // weak, weighted toward the larger backtest sample.
  "Volume spike|5m|bear": { rate: 0.15, runs: 2, source: "blended" },

  // --- Found on a full audit (Jul 25): real, consistent data across
  // multiple backtest runs that was sitting unused, never added despite
  // being right there in past reports. Not new data, just late bookkeeping.
  "EMA cross up|15m|bull": { rate: 0.23, runs: 3 }, // 29%, 16%, 25% across 3 runs, weak but consistent
  "Volume spike|1h|bull": { rate: 0.29, runs: 2 }, // 29% both runs, large samples (50, 51 fired)
  "Volume spike|1h|bear": { rate: 0.30, runs: 1 }, // large single-run sample, 61 fired
  "Volume spike|30m|bear": { rate: 0.17, runs: 4 }, // 20%, 11%, 17%, 20% across 4 runs, consistent
  "Volume spike|15m|bear": { rate: 0.18, runs: 3 }, // 17%, 22%, 16% across 3 runs, consistent
  "Volume building early|1h|bear": { rate: 0.40, runs: 1 }, // small sample (5 fired), watch not trust
  "Volume building early|15m|bear": { rate: 0.00, runs: 1 }, // consistent with the rest of this signal's bear side sitting near 0%
  "Volume building early|5m|bull": { rate: 0.49, runs: 2 }, // 47%, 50% across 2 runs
};
const PROVEN_THRESHOLD = 0.58;
export function provenContext(label, tfKey, dir) {
  const key = `${label}|${TF[tfKey]?.label || tfKey}|${dir}`;
  const entry = SIGNAL_RATES[key];
  if (!entry || entry.rate == null) return { tag: null, boost: 0, phrase: null, rate: null };
  if (entry.rate >= PROVEN_THRESHOLD) {
    return { tag: "proven", boost: 0.15, phrase: `This setup has backtested at ${Math.round(entry.rate * 100)}%.`, rate: entry.rate };
  }
  return { tag: "tested", boost: -0.30, phrase: `This setup has backtested at ${Math.round(entry.rate * 100)}%.`, rate: entry.rate };
}

// Every context phrase above is now a complete sentence on its own, so notes
// are built by joining sentences with spaces, not by chaining clauses onto
// commas. Keeps a card readable at a glance instead of one long run-on line.
function joinNote(base, ...phrases) {
  return [base, ...phrases.filter(Boolean)].join(" ");
}

/* ---------------------------- market-wide bias ---------------------------- */
// ADX (trendContext above) answers "is THIS coin trending" and is
// deliberately slow, smoothed over 14 bars so it isn't faked out by noise.
// That's the wrong tool for catching a fresh, multi-hour, market-wide flip
// quickly, exactly the situation that made a proven bull setup lose badly
// after the tape turned bearish. This layer answers a different, faster
// question: which way is the WHOLE watchlist leaning right now.

// Cheap, longer-window % change for one coin. Uses candles already fetched,
// no new data needed. Deliberately reactive: an 8-bar window on whatever
// timeframe is active, roughly 2 hours on 15m, so it can catch a flip in
// hours, not the days it can take ADX to confirm one.
export function windowPct(candles, bars = 8) {
  const n = candles.length;
  if (n < bars + 1) return null;
  const now = candles[n - 1].close;
  const then = candles[n - 1 - bars].close;
  return then > 0 ? ((now - then) / then) * 100 : null;
}

// Pools every coin's windowPct into one market-wide read. BTC counts double,
// since it typically leads and alts tend to follow, not a guess, one of the
// more consistent patterns in this market.
export function marketBias(coinReadings) {
  const valid = coinReadings.filter((c) => c.pct != null);
  if (!valid.length) return { dir: null, strength: 0, pctUp: null, avgPct: null };
  let weightedSum = 0, weightTotal = 0, upCount = 0;
  for (const c of valid) {
    const w = c.isBTC ? 2 : 1;
    weightedSum += c.pct * w;
    weightTotal += w;
    if (c.pct > 0) upCount++;
  }
  const avgPct = weightedSum / weightTotal;
  const pctUp = upCount / valid.length;
  const dir = avgPct > 0.15 ? "bull" : avgPct < -0.15 ? "bear" : null;
  const strength = Math.min(1, Math.abs(avgPct) / 2);
  return { dir, strength, pctUp, avgPct };
}

// Same soft-touch pattern as volume, trend, and the proven-combo table:
// boost a signal that agrees with where the whole market is leaning right
// now, discount one that fights it. Never suppresses on its own.
function biasContext(bias, signalDir) {
  if (!bias || !bias.dir) return { tag: null, boost: 0, phrase: null };
  const word = bias.dir === "bull" ? "up" : "down";
  if (signalDir === bias.dir) {
    return { tag: "with", boost: 0.10, phrase: `Broader market is leaning ${word} too.` };
  }
  return { tag: "against", boost: -0.15, phrase: `Broader market is leaning ${word}, this fights that.` };
}

// Reversal-risk stays out of every OTHER signal's score, on purpose. Baking
// it into every existing signal's strength would repeat the exact mistake a
// slow, one-shot trend filter already made once. It only ever does two
// things: shows as a visible awareness flag (Market Context, AI reasoning),
// and triggers one new, separately tracked, honestly-labeled signal below,
// "Reversal watch", so the specific idea "fade it when it's visibly
// stretched" can earn or lose its own track record rather than quietly
// reshaping every other signal's ranking. Combines how stretched the
// current bias is with whether sentiment (Fear & Greed) is at an extreme, a
// classic contrarian read professional desks actually watch.
export function reversalRisk(bias, fngValue) {
  if (!bias || !bias.dir) return { level: "low", note: null };
  const stretched = Math.abs(bias.avgPct) >= 1.2;
  const fngExtreme = bias.dir === "bear" ? fngValue != null && fngValue <= 25 : fngValue != null && fngValue >= 75;
  const word = bias.dir === "bull" ? "bullish" : "bearish";
  if (stretched && fngExtreme) {
    return { level: "high", note: `Market has leaned ${word} hard, and sentiment is at an extreme (${fngValue}). Stretched moves like this often reverse.` };
  }
  if (stretched || fngExtreme) {
    return { level: "elevated", note: `The ${word} lean is getting stretched. Worth watching for a turn.` };
  }
  return { level: "low", note: null };
}

// -----------------------------------------------------------------------
// Reversal watch confirmations. The original version fired on nothing more
// than "the market lean looks stretched," which backtested weak (13-20%
// win rate across hundreds of fires). This rebuild requires real evidence
// the stretched move is actually running out of steam before it counts.
//
// The four checks below and how they're weighted come from actual
// research on each one's track record, not just intuition:
//
// - Volume climax and momentum deceleration are real-time order-flow
//   reads. Nothing in the literature ties their reliability to timeframe,
//   so they carry full weight everywhere.
// - RSI divergence and consecutive-candle streaks both lean on a longer
//   look-back to mean anything. Every source on both explicitly flags them
//   as noisy below an hour (divergence gets "routinely faded by
//   algorithmic market-makers within minutes" on short timeframes; streak
//   tools are described as "optimized for Daily, Weekly, Monthly" charts).
//   So both are down-weighted on 5m/15m and back to full weight by 30m/1h.
// - Fear & Greed only updates once every 24 hours, it cannot time an
//   entry by itself. Every source on it agrees: never standalone, always
//   paired with price action. So it never contributes unless at least one
//   real confirmation has already fired.
//
// Bearish divergence: price prints a higher high but RSI prints a lower
// high at that same point, momentum disagreeing with price. Bullish is
// the mirror. Compares the most recent extreme in the lookback window
// against the one before it.
function findDivergence(closes, rSeries, dir, lookback) {
  const n = closes.length;
  if (n < lookback + 2) return false;
  const start = n - lookback;
  const mid = start + Math.floor(lookback / 2);
  const firstHalf = closes.slice(start, mid);
  const secondHalf = closes.slice(mid, n - 1); // exclude the still-forming candle
  if (!firstHalf.length || !secondHalf.length) return false;
  if (dir === "bull") {
    const priorIdx = start + firstHalf.indexOf(Math.min(...firstHalf));
    const recentIdx = mid + secondHalf.indexOf(Math.min(...secondHalf));
    const priorRsi = rSeries[priorIdx], recentRsi = rSeries[recentIdx];
    if (priorRsi == null || recentRsi == null) return false;
    return closes[recentIdx] < closes[priorIdx] && recentRsi > priorRsi;
  }
  const priorIdx = start + firstHalf.indexOf(Math.max(...firstHalf));
  const recentIdx = mid + secondHalf.indexOf(Math.max(...secondHalf));
  const priorRsi = rSeries[priorIdx], recentRsi = rSeries[recentIdx];
  if (priorRsi == null || recentRsi == null) return false;
  return closes[recentIdx] > closes[priorIdx] && recentRsi < priorRsi;
}

// A real spike in the last few candles that's now visibly fading, the
// one-two punch every source on this describes: energy spent, no
// follow-through.
function volumeClimax(vols) {
  const n = vols.length;
  if (n < 21) return false;
  const recent = vols.slice(n - 6, n - 1);
  const peak = Math.max(...recent);
  const peakIdx = recent.indexOf(peak);
  const priorAvg = vols.slice(n - 21, n - 6).reduce((a, b) => a + b, 0) / 15;
  const isRealSpike = priorAvg > 0 && peak > priorAvg * 2.2;
  const fadedSince = recent.slice(peakIdx + 1);
  return isRealSpike && fadedSince.length > 0 && fadedSince.every((v) => v < peak * 0.6);
}

// Each push in the stretched direction smaller than the last, even though
// price keeps grinding that way, the trend running out of gas before it
// shows up as an actual reversal in price.
function momentumDeceleration(closes, dir, lookback) {
  const n = closes.length;
  if (n < lookback + 1 || lookback < 6) return false;
  const window = closes.slice(n - lookback, n);
  const step = Math.floor(lookback / 3);
  const seg1 = window[step] - window[0];
  const seg2 = window[step * 2] - window[step];
  const seg3 = window[window.length - 1] - window[step * 2];
  if (dir === "bull") return seg1 > 0 && seg2 > 0 && seg3 > 0 && seg3 < seg2 && seg2 < seg1;
  return seg1 < 0 && seg2 < 0 && seg3 < 0 && seg3 > seg2 && seg2 > seg1;
}

// How many bars in a row closed the same direction with no real pullback.
function candleStreak(candles, dir) {
  let streak = 0;
  for (let i = candles.length - 1; i >= 1; i--) {
    const up = candles[i].close > candles[i].open;
    if ((dir === "bull" && up) || (dir === "bear" && !up)) streak++;
    else break;
  }
  return streak;
}

// Gathers all four checks plus Fear & Greed into one weighted score.
// 1.5+ combined weight fires as elevated confidence, 2.5+ as high, the
// same two-tier read used everywhere else in this file.
function reversalConfirmations(candles, closes, vols, dir, tfKey, fngValue, bias) {
  const shortTf = tfKey === "5m" || tfKey === "15m";
  const divWeight = shortTf ? 0.5 : 1.0;
  const streakWeight = shortTf ? 0.5 : 1.0;
  const lookback = tfKey === "5m" ? 24 : tfKey === "15m" ? 20 : tfKey === "30m" ? 16 : 14;

  const rSeries = rsiSeries(closes, 14);
  const hasDivergence = findDivergence(closes, rSeries, dir, lookback);
  const hasClimax = volumeClimax(vols);
  const hasDecel = momentumDeceleration(closes, dir, Math.min(lookback, candles.length - 1));
  const streak = candleStreak(candles, dir === "bull" ? "bear" : "bull"); // the OPPOSING streak that's now stretched
  const hasStreak = streak >= 5;
  const fngExtreme = bias?.dir === "bear" ? fngValue != null && fngValue <= 25 : fngValue != null && fngValue >= 75;

  let score = 0;
  const notes = [];
  if (hasClimax) { score += 1.0; notes.push("a volume spike that's now fading"); }
  if (hasDecel) { score += 1.0; notes.push("each push getting smaller"); }
  if (hasDivergence) { score += divWeight; notes.push("RSI disagreeing with price"); }
  if (hasStreak) { score += streakWeight; notes.push(`${streak} candles in a row without a pullback`); }
  if (fngExtreme && score > 0) { score += 0.5; notes.push("sentiment at an extreme"); }

  return { score, notes };
}

/* -------------------------------- signals -------------------------------- */
// th accepts: pctMin, volMult, rsiLow, rsiHigh, paceMult, accumVolTrend
export function computeSignals(candles, tfKey, th, opts = {}) {
  const n = candles.length;
  if (n < 30) return { signals: [], warming: true, snap: null };
  const now = opts.now || Date.now();
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const vols = candles.map((c) => c.volumeto);
  const price = closes[n - 1];
  const pct = ((price - closes[n - 2]) / closes[n - 2]) * 100;
  const volAvg = vols.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20;
  const volRatio = volAvg > 0 ? vols[n - 1] / volAvg : 1;
  const r = rsi(closes, 14);
  const e9 = emaSeries(closes, 9), e21 = emaSeries(closes, 21);
  const a = atr(highs, lows, closes, 14) || price * 0.01;
  const trend = adx(highs, lows, closes, 14);
  const bias = opts.marketBias || null;
  const risk = opts.reversalRisk || null;
  const last = candles[n - 1];
  const signals = [];

  // "Reversal watch": the specific idea that when the broader market's lean
  // is visibly stretched, a move fighting that lean isn't noise, it may be
  // the turn itself. Rebuilt from its original version, which fired on
  // stretch alone and backtested weak (13-20% win rate across hundreds of
  // fires). Stretch is now only the baseline condition, not the trigger:
  // it still needs at least one real confirmation from
  // reversalConfirmations() before it fires at all. Deliberately still
  // unproven on purpose, same as every other signal starts out: it carries
  // no proven/weak tag until real backtest evidence earns one under this
  // new logic, so it stays hidden behind the "not yet proven" toggle in
  // Opportunities until it does.
  if (bias && bias.dir && risk && risk.level !== "low") {
    const dir = bias.dir === "bull" ? "bear" : "bull"; // betting the stretched lean snaps back
    const confirm = reversalConfirmations(candles, closes, vols, dir, tfKey, opts.fngValue, bias);
    if (confirm.score >= 1.5) {
      const vc = volumeContext(volRatio);
      const pc = provenContext("Reversal watch", tfKey, dir);
      const confirmTier = confirm.score >= 2.5 ? "high" : "elevated";
      const base = confirmTier === "high" ? 0.55 : 0.35;
      const strength = clamp(base + vc.boost + pc.boost);
      const note = joinNote(
        `${bias.dir === "bull" ? "Bullish" : "Bearish"} lean looks stretched, and ${confirm.notes.join(", ")}.`,
        pc.phrase
      );
      signals.push({ type: "reversal", label: "Reversal watch", dir, strength, volTag: vc.tag, tier: pc.tag, tierRate: pc.rate, confirmTier, note, ...levels(price, a, dir) });
    }
  }

  if (Math.abs(pct) >= th.pctMin) {
    const dir = pct > 0 ? "bull" : "bear";
    const vc = volumeContext(volRatio);
    const tc = trendContext(trend, dir);
    const pc = provenContext("Momentum", tfKey, dir);
    const bc = biasContext(bias, dir);
    const strength = clamp((Math.abs(pct) - th.pctMin) / th.pctMin + vc.boost + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`${pct > 0 ? "+" : ""}${pct.toFixed(2)}% in one ${TF[tfKey].label} bar.`, vc.phrase, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "move", label: "Momentum", dir, strength, volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, tierRate: pc.rate, note, ...levels(price, a, dir) });
  }
  if (volRatio >= th.volMult) {
    const dir = last.close >= last.open ? "bull" : "bear";
    const tc = trendContext(trend, dir);
    const pc = provenContext("Volume spike", tfKey, dir);
    const bc = biasContext(bias, dir);
    const strength = clamp((volRatio - th.volMult) / th.volMult + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`${volRatio.toFixed(1)}× the 20-bar average volume.`, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "volume", label: "Volume spike", dir, strength, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, tierRate: pc.rate, note, ...levels(price, a, dir) });
  }
  if (r != null && r <= th.rsiLow) {
    const vc = volumeContext(volRatio);
    const tc = trendContext(trend, "bull");
    const pc = provenContext("RSI oversold", tfKey, "bull");
    const bc = biasContext(bias, "bull");
    const strength = clamp((th.rsiLow - r) / th.rsiLow + vc.boost + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`RSI ${r.toFixed(0)}, oversold reading.`, vc.phrase, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "rsi", label: "RSI oversold", dir: "bull", strength, volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, tierRate: pc.rate, note, ...levels(price, a, "bull") });
  } else if (r != null && r >= th.rsiHigh) {
    const vc = volumeContext(volRatio);
    const tc = trendContext(trend, "bear");
    const pc = provenContext("RSI overbought", tfKey, "bear");
    const bc = biasContext(bias, "bear");
    const strength = clamp((r - th.rsiHigh) / (100 - th.rsiHigh) + vc.boost + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`RSI ${r.toFixed(0)}, overbought reading.`, vc.phrase, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "rsi", label: "RSI overbought", dir: "bear", strength, volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, tierRate: pc.rate, note, ...levels(price, a, "bear") });
  }
  if (e9.length && e21.length) {
    const i = n - 1;
    const dNow = (e9[i] ?? 0) - (e21[i] ?? 0), dPrev = (e9[i - 1] ?? 0) - (e21[i - 1] ?? 0);
    const vc = volumeContext(volRatio);
    if (dPrev <= 0 && dNow > 0) {
      const tc = trendContext(trend, "bull");
      const pc = provenContext("EMA cross up", tfKey, "bull");
      const bc = biasContext(bias, "bull");
      signals.push({ type: "cross", label: "EMA cross up", dir: "bull", strength: clamp(0.65 + vc.boost + tc.boost + pc.boost + bc.boost), volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, tierRate: pc.rate, note: joinNote("9 EMA crossed above 21 EMA.", vc.phrase, tc.phrase, bc.phrase, pc.phrase), ...levels(price, a, "bull") });
    } else if (dPrev >= 0 && dNow < 0) {
      const tc = trendContext(trend, "bear");
      const pc = provenContext("EMA cross down", tfKey, "bear");
      const bc = biasContext(bias, "bear");
      signals.push({ type: "cross", label: "EMA cross down", dir: "bear", strength: clamp(0.65 + vc.boost + tc.boost + pc.boost + bc.boost), volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, tierRate: pc.rate, note: joinNote("9 EMA crossed below 21 EMA.", vc.phrase, tc.phrase, bc.phrase, pc.phrase), ...levels(price, a, "bear") });
    }
  }

  // Early-pace volume: is volume on the STILL-FORMING bar already running hot for
  // how far into the bar we are? A closed-bar volume check can only ever fire near
  // or after the bar closes. This compares partial volume against the volume you
  // would expect at this point in the bar, so it can catch a spike while it is
  // still building, which is the actual "being first" fix.
  const barLenMs = barMs(tfKey);
  const elapsed = Math.max(0, Math.min(barLenMs, now - last.time));
  const fraction = barLenMs > 0 ? elapsed / barLenMs : 0;
  if (fraction > 0.15 && fraction < 0.85 && th.paceMult) {
    const expectedSoFar = volAvg * fraction;
    const paceRatio = expectedSoFar > 0 ? vols[n - 1] / expectedSoFar : 0;
    if (paceRatio >= th.paceMult) {
      const dir = last.close >= last.open ? "bull" : "bear";
      const pctLeft = Math.round((1 - fraction) * 100);
      const pc = provenContext("Volume building early", tfKey, dir);
      signals.push({ type: "pace", label: "Volume building early", dir, strength: clamp((paceRatio - th.paceMult) / th.paceMult + pc.boost), tier: pc.tag, tierRate: pc.rate, note: joinNote(`Volume already ${paceRatio.toFixed(1)}x the usual pace with ${pctLeft}% of the bar left.`, pc.phrase), ...levels(price, a, dir) });
    }
  }

  // Quiet accumulation: volume climbing over recent CLOSED bars while price stays
  // inside a tight range. This is the Wyckoff-style setup that neither momentum
  // nor the volume-spike check catches alone, since neither threshold crosses on
  // its own until the move is already visible in price.
  if (th.accumVolTrend) {
    const w = 6;
    const closedEnd = n - 2; // exclude the still-forming last bar
    if (closedEnd - 2 * w + 1 >= 0) {
      const recentVols = vols.slice(closedEnd - w + 1, closedEnd + 1);
      const priorVols = vols.slice(closedEnd - 2 * w + 1, closedEnd - w + 1);
      const volTrend = avg(recentVols) / (avg(priorVols) || 1);
      const recentCloses = closes.slice(closedEnd - w + 1, closedEnd + 1);
      const recentHighs = highs.slice(closedEnd - w + 1, closedEnd + 1);
      const recentLows = lows.slice(closedEnd - w + 1, closedEnd + 1);
      const rangePct = ((Math.max(...recentHighs) - Math.min(...recentLows)) / (avg(recentCloses) || 1)) * 100;
      const flatCeiling = th.pctMin * 1.4;
      if (volTrend >= th.accumVolTrend && rangePct <= flatCeiling) {
        const pickup = Math.round((volTrend - 1) * 100);
        const pc = provenContext("Quiet accumulation", tfKey, "bull");
        signals.push({ type: "accumulation", label: "Quiet accumulation", dir: "bull", strength: clamp((volTrend - th.accumVolTrend) / th.accumVolTrend + pc.boost), tier: pc.tag, tierRate: pc.rate, note: joinNote(`Volume up ${pickup}% over the last ${w} bars while price held inside a ${rangePct.toFixed(2)}% range.`, pc.phrase), ...levels(price, a, "bull") });
      }
    }
  }

  return { signals, warming: false, snap: { price, pct, rsi: r, volRatio, atr: a, trend } };
}
