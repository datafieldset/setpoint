# Setpoint v3.0

## What Changed

### 1. Signal tiers now carry a real win rate percentage
Replaced the old binary PROVEN_COMBOS/WEAK_COMBOS lists in lib/signals.js with a single SIGNAL_RATES table that stores the actual backtested win rate per signal.

- 58%+ → tagged "proven", shows on the dashboard by default
- Below 58% → tagged "tested", hidden behind the toggle, but now shows its real percentage instead of just "weak"
- No clean sample yet → untagged, same as before

Dashboard cards now show "PROVEN 67%" or "TESTED 22%" instead of a flat label.

**Current table (from Jul 21 07:22 backtest, single run):**
- EMA cross up 5m bull: 59% (PROVEN)
- Volume spike 15m bull: 67% (PROVEN)
- EMA cross down 1h bear: 19% (tested)
- Volume spike 30m bull: 28% (tested)
- Volume spike 5m bear: 30% (tested)
- RSI overbought 15m bear: 22% (tested)
- EMA cross down 30m bear: 0% (tested)
- EMA cross up 30m bull: needs retest (no clean sample this run, old number retired)
- RSI oversold 15m bull: needs retest (no clean sample this run, old number retired)
- RSI overbought 30m bear: needs retest

### 2. Fixed a broken import
app/api/watchlist/route.js was importing PROVEN_COMBOS/WEAK_COMBOS which no longer exist after the change above. Updated it to check SIGNAL_RATES with the same 58% threshold.

## Next Steps
- Watch EMA cross up 5m bull and Volume spike 15m bull live for paper trading
- Rebuild Reversal watch with RSI divergence, volume climax, momentum deceleration, consecutive-candle streak, plus keep Fear & Greed
- Re-run backtest to build sample size and get clean numbers for EMA cross 30m / RSI oversold 15m again
