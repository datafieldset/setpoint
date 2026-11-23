// lib/signals.js
// One copy of the indicator math and signal detection. Import this instead of
// redefining RSI/EMA/ATR/computeSignals in more than one place.

import { TF, barMs } from "./timeframes.js";
import { withCache } from "./cache.js";
import { tfsFor, SWING_LABEL } from "./trend.js";
import { FLUSH_TFS } from "./flush.js";
import { FLOW_TFS } from "./flow.js";

// The one set of default thresholds. The live dashboard and the research
// backtest both import this, so a backtest result always reflects the exact
// same settings a real user sees, not a second copy that could drift.
export const DEFAULT_TH = { volMult: 2.0, rsiLow: 30, rsiHigh: 70, paceMult: 2.2, accumVolTrend: 1.5 };

// The ONE place a timeframe's move-size threshold (pctMin) joins the base
// thresholds. Live cron, dashboard and both backtests must all call this.
// Backtests once passed plain DEFAULT_TH (pctMin undefined), which made
// Momentum fire on every bar and Quiet accumulation never fire (v19.20).
export function thresholdsFor(tfKey, base = DEFAULT_TH) {
  return { ...base, pctMin: TF[tfKey].pctMin };
}

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
// Same math as atr() above, but returns the full series instead of just the
// latest value. The volatility meter needs ATR's own recent history to
// tell whether it's currently expanding or declining, not just where it
// sits right now.
function atrSeries(h, l, c, period = 14) {
  const n = c.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  const trs = new Array(n).fill(0);
  for (let i = 1; i < n; i++) trs[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = trs.slice(1, period + 1).reduce((x, y) => x + y, 0) / period;
  out[period] = a;
  for (let i = period + 1; i < n; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i] = a;
  }
  return out;
}

// Volatility meter: a continuous 0-100 read per coin, top-to-bottom, built
// from the same core idea as GainzAlgo's volatility-regime indicator, not
// a fired alert, a constantly-updating readout meant to sit next to a
// coin at a glance. 50 = neutral/coiled, no lean. Pushes toward 100 the
// deeper into a real bullish expansion the market is, pushes hardest of
// all toward 100 specifically when that bullish move shows exhaustion,
// ATR was elevated and is now declining, the classic "this rally's
// running out of gas, probably near the top" signature. Mirrored toward 0
// for bearish moves and bearish exhaustion.
export function volatilityMeter(candles, tfKey) {
  const n = candles.length;
  if (n < 60) return null; // needs real history for a 50-bar baseline plus lookback room
  const h = candles.map((c) => c.high), l = candles.map((c) => c.low), c = candles.map((c) => c.close);
  const atrS = atrSeries(h, l, c, 14);
  const i = n - 1;
  if (atrS[i] == null) return null;

  const baselineLen = 50;
  const start = Math.max(0, i - baselineLen + 1);
  const window = atrS.slice(start, i + 1).filter((v) => v != null);
  if (window.length < 20) return null;
  const baseline = window.reduce((a, b) => a + b, 0) / window.length;
  const ratio = baseline > 0 ? atrS[i] / baseline : 1;

  // Simple direction read: price relative to its own recent average, same
  // spirit as GainzAlgo's trend check, deliberately simple since this is
  // a supporting lean, not the main trend signal (that's the ADX-based
  // trendContext already used elsewhere in this file). Computed here,
  // before the exhaustion check below, since the real momentum-
  // deceleration check needs a real direction to check deceleration
  // against.
  const smaLen = Math.min(21, c.length);
  const sma = c.slice(-smaLen).reduce((a, b) => a + b, 0) / smaLen;
  const dir = c[i] > sma ? 1 : c[i] < sma ? -1 : 0;

  // Was the market in a real high-volatility stretch within the last 10
  // bars, and has ATR been declining for the last 5 bars straight since?
  let wasRecentlyHighVol = false;
  for (let j = Math.max(0, i - 10); j <= i; j++) {
    if (atrS[j] != null) {
      const localStart = Math.max(0, j - baselineLen + 1);
      const localWindow = atrS.slice(localStart, j + 1).filter((v) => v != null);
      const localBaseline = localWindow.length ? localWindow.reduce((a, b) => a + b, 0) / localWindow.length : baseline;
      if (localBaseline > 0 && atrS[j] / localBaseline >= 1.4) { wasRecentlyHighVol = true; break; }
    }
  }
  let declining = true;
  for (let j = i; j > i - 5 && j > 0; j--) {
    if (atrS[j] == null || atrS[j - 1] == null || atrS[j] > atrS[j - 1]) { declining = false; break; }
  }
  const volExhausted = wasRecentlyHighVol && declining;

  // Real, second read on exhaustion, reusing the exact same
  // momentum-deceleration check Reversal watch's confirmation logic
  // already relies on, not a new, separate implementation. Volatility
  // shrinking (above) and the actual directional push losing steam are
  // related but genuinely different things, a coin can still be posting
  // real, wide bars while each successive push gets smaller, or the
  // range can shrink while price keeps grinding the same direction at
  // the same real pace. Catching either one gives a fuller, more honest
  // "is this actually running out of steam" read than volatility alone.
  const lookback = tfKey === "5m" ? 24 : tfKey === "15m" ? 20 : tfKey === "30m" ? 16 : 14;
  const momentumExhausted = dir !== 0 && momentumDeceleration(c, dir > 0 ? "bull" : "bear", Math.min(lookback, n - 1));

  const exhausted = volExhausted || momentumExhausted;
  const regime = exhausted ? "exhaustion" : ratio >= 1.4 ? "expansion-strong" : ratio < 0.7 ? "compression" : "expansion-mild";

  let score = 50;
  if (regime === "exhaustion") score = dir > 0 ? 90 : dir < 0 ? 10 : 50;
  else if (regime !== "compression") {
    // v21.0 (Na, Nov 3): the lean used to be a fixed step (+10 or +25) for ANY gap above or below the 21-bar average, so price 0.03%
    // above it (a flat hour) showed the same +10 as price well above it. The lean now scales with the gap, measured in that coin's
    // own normal swing (baseline ATR) on that chart: a gap of 2x that swing or more is the full step, a tiny gap sits near the middle.
    // It is also cut in half unless the average itself is moving the same way (at least a quarter of a normal swing over the last 6
    // bars), because a bounce under a falling average, or a nudge over a flat one, is a weak lean. Exhaustion is unchanged.
    const maxStep = regime === "expansion-strong" ? 25 : 10;
    const gap = c[i] - sma;
    let frac = baseline > 0 ? Math.min(1, Math.abs(gap) / (2 * baseline)) : 0;
    if (c.length >= smaLen + 6) {
      const smaPrev = c.slice(-(smaLen + 6), -6).reduce((a2, b2) => a2 + b2, 0) / smaLen;
      const slope = sma - smaPrev;
      const sameWay = (slope > 0 && gap > 0) || (slope < 0 && gap < 0);
      if (!(sameWay && Math.abs(slope) >= 0.25 * baseline)) frac *= 0.5;
    }
    score = 50 + Math.sign(dir) * maxStep * frac;
  }
  // compression stays at the neutral 50, coiled, no lean either way

  const label = score >= 80 ? "Near top" : score >= 55 ? "Leaning high" : score <= 20 ? "Near bottom" : score <= 45 ? "Leaning low" : "Neutral";
  return { score: Math.round(score), regime, label, ratio, dir };
}

