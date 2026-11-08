// lib/quietLog.js
//
// Quiet logging for the background signals (v22.2, Nov 7, Na: "if you can't test background signals then they have to be on").
// FOCUS_MODE keeps every original signal hidden and, since v19.41, switched off (it saved database time). Their record only ever
// grew from history replays, which can be wrong in ways live fills are not. This writes a row to signal_track for the few that
// earned a second look, Bitcoin only, and shows them nowhere: not in alerts, not on the dashboard, not in public stats
// (isSignalVisible hides every label that is not in VISIBLE_SIGNALS). The shared resolver closes them like any other trade.
//
// To add or drop one, edit QUIET_LOG. Nothing else needs to know the names.
//
// Chosen from a 2 year Bitcoin replay of every original signal (13,000 simulated trades, every target is 2R so break-even is 33%
// wins; all signals pooled came out at 33% and -0.008R, i.e. no edge as a group). These are the few that were positive in BOTH halves
// of the sample with 30 or more trades. Expect most of them to fade: about 25 combinations were looked at, so one or two good-looking
// ones are what luck alone would give. That is why they only log.
import { computeSignals, thresholdsFor, marketBias, windowPct, reversalRisk } from "./signals.js";

export const QUIET_LOG = [
  { label: "Momentum", tf: "30m", dir: "bull" },       // 58 trades, 45% wins, +0.345R, halves +0.45 / +0.24
  { label: "Momentum", tf: "15m", dir: "bull" },       // 108 trades, 42%, +0.250R, halves +0.50 / 0.00 (second half flat)
  { label: "Reversal watch", tf: "5m", dir: "bear" },  // 63 trades, 43%, +0.286R, halves +0.59 / -0.03 (stops >= 0.4%: +0.143R both halves)
  { label: "Grind Down", tf: "15m", dir: "bear" },     // 1,172 trades, 34%, +0.032R (643 with stop >= 0.4%: +0.050R, both halves)
];

export const QUIET_COIN = "BTC";
const BARS_NEEDED = 100;
const WINDOW = 300; // computeSignals sees at most this many bars, the same as the replay and the old cron

// `bars` = completed bars ascending, `forming` = the bar in progress (or null), `scanMs`/`now` as in trendRunner.
// Returns the entries that should be recorded: { label, tf, dir, bar, entry, stop, target, barTime }. Pure: no database.
export function quietFires(q, bars, forming, now, scanMs) {
  const baseMs = (bars.length > 1 ? bars[1].time - bars[0].time : 0) || 0;
  if (!baseMs || bars.length < BARS_NEEDED) return [];
  const out = [];
  for (let i = Math.max(BARS_NEEDED - 1, 0); i < bars.length; i++) {
    const bar = bars[i];
    if (bar.time + baseMs <= now - scanMs) continue; // older than the scan window
    const next = bars[i + 1] || forming;
    if (!next || next.time !== bar.time + baseMs) continue; // feed gap, or no entry bar yet
    const slice = bars.slice(Math.max(0, i - WINDOW + 1), i + 1);
    let signals;
    try {
      const bias = marketBias([{ sym: QUIET_COIN, pct: windowPct(slice, 8), isBTC: true }]);
      ({ signals } = computeSignals(slice, q.tf, thresholdsFor(q.tf), { now: bar.time + baseMs, marketBias: bias, reversalRisk: reversalRisk(bias, null) }));
    } catch { continue; }
    const s = signals.find((x) => x.label === q.label && x.dir === q.dir && x.stop > 0 && x.target > 0);
    if (!s) continue;
    const entry = next.open;
    const sane = q.dir === "bull" ? entry > s.stop && entry < s.target : entry < s.stop && entry > s.target;
    if (!sane) continue; // price already ran past the stop or target before the next bar opened
    out.push({ ...q, barTime: next.time, entry, stop: s.stop, target: s.target });
  }
  return out;
}
