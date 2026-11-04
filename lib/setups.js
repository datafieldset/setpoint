// lib/setups.js
//
// One market moment is one SETUP, even when it makes several rows in signal_track (Na, Nov 4). Example: Bitcoin lines up for
// a buy and Trend Rider fires on the 5m, 15m, 30m and 1h charts with the same entry. That is 4 trades but one idea, and the 4
// rows win or lose together, so counting them as 4 makes the record look bigger and surer than it is.
//
// Rule, in one place so every surface counts the same way: trades of the same signal, coin and direction that fired within
// SETUP_WINDOW_MS of the first one belong to one setup. A setup's result is its FIRST alert (earliest fired_at; if two share the
// time, the faster chart), because that is what someone acting on the first alert would have got. Rows only need
// { label, coin, dir, tf, outcome, r, fired_at }.
import { avgResult } from "./results.js";

export const SETUP_WINDOW_MS = 10 * 60 * 1000;
const TF_RANK = { "1m": 0, "5m": 1, "15m": 2, "30m": 3, "1h": 4, "4h": 5, "1d": 6 };

export function groupSetups(rows, windowMs = SETUP_WINDOW_MS) {
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.label}|${r.coin}|${r.dir}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const firsts = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => new Date(a.fired_at) - new Date(b.fired_at) || (TF_RANK[a.tf] ?? 9) - (TF_RANK[b.tf] ?? 9));
    let start = null;
    for (const r of list) {
      const t = new Date(r.fired_at).getTime();
      if (start === null || t - start > windowMs) { start = t; firsts.push(r); }
    }
  }
  const wins = firsts.filter((r) => r.outcome === "win").length;
  return { setups: firsts.length, wins, losses: firsts.length - wins, rate: firsts.length ? wins / firsts.length : null, avgR: avgResult(firsts) };
}