// A real, single, combined read: which of five real market stages a coin
// is currently in, and whether that stage looks like it's just getting
// going or running out of room. Built entirely from two things already
// computed elsewhere in this file, not a third, separate detector — real
// ADX/DI-based trend detection decides trend vs. range, and this same
// volatilityMeter's exhaustion regime decides starting vs. ending.
export function marketRegime(candles, tfKey) {
  const n = candles.length;
  if (n < 60) return null;
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const trend = adx(highs, lows, closes, 14);
  const vol = volatilityMeter(candles, tfKey);
  if (!trend || !vol) return null;

  let stage;
  if (trend.adx >= 20) {
    stage = trend.plusDI > trend.minusDI ? "bullish-trending" : "bearish-trending";
  } else if (vol.ratio >= 1.4) {
    stage = "high-volatility";
  } else if (vol.ratio < 0.7) {
    stage = "low-volatility";
  } else {
    stage = "sideways-ranging";
  }

  const phase = vol.regime === "exhaustion" ? "ending" : "building";

  // Real, direct, actionable language, the actual point of this whole
  // panel — not "what's the technical structure" but "is there a real
  // opportunity here, is this stretched enough to matter." Combines
  // stage and phase into one honest statement instead of two separate,
  // more technical lines that used to say the same thing twice.
  let label;
  if (stage === "bullish-trending") {
    label = phase === "ending" ? "Stretched to the upside, watch for a pullback" : "Real uptrend, room left to run";
  } else if (stage === "bearish-trending") {
    label = phase === "ending" ? "Stretched to the downside, watch for a bounce" : "Real downtrend, room left to fall";
  } else if (stage === "high-volatility") {
    label = phase === "ending" ? "Sharp swings may be fading" : "Sharp, choppy swings, no clear direction yet";
  } else if (stage === "low-volatility") {
    label = phase === "ending" ? "Exhausted and quiet, the last move has run out of steam" : "Genuinely quiet, could be setting up for a real move";
  } else {
    label = phase === "ending" ? "Squeezed tight, may be about to break" : "No real direction yet, waiting for a move";
  }

  // A real, graduated 1-5 stretch level, the actual improvement Na asked
  // for, built from the exact same trend and exhaustion read above, not
  // a second, separate approach. 1 is genuinely calm (real compression,
  // no trend), 5 is the meter's own strongest signal (real exhaustion),
  // with real trend strength (ADX) filling in the levels between.
  let level;
  if (vol.regime === "exhaustion") level = 5;
  else if (trend.adx >= 35) level = 4;
  else if (trend.adx >= 20) level = 3;
  else if (vol.regime === "compression") level = 1;
  else level = 2;

  return { stage, label, phase, level, adx: Math.round(trend.adx) };
}



