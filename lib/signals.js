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
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
const clamp = (x) => Math.max(0, Math.min(1, x));

// Volume is the highest-priority context on every non-volume signal. A move,
// an RSI extreme, or an EMA cross means something different depending on
// whether real volume is behind it. This keeps that judgment inside the
// mechanical signal itself, not just in the AI commentary layer.
function volumeContext(volRatio) {
  if (volRatio >= 1.6) return { tag: "confirmed", boost: 0.18, phrase: `volume running ${volRatio.toFixed(1)}x average backs it` };
  if (volRatio >= 1.15) return { tag: "rising", boost: 0.08, phrase: `volume is picking up (${volRatio.toFixed(1)}x average)` };
  if (volRatio <= 0.6) return { tag: "light", boost: -0.18, phrase: `volume is light (${volRatio.toFixed(1)}x average), so conviction is unclear` };
  return { tag: null, boost: 0, phrase: null };
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
  const last = candles[n - 1];
  const signals = [];

  if (Math.abs(pct) >= th.pctMin) {
    const dir = pct > 0 ? "bull" : "bear";
    const vc = volumeContext(volRatio);
    const strength = clamp((Math.abs(pct) - th.pctMin) / th.pctMin + vc.boost);
    const note = `${pct > 0 ? "+" : ""}${pct.toFixed(2)}% in one ${TF[tfKey].label} bar` + (vc.phrase ? `, ${vc.phrase}` : "");
    signals.push({ type: "move", label: "Momentum", dir, strength, volTag: vc.tag, note, ...levels(price, a, dir) });
  }
  if (volRatio >= th.volMult) {
    const dir = last.close >= last.open ? "bull" : "bear";
    signals.push({ type: "volume", label: "Volume spike", dir, strength: clamp((volRatio - th.volMult) / th.volMult), note: `${volRatio.toFixed(1)}× the 20-bar average volume`, ...levels(price, a, dir) });
  }
  if (r != null && r <= th.rsiLow) {
    const vc = volumeContext(volRatio);
    signals.push({ type: "rsi", label: "RSI oversold", dir: "bull", strength: clamp((th.rsiLow - r) / th.rsiLow + vc.boost), volTag: vc.tag, note: `RSI ${r.toFixed(0)}, oversold reading` + (vc.phrase ? `, ${vc.phrase}` : ""), ...levels(price, a, "bull") });
  } else if (r != null && r >= th.rsiHigh) {
    const vc = volumeContext(volRatio);
    signals.push({ type: "rsi", label: "RSI overbought", dir: "bear", strength: clamp((r - th.rsiHigh) / (100 - th.rsiHigh) + vc.boost), volTag: vc.tag, note: `RSI ${r.toFixed(0)}, overbought reading` + (vc.phrase ? `, ${vc.phrase}` : ""), ...levels(price, a, "bear") });
  }
  if (e9.length && e21.length) {
    const i = n - 1;
    const dNow = (e9[i] ?? 0) - (e21[i] ?? 0), dPrev = (e9[i - 1] ?? 0) - (e21[i - 1] ?? 0);
    const vc = volumeContext(volRatio);
    if (dPrev <= 0 && dNow > 0) signals.push({ type: "cross", label: "EMA cross up", dir: "bull", strength: clamp(0.65 + vc.boost), volTag: vc.tag, note: "9 EMA crossed above 21 EMA" + (vc.phrase ? `, ${vc.phrase}` : ""), ...levels(price, a, "bull") });
    else if (dPrev >= 0 && dNow < 0) signals.push({ type: "cross", label: "EMA cross down", dir: "bear", strength: clamp(0.65 + vc.boost), volTag: vc.tag, note: "9 EMA crossed below 21 EMA" + (vc.phrase ? `, ${vc.phrase}` : ""), ...levels(price, a, "bear") });
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
      signals.push({ type: "pace", label: "Volume building early", dir, strength: clamp((paceRatio - th.paceMult) / th.paceMult), note: `Volume already ${paceRatio.toFixed(1)}x the usual pace with ${pctLeft}% of the bar left`, ...levels(price, a, dir) });
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
        signals.push({ type: "accumulation", label: "Quiet accumulation", dir: "bull", strength: clamp((volTrend - th.accumVolTrend) / th.accumVolTrend), note: `Volume up ${pickup}% over the last ${w} bars while price held inside a ${rangePct.toFixed(2)}% range`, ...levels(price, a, "bull") });
      }
    }
  }

  return { signals, warming: false, snap: { price, pct, rsi: r, volRatio, atr: a } };
}
