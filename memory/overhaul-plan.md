# Signal overhaul plan (Nov 11, Na: "ok do it and push")

Goal: at least one signal we can stand behind, because the signals are what Setpoint sells. "Reliable" means a positive average after costs on enough trades, in more than one market period, then confirmed live. It does not mean it wins every time.

Rules are written here BEFORE results are looked at. Do not move the bar after seeing a number.

## Pass bar (same for every signal, live or hidden)
- Bitcoin only (standing rule).
- Costs: 0.15% round trip fee plus 0.05% slippage, so 0.20% per trade. Fees stay in our grading only, not in what customers see (Na, Oct 11).
- Positive after costs in every era that has at least 8 trades: 2020-21, 2022, 2023-24, 2025 (to the lock date).
- Enough trades: 100+ on charts under 1 hour, 50+ on 1 hour and slower.
- Still positive with its best 5% of trades removed.
- Beats the luck test: clearly better than random entries with the same stop and target, taken in the same trend conditions.
- Then the locked exam: the most recent 12 months of data (Nov 7 2025 to Nov 6 2026) are graded once, at the end.
- Honest limit: Swing Rider and Flush Rider were designed with those 12 months in view, so the exam is only clean for new ideas. For those two the real exam is the live record.

## Steps
1. Scoreboard: replay every signal under the rules above, with the luck test. Retire what fails (list it for Na first, retiring is a code change and needs his yes).
2. Stress-test Swing Rider and Flush Rider: worse fills, shifted start dates, losing streaks, drawdown, time in trade, 1-minute data for which-was-hit-first, Coinbase prices instead of Binance.
3. A few improvements from a short written list (below), each counted, each judged on data it was not tuned on (tune on one stretch, test on the next, roll forward).
4. Look for a third candidate, a few ideas only: slow charts, bigger targets, trend filters. Biggest gap: every live signal is a buy and most go quiet under the 200-day, so there is nothing for a bear market.
5. Live proof: sellable at 20+ live trades with a positive average; compare live to replay monthly.

## Idea list (add here BEFORE testing; count every try)
- Flush Rider: only below the 50-day (seen Nov 8 as a subgroup cut, so it needs fresh data or the live record).
- A down-market or sell-side candidate (not designed yet).
- "Move the stop to break-even" exit that still fits the fixed card (layout question for Na before building).

## Guardrails
No look-ahead (use only what was visible at entry; see the Nov 8 Volume spike trap). Memory updated with every change. A separate agent re-checks anything customers see. Nothing ships to the site without Na's yes.