// Grind: the mirror case to Breakout/Breakdown. That pair catches the
// moment a tight, coiled market suddenly releases. This catches the
// opposite texture entirely, no dramatic single bar at all, just the
// same direction, bar after bar, quietly. Direction-agreement alone
// isn't enough, plenty of quiet chop agrees on direction by coincidence
// without going anywhere real, so this also requires the cumulative move
// over the window to be a real, meaningful multiple of the coin's own
// typical single-bar range, not just a lot of small bars that happened
// to line up.
// Shrunk from 12/8/3x (Aug 15): the real first day of data showed Grind
// firing consistently weak across nearly every timeframe, and the likely
// reason is structural, not bad luck. Waiting for 8 of 12 bars to already
// agree means the move's had real time to run before this ever fires,
// closer to its exhaustion point than its start. A shorter window with a
// stricter required proportion (75% instead of 67%) fires sooner in a
// developing move without loosening how consistent that move has to be.
// Move threshold scaled down proportionally too, less time in the window
// means less room for cumulative movement to accumulate even in a
// genuinely real move.




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

// v25.4 (Nov 22): the static promotion table is empty. Every original signal was retired and its code removed; the live signals
// are public tests and carry no promoted rates. Dated history of every rate that was here: memory/signal-roster.md and git history.
export const SIGNAL_RATES = {};
// Real, single, shared source for which signals are still being tested,
// live and admin-only, never yet verified or shown to a real customer.
// Used consistently by the cron's logging/push logic and the client's
// display/push logic, so adding or graduating a signal here is the only
// place that ever needs to change.
const TESTING_CANDIDATES = [];

// FOCUS MODE (v19.21, Oct 12). Na was overwhelmed by too many signals and
// asked to hide everything except the new Trend Rider, then bring the rest
// back one at a time. This list is the ONE place that decides which of the
// original signals anyone can see. A label that is not in it still gets
// detected and logged (so its record keeps building), but it can never
// show as verified, never appear on the dashboard or Watch Live, and never
// send a push. To bring one back: add its exact label here, in the same
// commit as a line in memory/signal-roster.md saying why.
export const FOCUS_MODE = true; // Oct 13: Na wants one signal live at a time. Trend Rider is the only one shown, the originals stay hidden
export const VISIBLE_SIGNALS = ["Swing Rider", "Flush Rider", "Flow Rider", "Calm Rider"];
export const isSignalVisible = (label) => !FOCUS_MODE || VISIBLE_SIGNALS.includes(label);
// For SQL that selects a limited number of recent rows: filter by visibility
// in the query itself, so hidden signals can't use up the LIMIT first.
// Usage: WHERE (${noFocus} OR label = ANY(${focusLabels}))
export const focusSql = { noFocus: !FOCUS_MODE, focusLabels: VISIBLE_SIGNALS };
export const TESTING_SIGNALS = TESTING_CANDIDATES.filter(isSignalVisible);

