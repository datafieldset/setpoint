# Setpoint v3.8

## Whale flow: confirmed direction, timestamp added, real color bug fixed

Restored the flipped labels (inflow → bullish, outflow → bearish) from v3.7, now backed by two consistent confirming observations, not a misread contradiction.

Added a timestamp: the panel now shows when the most recent whale transfer actually happened, not just the aggregate number.

Found and fixed a real bug while in there: the panel's background and text colors were never updated when the text got flipped. Inflow (now the bullish read) was still colored red, outflow (now bearish) was still colored green, backwards from the words sitting right next to them.

## Whale direction: real tracking surfaced on the backtest page

The transfer-level tracking system already existed (whale_track, checking real BTC price at 15m/30m/1h/4h/12h after each transfer), it just wasn't aggregated by direction anywhere visible. Now shown on the backtest page's Live tab: for each direction, what share of resolved checkpoints saw BTC actually higher, at every timeframe. This is the real test of the question, not a guess off memory of a couple events.

## Backtest page: reorganized into tabs

Three tabs instead of one long scroll: **Live** (Live scoreboard, Whale flow direction), **Signals** (Most consistent, over/underperforming, full breakdown), **Market** (by condition, turning points). Plain CSS, no JavaScript, so it can't break independent of anything else on the page.

## % coverage on alert cards: honest accounting

Checked every signal type that calls into the tier table. One genuine gap found: **"Momentum" has zero entries, ever.** Every other signal type has at least partial coverage. Rather than invent a number, it stays untagged until we have real backtest or live data for it.

Beyond that: the table currently covers 23 of roughly 44 realistic combos (4 timeframes × applicable directions across all signal types, Reversal watch excluded on purpose). The rest genuinely don't have 5+ real samples yet. Not tagging them isn't a bug, it's the system correctly refusing to claim a win rate it doesn't have. Coverage grows as more backtest runs and live fires accumulate.
