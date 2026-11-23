// lib/flow.js
//
// Flow Rider (v25.1, Nov 22): a Bitcoin SHORT after heavy selling, while price is under its 50-day average. A public test. Pure logic, no
// network or database, like lib/flush.js and lib/trend.js, so the replay (scripts/replay-lowtf-flow3.mjs) and the cron run the same rules.
//
// What it does, in plain words:
//   Flow    : on Binance's 15 minute bars, "net flow" is (aggressive buying minus aggressive selling) divided by total volume, summed over the
//             last 24 hours. It is compared with the same number over the 30 days before it (a z-score). A z-score of -1.5 or lower is
//             unusually heavy selling.
//   Trend   : price (the close of that 15 minute bar) is under the average of the last 50 finished daily closes.
//   Trade   : both true -> a short at the open of the next 15 minute bar, stop 5% above, target 10% below (2R). If neither is touched in
//             7 days the trade is closed at the market (lib/resolve.js, meta.maxHoldMs). One trade at a time.
// Evidence (BTC, Aug 2017 to Nov 2026, Binance 15 minute bars with taker volume, cost 0.20% per trade, memory/overhaul-plan.md Nov 22).
// This module's own replay (scripts/replay-flow-live.mjs): 168 trades (about 18 a year), 50% win, +0.91% per trade (about +0.2R), +0.46% without
// the best 5%, first half +1.15% and second half +0.66%, the last 12 months +2.08% (24 trades), every era positive (2023-24 only +0.08%).
// The first study (scripts/replay-lowtf-flow3.mjs) said 217 trades and +0.98%: it did not skip bars after a gap in the data, this module does. The mirror
// long (heavy buying above the 50-day) failed the same test, so there is no long version. Caveats: three windows and two thresholds were
// tried before this one was picked, and without the 7-day close the 2023-24 era turns negative.

export const FLOW_LABEL = "Flow Rider";
export const FLOW_TFS = ["4h"];          // the chart the trade is shown and closed on (a swing trade lasting days)
export const FLOW_COIN = "BTC";
export const FLOW_BAR_MS = 15 * 60 * 1000;
export const FLOW_WINDOW_BARS = 96;      // 24 hours of 15 minute bars
export const FLOW_BASE_BARS = 96 * 30;   // the 30 days the flow is compared with
export const FLOW_Z = -1.5;
export const FLOW_AVG_DAYS = 50;
export const FLOW_STOP_PCT = 5;
export const FLOW_TARGET_PCT = 10;
export const FLOW_MAX_HOLD_MS = 7 * 24 * 3600 * 1000;
export const FLOW_MAX_AGE_MS = 30 * 60 * 1000; // a trigger older than this is skipped (a late cron run must not log a stale entry price)
export const FLOW_NEED_BARS = FLOW_BASE_BARS + FLOW_WINDOW_BARS + 8;

// bars: completed 15 minute bars ascending [{ time, open, high, low, close, vol, tb }] (tb = taker buy volume). Returns the net-flow series (null until a full window).
export function flowSeries(bars) {
  const n = bars.length, out = new Array(n).fill(null);
  let sn = 0, sv = 0;
  for (let i = 0; i < n; i++) {
    sn += 2 * bars[i].tb - bars[i].vol; sv += bars[i].vol;
    if (i >= FLOW_WINDOW_BARS) { sn -= 2 * bars[i - FLOW_WINDOW_BARS].tb - bars[i - FLOW_WINDOW_BARS].vol; sv -= bars[i - FLOW_WINDOW_BARS].vol; }
    if (i >= FLOW_WINDOW_BARS - 1 && sv > 0) out[i] = sn / sv;
  }
  return out;
}

// z-score of the flow at bar i against the FLOW_BASE_BARS values before it. null if there is not a full, gap-free history.
export function flowZ(series, bars, i) {
  if (i < FLOW_BASE_BARS + FLOW_WINDOW_BARS || series[i] == null) return null;
  let s = 0, s2 = 0;
  for (let j = i - FLOW_BASE_BARS; j < i; j++) { const v = series[j]; if (v == null) return null; s += v; s2 += v * v; }
  if (bars[i].time - bars[i - FLOW_BASE_BARS - FLOW_WINDOW_BARS].time !== (FLOW_BASE_BARS + FLOW_WINDOW_BARS) * FLOW_BAR_MS) return null; // a missing bar anywhere in the span
  const m = s / FLOW_BASE_BARS, v = Math.max(1e-12, s2 / FLOW_BASE_BARS - m * m);
  return (series[i] - m) / Math.sqrt(v);
}

// Average of the last 50 FINISHED daily closes before the day that holds time t, or null. days: [{ time (day start, ms), close }] ascending.
export function avg50At(days, t) {
  const dayStart = Math.floor(t / 864e5) * 864e5;
  const prev = days.filter((d) => d.time < dayStart && d.time + 864e5 <= dayStart);
  if (prev.length < FLOW_AVG_DAYS) return null;
  const last = prev.slice(-FLOW_AVG_DAYS);
  if (last[last.length - 1].time !== dayStart - 864e5) return null; // yesterday must be there
  return last.reduce((s, d) => s + d.close, 0) / FLOW_AVG_DAYS;
}

export function flowPlan(entry) {
  return { entry, stop: entry * (1 + FLOW_STOP_PCT / 100), target: entry * (1 - FLOW_TARGET_PCT / 100) };
}

// The newest finished bar's state, for the Market Meter. null if there is not enough data.
export function flowState(k15, days, now) {
  const done = k15.filter((b) => b.time + FLOW_BAR_MS <= now);
  if (done.length < FLOW_NEED_BARS) return null;
  const i = done.length - 1, z = flowZ(flowSeries(done), done, i), avg = avg50At(days, done[i].time);
  if (z == null || avg == null) return null;
  return { z, avg50: avg, price: done[i].close, below: done[i].close < avg, time: done[i].time };
}

// Every short that has just triggered. A trigger is a finished bar whose flow z <= FLOW_Z with the close under the 50-day average,
// and it is only returned while that bar is recent (so a late run never backfills old trades). Entry is the open of the bar after
// the trigger bar (the forming bar), as in the study; if that bar is not there yet, the trigger bar's close.
// Returns [{ barTime, entry, stop, target, z, avg50 }] oldest first.
export function flowFires(k15, days, now, scanMs) {
  const all = k15.slice().sort((a, b) => a.time - b.time);
  const done = all.filter((b) => b.time + FLOW_BAR_MS <= now);
  if (done.length < FLOW_NEED_BARS) return [];
  const series = flowSeries(done), out = [];
  for (let i = done.length - 1; i >= 0 && done[i].time + FLOW_BAR_MS > now - scanMs; i--) {
    const z = flowZ(series, done, i); if (z == null || z > FLOW_Z) continue;
    const avg = avg50At(days, done[i].time); if (avg == null || !(done[i].close < avg)) continue;
    const next = all.find((b) => b.time === done[i].time + FLOW_BAR_MS);
    out.push({ barTime: done[i].time, ...flowPlan(next ? next.open : done[i].close), z: Number(z.toFixed(2)), avg50: avg });
  }
  return out.reverse();
}