// Real, complete registry of every real signal this app has ever built
// (Sep 21), the single, honest source of truth for "how many do we
// have, total." A name showing up here doesn't mean it's promoted or
// even shown to anyone — see SIGNAL_RATES and TESTING_SIGNALS above
// for what's actually live right now. This is just the full, real
// census: every real idea that's ever been coded up and given a
// chance, whatever became of it since.
export const ALL_SIGNALS = [
  {
    name: SWING_LABEL,
    // Public test (v22.8, Nov 8; entry rule changed v23.4, Nov 11; "not stretched" check dropped v23.6 and restored v23.8, Nov 11): the slow 4 hour trend signal with a big target. Logged by the server (lib/trendRunner.js).
    publicTest: true,
    serverOnly: true,
    tfs: tfsFor(SWING_LABEL), // 4 hour only
    ready: "trend", // v23.9: shown in the Market Meter's "How close is an alert" section (lib/readiness.js)
    what: "The slow one. It watches the 4 hour chart and buys at the open of a new candle when the trend is already strong: price above its 200-day average, RSI above 60, ADX above 20, and price not stretched more than 20% above that average. It takes one trade at a time. The stop sits 2 ATR away (ATR is how far that coin normally swings on that chart) and the target is 3 times that distance, so it needs to win a little more than 1 trade in 4 to break even after costs. In about 6 years of Bitcoin history (2020 to late 2025) that setup made 69 trades, about 12 a year, won about 4 in 10, and came out +0.60R per trade after a 0.20% cost (R is the amount you risk on one trade), positive in every period that had trades. In the 12 months after that, which were kept aside as a test, it made 9 trades, won 3 and came out +0.25R. Expect long quiet stretches, many small losses and a few big wins, and each trade can take days. It does not sell, and it stays quiet whenever price is under its 200-day average (it had no trades in 2022). It was tuned on Bitcoin's history and the sample is small, so live results will probably come in lower. It runs on every coin you watch, but only Bitcoin was tested.",
  },
  {
    name: "Flush Rider",
    // Public test (v22.7, Nov 8; v25.0 volatility gate, Nov 22): buys the retest after a sudden drop to a new low in a volatile market. Logged by the server (lib/trendRunner.js), Bitcoin only.
    publicTest: true,
    serverOnly: true,
    ready: "flush", // v23.9: shown in the Market Meter's "How close is an alert" section (lib/readiness.js)
    coins: ["BTC"],
    tfs: FLUSH_TFS,      // 1 hour only
    what: "Buys the retest after a sudden crash, but only when the market is already swinging hard. A flush is a single 1 hour candle that falls 1.5% or more from its open and breaks the lowest low of the last 48 hours. Bounce only takes it when Bitcoin's normal hourly swing (ATR, how far it usually moves in an hour) is already at least 1.5% of its price, because in the history flushes in calm markets did much worse. Many flushes come back down to test that low again, so Bounce waits for that dip instead of chasing the first bounce. Its entry is just above the flush low (a quarter of an ATR), its stop is a bit below the low, and its target is three times the risk. It only opens if price comes back to the entry within 24 hours, and never if price breaks the stop first. In about 9 years of Bitcoin history (2017 to late 2026) that setup made 117 trades, about 13 a year, won about 4 in 10, and came out +0.45R per trade after a 0.20% cost (R is the amount you risk on one trade), positive in 8 of the 9 years. It is rare in calm markets (4 trades in 2024 to 2026) and busier in crashes. It counts a trade as filled the moment price touches the entry, which is generous, and the 1.5% swing cutoff was picked from a few tried in the same history, so live results will probably come in lower. It's in public testing, and Bitcoin only.",  },
  {
    name: "Flow Rider",
    // Public test (v25.1, Nov 22): a short after heavy selling while price is under its 50-day average. Logged by the server (lib/trendRunner.js), Bitcoin only, closed by the shared resolver (stop, target or 7 days).
    publicTest: true,
    serverOnly: true,
    ready: "flow", // shown in the Market Meter's "How close is an alert" section (lib/readiness.js)
    coins: ["BTC"],
    tfs: FLOW_TFS,       // shown on the 4 hour chart (a swing trade that lasts days)
    what: "The short. It watches Bitcoin for heavy selling: over the last 24 hours, aggressive sellers have outweighed buyers by an unusual amount compared with the previous 30 days, while price is under its 50-day average. When both are true it sells short at the next 15 minute candle's open, with a stop 5% above and a target 10% below (2R, where R is the amount you risk on one trade). If neither is hit within 7 days it closes at the market. One trade at a time, Bitcoin only. In about 9 years of Bitcoin history that setup made 168 trades, about 18 a year, won about half, and averaged +0.91% per trade after a 0.20% cost (about +0.2R). It was positive in every era and made +2.08% across the last 12 months (24 trades). It was weak in the calm, sideways years (2023 to 2024 was +0.08%), and it's a swing trade that lasts days, not a scalp. Several time windows and cutoffs were tried before this one was picked, so live results will probably come in lower. The same test on heavy buying (a long) did not hold up, so there is no long version. It's in public testing.",
  },
  {
    name: "Calm Rider",
    // Public test (v25.2, Nov 22): the old Momentum buy, taken only while the hourly swings are calm. Logged by the server (lib/trendRunner.js, rules in lib/calmRider.js), Bitcoin only, closed by the shared resolver at its stop or 2R target.
    publicTest: true,
    serverOnly: true,
    ready: "calm", // shown in the Market Meter's "How close is an alert" section (lib/readiness.js)
    coins: ["BTC"],
    tfs: ["1h", "30m"], // same list as CALM_TFS in lib/calmRider.js (not imported here: that file imports this one; scripts/review.mjs pins them equal)
    what: "A buy after a strong up candle, but only when the market is calm. When a 30 minute or 1 hour Bitcoin candle closes up by more than its usual amount, the old Momentum signal called it a buy, and it lost money overall. Looking back, those buys lost in swinging markets and did better in quiet ones, so Spark only takes them when Bitcoin's normal 1 hour swing is under 1.2% of its price. The stop and target come from that chart's own swing size, with the target twice as far as the stop. Honest numbers: on about six years of Bitcoin history after a 0.20% cost per trade, the calm version made 245 trades (about 37 a year), 46% won, +0.21R per trade, positive in all four eras. A version that picked its calm cutoff each year using only earlier years stayed positive too (+0.33R). But the idea came from looking at what the filter removed, 2024 was flat, and the most recent year was weak (29 trades, +0.06R), which is why the walk-forward moved to a tighter cutoff there. It fires far less often than Momentum did. It buys at the close of the candle, so your fill can differ. It is a public test, not a verified signal.",
  },
];

