# Setpoint v3.2

## Reversal watch — rebuilt

The old version fired on nothing but a stretched market lean and backtested weak (13-20% win rate across hundreds of fires). This version requires real confirmation before it fires at all.

**How it's weighted, based on actual research, not just intuition:**

- **Volume climax** (a real spike that's now fading) and **momentum deceleration** (each push getting smaller) — full weight on every timeframe. Both are real-time order-flow reads, nothing in the research ties their reliability to timeframe.
- **RSI divergence** and **consecutive candle streaks** — full weight on 30m/1h, half weight on 5m/15m. Every source on both flags them as noisy below an hour; divergence gets "faded by algorithmic market-makers within minutes" on short timeframes, streak tools are described as "optimized for Daily, Weekly, Monthly" charts.
- **Fear & Greed** — never counts on its own. It only updates once every 24 hours, so it can't time an entry, only support one that's already got a real confirmation behind it. Adds weight, but only after something else has already fired.

**Tiering:** stretched market (same baseline as before) + confirmation score ≥1.5 = Elevated, ≥2.5 = High. Below 1.5, it doesn't fire at all, a real change from before.

**Retired:** the old hardcoded -0.20 penalty on 1h bull bets (the specific weak slice from the prior version). The new confirmation gate should re-earn its own track record instead of carrying forward a patch built for the old, blunter logic.

**Tracking:** the backtest download report now has a dedicated "Reversal watch — confirmation tier breakdown" section, shown every run regardless of whether it clears 58% yet, since this is what tells us whether the rebuild is actually working.

**Scope note:** this uses the market's short/medium-term lean (the existing bias reading) as regime context, not the 200-week MA cycle position. The 200-week line moves far too slowly to matter on a per-candle basis, that stays a manual, macro-level read for now rather than a live input into this signal.

## Also in this version
- Backtest download report shows market condition analysis (bias/trend/volume breakdowns for winners)
- Signal tiers carry a real win rate percentage (SIGNAL_RATES table, 58% threshold)
- Fixed app/api/watchlist/route.js import that broke after the tier table rebuild

## Next steps
- Run a fresh backtest, check the Reversal watch confirmation-tier section
- Compare Elevated vs High tier performance once sample size builds
- Keep watching RSI oversold 1h Long and Volume spike 15m Long for paper trading
