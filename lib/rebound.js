// lib/rebound.js
//
// Rebound Rider (v19.36): buys a dip inside an uptrend (or sells a pop inside
// a downtrend) once price has bounced back. A public test. Pure logic, no
// network or database, like lib/trend.js, so the study, the replay test and the
// cron all run the same rules. Runs on the 1 hour chart only: it was the only
// timeframe where the idea held on both Bitcoin and XLM (Oct 13 study,
// memory/lessons-learned.md). 30 minute and faster charts had no edge.
//
// What it does, in plain words (buys; sells are the mirror image):
//   Setup   : within the last 4 bars, price dipped more than 2 ATR below its
//             20-bar average (the stretch), and the bar that just finished
//             closed back above (average minus 1 ATR) on a green candle.
//   Needs   : price above its 200-day average, and the 1 hour chart trending
//             up (close above its 50-bar average). A dip in a downtrend is
//             not bought.
//   Entry   : the open of the next bar.
//   Exit    : the same plain stop and target as Trend Rider: stop 2 ATR from
//             the entry, target 0.75R the other way.
// Indicators are read from the last COMPLETED bar, so nothing peeks.

import { emaSeries } from "./trend.js";

export const REBOUND_TFS = ["1h"];
export const REBOUND_EMA = 20;      // the average the dip is measured from
export const DIP_ATR = 2;           // how far below it counts as a real dip
export const RECLAIM_ATR = 1;       // the bounce has to close back above (average - this)
export const DIP_LOOKBACK = 4;      // bars in which the dip may have happened
export const REBOUND_STOP_ATR = 2;
export const REBOUND_TARGET_R = 0.75;

// Everything the rules say about one bar. `bars` are COMPLETED bars, ascending,
// `i` is the last completed bar, `ema` is emaSeries(closes, REBOUND_EMA),
// `pre.atr` is the usual ATR series, `ctx` = { sma, htf }. `next` is the bar that
// follows bar i (completed or still forming); its open is the entry.
export function analyzeRebound(bars, pre, ema, i, next, ctx) {
  if (i < REBOUND_EMA + 15 || !pre.atr[i] || !next) return null;
  const atr = pre.atr[i];
  const sma = ctx.sma > 0 ? ctx.sma : null;
  const h = ctx.htf ? ctx.htf["1h"](bars[i].time) : null;
  const b = bars[i];
  const build = (dir) => {
    const L = dir === "bull";
    let stretched = false;
    for (let j = i - DIP_LOOKBACK + 1; j <= i; j++) {
      if (L ? bars[j].low < ema[j] - DIP_ATR * pre.atr[j] : bars[j].high > ema[j] + DIP_ATR * pre.atr[j]) stretched = true;
    }
    const conds = [
      { key: "avg200", label: L ? "Price above its 200-day average" : "Price below its 200-day average", ok: sma !== null && (L ? b.close > sma : b.close < sma) },
      { key: "htf1h", label: L ? "1h chart trending up" : "1h chart trending down", ok: !!h && (L ? h.close > h.ema : h.close < h.ema) },
      { key: "dip", label: L ? `Dipped more than ${DIP_ATR} ATR below its average` : `Popped more than ${DIP_ATR} ATR above its average`, ok: stretched },
      { key: "bounce", label: L ? "Bounced back, green candle" : "Bounced back, red candle", ok: L ? b.close > ema[i] - RECLAIM_ATR * atr && b.close > b.open : b.close < ema[i] + RECLAIM_ATR * atr && b.close < b.open },
    ];
    const ok = conds.every((c) => c.ok);
    const entry = next.open;
    const risk = REBOUND_STOP_ATR * atr;
    return {
      dir, ok, fire: ok, conds, entry, risk,
      stop: L ? entry - risk : entry + risk,
      target: L ? entry + REBOUND_TARGET_R * risk : entry - REBOUND_TARGET_R * risk,
    };
  };
  return { atr, bull: build("bull"), bear: build("bear") };
}

export const reboundEma = (bars) => emaSeries(bars.map((x) => x.close), REBOUND_EMA);
