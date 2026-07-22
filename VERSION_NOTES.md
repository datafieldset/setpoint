# Setpoint v3.3

## Every backtested signal now shows its own % on the dashboard

Expanded SIGNAL_RATES to cover every combo we've actually measured across all three backtest runs so far, not just the original hand-picked set. Any signal with real data now shows its number on the card, "PROVEN 64%" or "TESTED 19%", instead of staying blank just because it wasn't one of the first few added.

**What's in the table now, and why:**

- Volume spike 15m Long: 64% (averaged across 3 consistent runs: 67%, 64%, 60%) — most reliable read we have
- EMA cross up 5m Long: moved back to needsRetest — 59% on one clean run, but a later run's sub-slice showed only 13%, not confident enough to call this proven yet
- RSI oversold 1h Long: 71% (one run only, during a visibly bullish market, didn't fire enough to register in the next run) — kept the number but flagged as likely regime-dependent, worth retesting across different market conditions
- EMA cross down 15m Short: 21% (a 26-sample run overturned an earlier 67% read from just 7 fires — small sample was noise)
- EMA cross down 1h Short: 20% (19% and 21% across two runs, consistent)
- RSI overbought 15m Short: 19% (22% then 19% on a 58-sample run)
- EMA cross down 30m Short: 0% (twice, consistent)
- Volume spike 5m Short: 19% (updated from an older 30% single-run read to a larger 39-sample run)
- RSI overbought 1h Short: 24% (new, one run)
- EMA cross down 5m Short: needsRetest (no clean baseline sample yet)

**Reversal watch is deliberately left out of this table.** The confirmation-gate rebuild only fired 1-2 times per combo in its first run, nowhere near enough to score honestly. Scoring it now would just be a fake-precise number on a coin flip's worth of data.

## Next steps
- Keep running backtests to build sample size, especially for combos still marked needsRetest
- Watch whether RSI oversold 1h Long comes back once the market leans bullish again, confirming the regime-dependence theory
- Still need to look into the whale_track table error for whale flow price impact