// Signals shown to everyone while they prove themselves (a public test),
// instead of waiting to clear the verified bar. They carry a plain
// "testing" tag and their real record, never a verified badge.
export const PUBLIC_TESTING = ALL_SIGNALS.filter((x) => x.publicTest).map((x) => x.name);
// Public tests that were retired (v23.4, Nov 11). Their rows stay in signal_track. They are never shown, they stay out of the market bias
// score (as they were while live), and the key-protected history pull can still read them for analysis.
export const RETIRED_SIGNALS = ["Trend Rider", "Rebound Rider"];
// Signals that only the server may log. /api/track is open to the
// internet, so it must never accept a trade for one of these.
export const SERVER_ONLY_SIGNALS = ALL_SIGNALS.filter((x) => x.serverOnly).map((x) => x.name);
// Which timeframes the server is actively watching for a public test on
// the coins this viewer follows, so the dashboard can say "Watching 4h"
// truthfully (a public test only scans its own coins and timeframes).
export const publicTestWatches = (tfLabel, coins) => ALL_SIGNALS.some((x) => x.publicTest && isSignalVisible(x.name) && (x.tfs || []).includes(tfLabel) && (!coins || !x.coins || x.coins.some((c) => coins.includes(c))));
// Rolling records keyed "label|tf|dir[|regime]" with hidden signals dropped.
// Anything sent to a browser goes through this, so focus mode can't leak a
// hidden signal's live record.
export const visibleGates = (g) => Object.fromEntries(Object.entries(g || {}).filter(([k]) => isSignalVisible(k.split("|")[0])));
// The ONE answer to "may this viewer see an unverified signal?": a public
// test is visible to everyone, the admin-only testing list to admins.
export const canSeeTesting = (label, isAdmin) =>
  isSignalVisible(label) && (PUBLIC_TESTING.includes(label) || (!!isAdmin && TESTING_SIGNALS.includes(label)));

export const PROVEN_THRESHOLD = 0.58;
// A real, optional 4th argument now — when the caller has already
// fetched the live gate for this tick, this uses the actual, current
// rate from real, recent trades instead of always falling back to the
// original, static backtest number. The static number only gets used
// when there genuinely isn't enough recent activity yet (or no live
// gate was passed at all) — the same real minimum sample the rest of
// the live-gate system already requires before trusting it.
export function provenContext(label, tfKey, dir, liveGate, regime, regimeGate) {
  if (!isSignalVisible(label)) return { tag: null, boost: 0, phrase: null, rate: null, isLive: false, verifiedVia: null }; // focus mode, see VISIBLE_SIGNALS
  const key = `${label}|${TF[tfKey]?.label || tfKey}|${dir}`;
  const entry = SIGNAL_RATES[key];
  // Real, important fix: the live gate can only refresh, confirm, or
  // demote a signal whose real, static baseline already cleared the
  // bar — it should never be able to promote one explicitly,
  // deliberately marked weak, just because its rolling-20 window
  // happened to cross 58% by chance. Found after a real, direct audit
  // showed statically-weak signals (Volume spike 5m short, 15% static)
  // still occasionally firing as "verified" and dragging down the
  // real, overall, all-time track record (44.5% blended across 508
  // real trades, well below what "verified" should mean).
  const staticProven = !!entry && entry.rate != null && entry.rate >= PROVEN_THRESHOLD;
  const live = liveGate && liveGate[key];
  const useLive = staticProven && !!(live && live.n >= LIVE_GATE_MIN_SAMPLE);
  if (staticProven) {
    const rate = useLive ? live.rate : entry.rate;
    if (rate >= PROVEN_THRESHOLD) {
      return { tag: "proven", boost: 0.15, phrase: `This setup ${useLive ? "is" : "has backtested at"} ${Math.round(rate * 100)}%.`, rate, isLive: useLive, verifiedVia: "overall" };
    }
    // A statically-proven signal whose overall record has since fallen
    // still falls through to the real, regime-specific check below,
    // same as one that was never promoted at all — a real, honest
    // condition-specific edge doesn't care how the signal got here.
  }
  // Real, new (Sep 17): a signal can genuinely earn a real, honest
  // "verified" status for the specific market condition it's actually
  // firing in right now, even with no static promotion behind it at
  // all — the same real reasoning already applied to already-promoted
  // signals, just no longer gated behind requiring one first. A real,
  // higher minimum sample applies here specifically
  // (REGIME_ONLY_MIN_SAMPLE, not the smaller LIVE_GATE_MIN_SAMPLE),
  // since there's no static floor backing this one up if the rolling
  // window is just a lucky, recent stretch.
  if (regime && regimeGate) {
    const rGate = regimeGate[`${key}|${regime}`];
    if (rGate && rGate.n >= REGIME_ONLY_MIN_SAMPLE && rGate.rate >= PROVEN_THRESHOLD) {
      return { tag: "proven", boost: 0.15, phrase: `This setup is ${Math.round(rGate.rate * 100)}% right now, in this specific market condition.`, rate: rGate.rate, isLive: true, verifiedVia: "regime", regimeStage: regime };
    }
  }
  if (!entry || entry.rate == null) return { tag: null, boost: 0, phrase: null, rate: null, isLive: false, verifiedVia: null };
  const rate = useLive ? live.rate : entry.rate;
  return { tag: "tested", boost: -0.30, phrase: `This setup ${useLive ? "is" : "has backtested at"} ${Math.round(rate * 100)}%.`, rate, isLive: useLive, verifiedVia: null };
}

// The single answer to "was this verified at the moment it fired?",
// written into signal_track.verified_at_fire when a trade is logged
// (Oct 9). Wraps provenContext, the one shared definition, so a stamp
// can never disagree with what the dashboard showed at that moment.
// Verification is still a live status, this just freezes the answer
// for one specific trade so Watch Live history stops rewriting itself
// when a setup is later promoted or demoted.
export function verifiedAtFire(label, tfKey, dir, regime, liveGate, regimeGate, lv = null) {
  if (lv && belowTargetFloor(tfKey, lv.entry, lv.target)) return false; // too small to count as a real trade
  return provenContext(label, tfKey, dir, liveGate, regime, regimeGate).tag === "proven";
}

