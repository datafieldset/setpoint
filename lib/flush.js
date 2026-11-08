// lib/flush.js
//
// Flush Rider (v22.7, Nov 8): buys the retest after a sharp, sudden drop to a new low. A public test. Pure logic, no
// network or database, like lib/trend.js and lib/rebound.js, so the replay (scripts/replay-flush.mjs) and the cron run the same rules.
//
// What it does, in plain words:
//   Flush   : a 1 hour candle whose low is 2.5% or more under its own open AND under the lowest low of the 48 hours before it.
//             Only one flush counts per 12 hours.
//   Plan    : a resting buy just above the flush low: entry = flush low + 0.25 ATR, stop = flush low - 0.75 ATR (so the stop is 1 ATR
//             away), target = 3 times the risk above the entry. ATR is how far Bitcoin normally swings on that chart.
//   Fill    : the trade only opens if price comes back down to the entry within the next 24 hours, and it never opens if price
//             breaks the stop first. Most flushes retest: about 70% in 6.8 years of history, and that retest is what this buys.
//   Skipped : a plan whose stop sits closer than 0.6% of price. History had only 2 of those in 6.8 years, and the fee on a stop that
//             tight costs a third of the risk, so there is nothing to back it.
// Evidence (BTC 1h, Jan 2020 to Nov 2026, fee 0.15% round trip, memory/lessons-learned.md Nov 8): 123 fills from 219 flushes,
// 37% of trades made money, +0.34R after fees with a 3R target, positive in all four eras (+0.37, +0.32, +0.11, +0.53). The study's first
// run said +0.37R; this module's own replay (scripts/replay-flush.mjs with flushFires) gives the +0.34R, which is the number to trust.
// A fill counts the moment a candle's low touches the entry, which is generous (a real resting order can sit behind others).

export const FLUSH_LABEL = "Flush Rider";
export const FLUSH_TFS = ["1h"];
export const FLUSH_COIN = "BTC";          // Bitcoin only: BTC is the test bed
export const FLUSH_DROP_PCT = 2.5;        // open to low, in percent
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
