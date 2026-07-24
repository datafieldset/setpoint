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

## v3.9 — Open Positions Panel

A fired signal used to disappear from the Opportunities feed the moment its live trigger condition stopped being true, even though the trade itself, entry/stop/target set at fire time, was still open and unresolved. The trade was always still being tracked in signal_track, it just became invisible.

New: a "Open positions" panel above Opportunities on the live dashboard, pulling straight from signal_track where outcome is still 'open'. Stays visible with a live price update until it actually resolves to a win or loss, same source of truth the scoreboard uses. New route: /api/open-positions.

## Also in v3.9: real target-vs-stop resolution, no more guessing

When a candle's high and low both touched target and stop, every resolve path (live scoreboard, download report, historical backtest) used to just assume it was a loss. That was a guess, not an answer.

Now it drills into real 1-minute candles covering just that one ambiguous bar and checks them in actual order to see which level was genuinely touched first. Works identically for every alert timeframe, 5m, 15m, 30m, or 1h, since 1-minute candles are finer than all of them (a 1h bar breaks into 60 of them, a 5m bar into 5). Only falls back to "loss" in the rare case even 1-minute data can't settle it.

Tested with synthetic data before shipping: target-first correctly resolves win, stop-first correctly resolves loss, genuinely-still-ambiguous correctly falls through to the safe default.

Applied everywhere this mattered: the live scoreboard's resolve loop (both the main backtest page and the download route each have their own copy), and the historical backtest replay itself.