// Minimum target size (v19.20). A target smaller than half of what the
// timeframe itself calls a "big move" (TF[tf].pctMin) is not a trade
// worth acting on: the slip between alert and fill is roughly the same
// on every trade, so it swallows a tiny target whole. Win rates in a
// year of BTC replay are flat across target sizes, so this costs
// nothing in verified rate and removes the trades that can't be
// followed in real life. Below the floor a signal is still detected and
// logged (the data stays complete) but never counts as verified, never
// pushes, and never shows on Watch Live.
export const TARGET_FLOOR_RATIO = 0.75; // three quarters of a timeframe's big-move size (Na, Oct 11)
export function targetFloorPct(tfKey) {
  return TF[tfKey] ? TARGET_FLOOR_RATIO * TF[tfKey].pctMin : 0;
}
export function belowTargetFloor(tfKey, entry, target) {
  const e = Number(entry), t = Number(target);
  if (!(e > 0) || !Number.isFinite(t)) return false;
  return (Math.abs(t - e) / e) * 100 < targetFloorPct(tfKey);
}

// Makes "verified" a live status instead of a static, one-time-earned
// label. The dashboard used to trust a hand-edited table that only
// changes when we sit down and review it, meaning a signal could keep
// showing as verified while its real, current performance had already
// fallen well under the bar. This computes the same real, live recent-20
// number Signal Drift already uses, per (label, tf, dir). Requires a
// real minimum sample before it can override the backtested number
// either way, not enough recent data should never silently hide
// something that's actually fine.
//
// Single, shared definition on purpose (Aug 19): this used to live only
// inside market/route.js, and the Watch Live page had its own, separate
// "verified" check that never got updated to use it, a real, live audit
// finding, not a guess, the two surfaces disagreed about which signals
// currently count as verified. Same class of bug the timeframes.js file
// already exists to prevent, two copies of the same idea, only one kept
// current. Exported from here so every surface that needs to know "is
// this actually earning it right now" shares this exact one.
export const LIVE_GATE_MIN_SAMPLE = 5;
export const LIVE_GATE_WINDOW = 20;
// A real, deliberately higher bar than LIVE_GATE_MIN_SAMPLE (Sep 17):
// this governs a signal earning "verified" purely from its
// condition-specific record, with no static promotion behind it at
// all — a real, honest 5-trade sample is enough to trust when there's
// a static floor backing it up, genuinely not enough on its own.
export const REGIME_ONLY_MIN_SAMPLE = 10;

async function fetchLiveVerifiedGateFromDB() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return { gate: {}, regimeGate: {} };
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`
      SELECT label, tf, dir, outcome, regime
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
      ORDER BY label, tf, dir, resolved_at DESC
    `;
    // Same grouping the full gate uses, minus any combo under the minimum sample.
    return buildGatesFromRows(rows, LIVE_GATE_MIN_SAMPLE);
  } catch {
    return { gate: {}, regimeGate: {} };
  }
}

// Real, direct fix (Sep 25): this real, rolling-20 record is
// inherently slow-moving — it genuinely can't shift much in the real,
// few minutes between two consecutive checks — but it was being
// recomputed from scratch, against the full database, on every single
// real check, both crons, every 5 real minutes, around the clock. On
// a database whose free tier scales its compute down to zero after 5
// real minutes of inactivity, being hit that often never let it
// actually rest, which is very likely the direct, real cause of a
// genuine, live quota-exceeded outage this same day. This caches the
// real result in memory for a real, moderate stretch (best-effort —
// a cold serverless instance just recomputes fresh, which is fine,
// never a correctness issue, only ever a cost one) so most checks
// reuse the same, real, recent answer instead of re-querying. Real,
// deliberate, honest limitation: this is ONE, shared cache, not
// separate windows per timeframe — every caller gets the same
// freshness, sized for the fastest timeframe that depends on it, not
// a longer one for slow timeframes specifically, since the current
// architecture fetches this once per check and shares it across every
// timeframe in that same check.
const LIVE_GATE_CACHE_MS = 30 * 60 * 1000; // 30 real minutes (v19.46: was 20, to let the database sleep)

// Real, deliberately separate data path (Oct 2), admin-only, never
// called from a cron or any hot, automated loop. getLiveVerifiedGate
// above filters out anything under LIVE_GATE_MIN_SAMPLE (5) real
// trades, which is correct for deciding what a real customer or push
// notification ever sees, but it means a signal with 1-4 real trades
// is completely invisible, even to admin, even though that thin, real
// data genuinely exists. This runs its own, separate, unfiltered
// query, every real combo down to a single trade, with its own,
// longer, independent cache (5 real minutes, not the shared 20-minute
// one above) — kept deliberately separate from getLiveVerifiedGate
// rather than modifying it, since that function sits on the hot path
// every cron check runs, and the Sep 28 Neon outage was directly
// caused by exactly this kind of query running too often; this one is
// never called unless a human actually opens the admin view.
const FULL_GATE_CACHE_MS = 15 * 60 * 1000; // 15 real minutes (v19.46: was 5, to let the database sleep)

