// lib/flush.js
//
// Flush Rider (v22.7, Nov 8; volatility gate v25.0, Nov 22): buys the retest after a sharp, sudden drop to a new low, in a market that is already swinging hard. A public test. Pure logic, no
// network or database, like lib/trend.js and lib/rebound.js, so the replay (scripts/replay-flush.mjs) and the cron run the same rules.
//
// What it does, in plain words:
//   Flush   : a 1 hour candle whose low is 1.5% or more under its own open AND under the lowest low of the 48 hours before it.
//             Only one flush counts per 12 hours (every flush starts that pause, even one the volatility gate below skips, as in the study).
//   Gate    : (v25.0) the plan is only made when Bitcoin is already swinging hard: ATR (its normal 1 hour swing) at the flush bar is 1.5% or more
//             of the bar's close. Calm-market flushes did much worse in history.
//   Plan    : a resting buy just above the flush low: entry = flush low + 0.25 ATR, stop = flush low - 0.75 ATR (so the stop is 1 ATR
//             away), target = 3 times the risk above the entry. ATR is how far Bitcoin normally swings on that chart.
//   Fill    : the trade only opens if price comes back down to the entry within the next 24 hours, and it never opens if price
//             breaks the stop first. Most flushes retest: about 70% in 6.8 years of history, and that retest is what this buys.
//   Skipped : a plan whose stop sits closer than 0.6% of price. History had only 2 of those in 6.8 years, and the fee on a stop that
//             tight costs a third of the risk, so there is nothing to back it.
// Evidence for the v25.0 rule (BTC 1h, Aug 2017 to Nov 2026, cost 0.20% per trade, memory/overhaul-plan.md Nov 22, scripts/replay-bounce-walkforward.mjs):
// 117 trades (about 13 a year), 38% win, +0.45R, +0.33R without the best 5%, positive in 8 of 9 years, 0.5% chance by luck; a walk-forward that
// picked the gate each year from earlier years only chose 1.5% every time (62 trades, +0.64R vs +0.13R unfiltered). Weak spot: it rarely fires in
// calm years (4 trades in 2024 to 2026). Without the gate the 1.5% flush was only +0.07R.
// Older evidence for the v22.7 rule (2.5% flush, no gate; BTC 1h, Jan 2020 to Nov 2026, fee 0.15% round trip, memory/lessons-learned.md Nov 8): 123 fills from 219 flushes,
// 37% of trades made money, +0.34R after fees with a 3R target, positive in all four eras (+0.37, +0.32, +0.11, +0.53). The study's first
// run said +0.37R; this module's own replay (scripts/replay-flush.mjs with flushFires) gives the +0.34R, which is the number to trust.
// A fill counts the moment a candle's low touches the entry, which is generous (a real resting order can sit behind others).

export const FLUSH_LABEL = "Flush Rider";
export const FLUSH_TFS = ["1h"];
export const FLUSH_COIN = "BTC";          // Bitcoin only: BTC is the test bed
export const FLUSH_DROP_PCT = 1.5;        // open to low, in percent (v25.0: was 2.5, the volatility gate below keeps it selective)
export const FLUSH_MIN_ATR_PCT = 1.5;     // v25.0: ATR at the flush bar must be at least this % of its close (the market is already swinging hard)
export const FLUSH_LOOKBACK = 48;         // the low has to break the lowest low of this many bars
export const FLUSH_COOLDOWN = 12;         // bars before another flush can count
export const FLUSH_WAIT = 24;             // bars the resting buy waits for the retest
export const FLUSH_ENTRY_ATR = 0.25;
export const FLUSH_STOP_ATR = 0.75;
export const FLUSH_TARGET_R = 3;
export const FLUSH_MIN_RISK_PCT = 0.6;

export function isFlushBar(bars, i) {
  if (i < FLUSH_LOOKBACK) return false;
  const b = bars[i];
  if (!(b.open > 0) || (b.open - b.low) / b.open < FLUSH_DROP_PCT / 100) return false;
  let lo = Infinity;
  for (let j = i - FLUSH_LOOKBACK; j < i; j++) if (bars[j].low < lo) lo = bars[j].low;
  return b.low < lo;
}

export function flushPlan(bar, atr) {
  if (!(atr > 0)) return null;
  if (!(bar.close > 0) || (atr / bar.close) * 100 < FLUSH_MIN_ATR_PCT) return null; // calm market: no plan
  const entry = bar.low + FLUSH_ENTRY_ATR * atr;
  const stop = bar.low - FLUSH_STOP_ATR * atr;
  const risk = entry - stop;
  const riskPct = (risk / entry) * 100;
  if (riskPct < FLUSH_MIN_RISK_PCT) return null;
  return { entry, stop, target: entry + FLUSH_TARGET_R * risk, riskPct };
}

// Every Flush Rider buy that has just filled. `done` are completed bars, `forming` the bar in progress (or null), `atr` the
// ATR series for `done`. A fill is only returned while its bar is recent (so a late run never backfills old trades).
// Returns [{ barTime (the flush bar, one trade per flush), fillTime, entry, stop, target, riskPct, dropPct, flushLow }].
export function flushFires(done, forming, atr, now, scanMs, baseMs) {
  const all = forming ? done.concat([forming]) : done;
  const out = [];
  let lastFlush = -Infinity;
  const from = Math.max(FLUSH_LOOKBACK, done.length - (FLUSH_WAIT + 2 * FLUSH_COOLDOWN + 2)); // the extra cooldown of bars lets an older flush suppress a new one, as in the study
  for (let i = from; i < done.length; i++) {
    if (!isFlushBar(done, i) || i - lastFlush <= FLUSH_COOLDOWN) continue;
    lastFlush = i;
    const plan = flushPlan(done[i], atr[i]);
    if (!plan) continue;
    for (let k = i + 1; k <= i + FLUSH_WAIT && k < all.length; k++) {
      const bar = all[k];
      if (bar.time > done[i].time + FLUSH_WAIT * baseMs) break; // 24 hours of clock time, not 24 bars, so a feed gap cannot stretch it
      if (bar.low <= plan.stop) break;                       // broke the stop before it ever filled: no trade
      if (bar.low <= plan.entry) {
        if (bar.time + baseMs > now - scanMs) out.push({ barTime: done[i].time, fillTime: bar.time, ...plan, dropPct: Number(((done[i].open - done[i].low) / done[i].open * 100).toFixed(2)), flushLow: done[i].low });
        break;
      }
    }
  }
  return out;
}
