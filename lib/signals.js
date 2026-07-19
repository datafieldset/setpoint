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
// one-time table. RSI oversold 5m bull was removed after collapsing across
// three consecutive runs (95% -> 71% -> 21% -> 18%) while the market's
// short-term character turned bearish, exactly the regime-shift problem the
// market bias layer exists to catch. EMA cross down 5m bear was removed
// after two consecutive weak runs (41-43% -> 21% -> 29%), dropping below the
// roughly 33% breakeven line the 2R payout requires. Everything else stays
// untagged unless it clears its own bar; most combinations simply don't have
// strong enough evidence yet to call good or bad, and pretending otherwise
// would be overfitting to a handful of runs over one market stretch.
// This table itself is still edited by hand from /api/backtest results, not
// pulled from a live source. The rolling scoreboard (app/api/scoreboard)
// tracks real live outcomes continuously but deliberately doesn't feed back
// into this table yet, same measure-first discipline as everything else.
export const PROVEN_COMBOS = new Set([
  "EMA cross up|30m|bull", "RSI oversold|15m|bull",
]);
export const WEAK_COMBOS = new Set([
  "EMA cross down|1h|bear", "Volume spike|30m|bull", "Volume spike|5m|bear",
  "RSI overbought|15m|bear", "EMA cross down|30m|bear", "RSI overbought|30m|bear",
]);
function provenContext(label, tfKey, dir) {
  const key = `${label}|${TF[tfKey]?.label || tfKey}|${dir}`;
  if (PROVEN_COMBOS.has(key)) return { tag: "proven", boost: 0.15, phrase: "This setup has backtested well, twice." };
  if (WEAK_COMBOS.has(key)) return { tag: "weak", boost: -0.30, phrase: "This setup has backtested poorly, twice." };
  return { tag: null, boost: 0, phrase: null };
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
  // the turn itself. Deliberately new and unproven on purpose, same as every
  // other signal starts out: it carries no proven/weak tag until real
  // backtest evidence earns one, so it stays hidden behind the "not yet
  // proven" toggle in Opportunities until it does. This is a genuinely
  // different, tighter bet than the ordinary "against bias" tag every other
  // signal can already carry, that one fires any time direction disagrees
  // with the tape; this one only fires when the tape itself looks stretched.
  if (bias && bias.dir && risk && risk.level !== "low") {
    const dir = bias.dir === "bull" ? "bear" : "bull"; // betting the stretched lean snaps back
    const vc = volumeContext(volRatio);
    const pc = provenContext("Reversal watch", tfKey, dir);
    let base = risk.level === "high" ? 0.55 : 0.35;
    // Two consistent backtest runs, both fairly large samples: betting a
    // beaten-down market bounces back on 1h (dir bull, fires when the
    // broader bias is bearish) has been the weakest slice this signal
    // produces, 29% then 26% win rate on 189 and 165 fired, easily its
    // biggest bucket either time. Other timeframes and the mirror rollover
    // bet don't show the same large, consistent gap yet, so this stays
    // targeted rather than a blanket discount on every bounce bet, tuning
    // to a small, noisy slice would be overfitting.
    if (dir === "bull" && tfKey === "1h") base -= 0.20;
    const strength = clamp(base + vc.boost + pc.boost);
    const note = joinNote(
      `${bias.dir === "bull" ? "Bullish" : "Bearish"} lean looks stretched.${risk.level === "high" ? " Sentiment is at an extreme too." : ""}`,
      vc.phrase, pc.phrase
    );
    signals.push({ type: "reversal", label: "Reversal watch", dir, strength, volTag: vc.tag, tier: pc.tag, note, ...levels(price, a, dir) });
  }

  if (Math.abs(pct) >= th.pctMin) {
    const dir = pct > 0 ? "bull" : "bear";
    const vc = volumeContext(volRatio);
    const tc = trendContext(trend, dir);
    const pc = provenContext("Momentum", tfKey, dir);
    const bc = biasContext(bias, dir);
    const strength = clamp((Math.abs(pct) - th.pctMin) / th.pctMin + vc.boost + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`${pct > 0 ? "+" : ""}${pct.toFixed(2)}% in one ${TF[tfKey].label} bar.`, vc.phrase, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "move", label: "Momentum", dir, strength, volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, note, ...levels(price, a, dir) });
  }
  if (volRatio >= th.volMult) {
    const dir = last.close >= last.open ? "bull" : "bear";
    const tc = trendContext(trend, dir);
    const pc = provenContext("Volume spike", tfKey, dir);
    const bc = biasContext(bias, dir);
    const strength = clamp((volRatio - th.volMult) / th.volMult + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`${volRatio.toFixed(1)}× the 20-bar average volume.`, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "volume", label: "Volume spike", dir, strength, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, note, ...levels(price, a, dir) });
  }
  if (r != null && r <= th.rsiLow) {
    const vc = volumeContext(volRatio);
    const tc = trendContext(trend, "bull");
    const pc = provenContext("RSI oversold", tfKey, "bull");
    const bc = biasContext(bias, "bull");
    const strength = clamp((th.rsiLow - r) / th.rsiLow + vc.boost + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`RSI ${r.toFixed(0)}, oversold reading.`, vc.phrase, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "rsi", label: "RSI oversold", dir: "bull", strength, volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, note, ...levels(price, a, "bull") });
  } else if (r != null && r >= th.rsiHigh) {
    const vc = volumeContext(volRatio);
    const tc = trendContext(trend, "bear");
    const pc = provenContext("RSI overbought", tfKey, "bear");
    const bc = biasContext(bias, "bear");
    const strength = clamp((r - th.rsiHigh) / (100 - th.rsiHigh) + vc.boost + tc.boost + pc.boost + bc.boost);
    const note = joinNote(`RSI ${r.toFixed(0)}, overbought reading.`, vc.phrase, tc.phrase, bc.phrase, pc.phrase);
    signals.push({ type: "rsi", label: "RSI overbought", dir: "bear", strength, volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, note, ...levels(price, a, "bear") });
  }
  if (e9.length && e21.length) {
    const i = n - 1;
    const dNow = (e9[i] ?? 0) - (e21[i] ?? 0), dPrev = (e9[i - 1] ?? 0) - (e21[i - 1] ?? 0);
    const vc = volumeContext(volRatio);
    if (dPrev <= 0 && dNow > 0) {
      const tc = trendContext(trend, "bull");
      const pc = provenContext("EMA cross up", tfKey, "bull");
      const bc = biasContext(bias, "bull");
      signals.push({ type: "cross", label: "EMA cross up", dir: "bull", strength: clamp(0.65 + vc.boost + tc.boost + pc.boost + bc.boost), volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, note: joinNote("9 EMA crossed above 21 EMA.", vc.phrase, tc.phrase, bc.phrase, pc.phrase), ...levels(price, a, "bull") });
    } else if (dPrev >= 0 && dNow < 0) {
      const tc = trendContext(trend, "bear");
      const pc = provenContext("EMA cross down", tfKey, "bear");
      const bc = biasContext(bias, "bear");
      signals.push({ type: "cross", label: "EMA cross down", dir: "bear", strength: clamp(0.65 + vc.boost + tc.boost + pc.boost + bc.boost), volTag: vc.tag, trendTag: tc.tag, biasTag: bc.tag, tier: pc.tag, note: joinNote("9 EMA crossed below 21 EMA.", vc.phrase, tc.phrase, bc.phrase, pc.phrase), ...levels(price, a, "bear") });
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
      signals.push({ type: "pace", label: "Volume building early", dir, strength: clamp((paceRatio - th.paceMult) / th.paceMult), note: `Volume already ${paceRatio.toFixed(1)}x the usual pace with ${pctLeft}% of the bar left.`, ...levels(price, a, dir) });
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
        signals.push({ type: "accumulation", label: "Quiet accumulation", dir: "bull", strength: clamp((volTrend - th.accumVolTrend) / th.accumVolTrend), note: `Volume up ${pickup}% over the last ${w} bars while price held inside a ${rangePct.toFixed(2)}% range.`, ...levels(price, a, "bull") });
      }
    }
  }

  return { signals, warming: false, snap: { price, pct, rsi: r, volRatio, atr: a, trend } };
}