// Pure grouping step, pulled out (Oct 7) so a caller that already has
// the resolved rows in hand (the public Watch Live route) can build the
// same, unfiltered rolling-20 gates without a second trip to the
// database. Rows must be newest-first within each (label, tf, dir),
// which both a global resolved_at DESC sort and the per-combo sort
// below satisfy.
export function buildGatesFromRows(rows, minSample = 1) {
  const groups = new Map();
  const regimeGroups = new Map();
  for (const r of rows) {
    const key = `${r.label}|${r.tf}|${r.dir}`;
    if (!groups.has(key)) groups.set(key, []);
    const arr = groups.get(key);
    if (arr.length < LIVE_GATE_WINDOW) arr.push(r.outcome);
    if (r.regime) {
      const rKey = `${key}|${r.regime}`;
      if (!regimeGroups.has(rKey)) regimeGroups.set(rKey, []);
      const rArr = regimeGroups.get(rKey);
      if (rArr.length < LIVE_GATE_WINDOW) rArr.push(r.outcome);
    }
  }
  const gate = {};
  for (const [key, outcomes] of groups) {
    if (outcomes.length < minSample) continue;
    const wins = outcomes.filter((o) => o === "win").length;
    gate[key] = { rate: wins / outcomes.length, n: outcomes.length };
  }
  const regimeGate = {};
  for (const [key, outcomes] of regimeGroups) {
    if (outcomes.length < minSample) continue;
    const wins = outcomes.filter((o) => o === "win").length;
    regimeGate[key] = { rate: wins / outcomes.length, n: outcomes.length };
  }
  return { gate, regimeGate };
}

async function fetchFullSignalGateFromDB() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return { gate: {}, regimeGate: {} };
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`
      SELECT label, tf, dir, outcome, regime
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
      ORDER BY label, tf, dir, resolved_at DESC
    `;
    return buildGatesFromRows(rows);
  } catch {
    return { gate: {}, regimeGate: {} };
  }
}

export async function getFullSignalGate(maxAgeMs = FULL_GATE_CACHE_MS) {
  return withCache("full-signal-gate", maxAgeMs, fetchFullSignalGateFromDB);
}

// Real, honest, admin-only confidence read (Oct 2) — every real
// signal, every timeframe, every direction, always, the moment any
// real data exists, labeled by real, actual sample size the whole
// time. Never used to decide what a real customer or a push
// notification sees — that stays provenContext() alone, unchanged,
// same deliberately strict bar as always.
//
// "established" is exactly today's "proven" bar — no change to what
// counts as established. "emerging" is a real, current edge, genuine
// but short of the full bar (a real, if smaller, sample, same
// LIVE_GATE_MIN_SAMPLE floor the live gate already trusts, at 55%+).
// "early" is any real data at all, however thin — shown, never
// hidden, always honestly labeled as thin rather than dressed up as
// more than it is.
export const CONFIDENCE_TIERS = {
  established: { label: "Established", order: 3 },
  emerging: { label: "Emerging", order: 2 },
  early: { label: "Early read", order: 1 },
  none: { label: "No data yet", order: 0 },
};
const EMERGING_MIN_RATE = 0.55;

export function confidenceTier(label, tfKey, dir, liveGate, regime, regimeGate, fullGate, fullRegimeGate) {
  const pc = provenContext(label, tfKey, dir, liveGate, regime, regimeGate);
  if (pc.tag === "proven") {
    return { tier: "established", rate: pc.rate, n: pc.isLive ? null : null, isLive: pc.isLive, verifiedVia: pc.verifiedVia, regimeStage: pc.regimeStage ?? null, phrase: pc.phrase };
  }

  const key = `${label}|${TF[tfKey]?.label || tfKey}|${dir}`;
  const overall = fullGate ? fullGate[key] : null;
  const regimeEntries = fullRegimeGate
    ? Object.entries(fullRegimeGate).filter(([k]) => k.startsWith(`${key}|`)).map(([k, v]) => ({ regime: k.slice(key.length + 1), ...v }))
    : [];
  const bestRegime = regimeEntries.sort((a, b) => b.rate - a.rate)[0] || null;

  if (overall && overall.n >= LIVE_GATE_MIN_SAMPLE && overall.rate >= EMERGING_MIN_RATE) {
    return { tier: "emerging", rate: overall.rate, n: overall.n, isLive: true, verifiedVia: "overall", regimeStage: null, phrase: `Currently ${Math.round(overall.rate * 100)}% on its last ${overall.n} real trades — real, but under the bar.` };
  }
  if (bestRegime && bestRegime.n >= LIVE_GATE_MIN_SAMPLE && bestRegime.rate >= EMERGING_MIN_RATE) {
    return { tier: "emerging", rate: bestRegime.rate, n: bestRegime.n, isLive: true, verifiedVia: "regime", regimeStage: bestRegime.regime, phrase: `Currently ${Math.round(bestRegime.rate * 100)}% specifically when the market's ${bestRegime.regime} (${bestRegime.n} real trades) — real, but under the bar.` };
  }
  if (overall && overall.n > 0) {
    return { tier: "early", rate: overall.rate, n: overall.n, isLive: true, verifiedVia: "overall", regimeStage: null, phrase: `Only ${overall.n} real trade${overall.n === 1 ? "" : "s"} so far, ${Math.round(overall.rate * 100)}% — too early to trust.` };
  }
  if (bestRegime && bestRegime.n > 0) {
    return { tier: "early", rate: bestRegime.rate, n: bestRegime.n, isLive: true, verifiedVia: "regime", regimeStage: bestRegime.regime, phrase: `Only ${bestRegime.n} real trade${bestRegime.n === 1 ? "" : "s"} so far when the market's ${bestRegime.regime}, ${Math.round(bestRegime.rate * 100)}% — too early to trust.` };
  }
  return { tier: "none", rate: null, n: 0, isLive: false, verifiedVia: null, regimeStage: null, phrase: "No real trades logged yet on this combo." };
}

export async function getLiveVerifiedGate(maxAgeMs = LIVE_GATE_CACHE_MS) {
  return withCache("live-verified-gate", maxAgeMs, fetchLiveVerifiedGateFromDB);
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



/* -------------------------------- signals -------------------------------- */

// v25.4: empty. The old list of killed combinations went with the original signals (history: memory/signal-roster.md, git).
export const KILLED_COMBOS = [];

export function computeSignals(candles, tfKey, th, opts = {}) {
  const n = candles.length;
  if (n < 30) return { signals: [], warming: true, snap: null };
  const ctx = buildSignalContext(candles, tfKey, th, opts);
  const { price, pct, r, trend } = ctx;

  const signals = [];
  const detectors = [
    detectMomentum, // the only original detector left: Calm Rider (lib/calmRider.js) runs on it. v25.4 removed the other eleven.
  ];
  for (const detect of detectors) {
    const found = detect(ctx);
    if (found) signals.push(...(Array.isArray(found) ? found : [found]));
  }
  const live = signals
    .filter((s) => !KILLED_COMBOS.includes(`${s.label}|${tfKey}|${s.dir}`))
    // Below the minimum target: still returned (so it gets logged), but
    // flagged and stripped of its verified tier everywhere downstream.
    .map((s) => (s.target != null && belowTargetFloor(tfKey, s.entry, s.target) ? { ...s, tier: null, belowFloor: true } : s));

  return { signals: live, warming: false, snap: { price, pct, rsi: r, volRatio: ctx.volRatio, atr: ctx.a, trend } };
}

// Every real, shared value every detector needs, computed once, up front,
// so no detector recomputes the same thing twice and every one reads from
// the exact same, single source. A detector-specific value that only one
// signal ever needs (like Reversal watch's own coin-stretch check) stays
// local to that detector instead of living here.
function buildSignalContext(candles, tfKey, th, opts) {
  const n = candles.length;
  const now = opts.now || Date.now();
  const liveGate = opts.liveGate || null;
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
  const regimeGate = opts.regimeGate || null;
  const regime = regimeGate ? marketRegime(candles, tfKey)?.stage || null : null; // only worth computing when there's a real gate to check it against
  return { candles, tfKey, th, opts, n, now, liveGate, regimeGate, regime, closes, highs, lows, vols, price, pct, volAvg, volRatio, r, e9, e21, a, trend, bias, risk, last };
}





function detectMomentum(ctx) {
  const { pct, th, volRatio, trend, bias, price, a, tfKey, liveGate } = ctx;
  if (Math.abs(pct) < th.pctMin) return null;
  const dir = pct > 0 ? "bull" : "bear";
  const vc = volumeContext(volRatio);
  const tc = trendContext(trend, dir);
  const bc = biasContext(bias, dir);
  // Real, direct promotion (Sep 21): 4h long specifically, only when
  // it's genuinely fighting the broader bias, not riding with it,
  // real 93% on a solid 30-fire sample, found after a real, fast
  // market move this exact setup would have caught and we had no data
  // on at all, since Momentum had never been promoted or logged
  // anywhere. The blended, ungated number for this same combination
  // is a much weaker 66%, mostly propped up by this one, real,
  // against-bias slice — so the gate below shows this specific
  // combination as genuinely proven only in the real condition that
  // actually earned it, same as every other real, condition-gated
  // signal here.
  const isGatedCombo = tfKey === "4h" && dir === "bull";
  const gateMet = !isGatedCombo || bc.tag === "against";
  const pc = gateMet ? provenContext("Momentum", tfKey, dir, liveGate, ctx.regime, ctx.regimeGate) : { tag: null, boost: 0, phrase: null, rate: null, isLive: false, verifiedVia: null };
  const strength = clamp((Math.abs(pct) - th.pctMin) / th.pctMin + vc.boost + tc.boost + pc.boost + bc.boost);
  const note = joinNote(`${pct > 0 ? "+" : ""}${pct.toFixed(2)}% in one ${TF[tfKey].label} bar.`, vc.phrase, tc.phrase, bc.phrase, pc.phrase);
  return { type: "move", label: "Momentum", dir, strength, volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, tierRate: pc.rate, tierIsLive: pc.isLive, note, ...levels(price, a, dir) };
}







