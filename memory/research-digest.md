# Research digest: what we tested, what we learned, where the data is (Nov 24, Na: "a summary of everything important ... useful as we develop more signals")

Read this before starting any new signal idea, so we don't re-run settled tests. The full pre-registered rules and results are in `overhaul-plan.md`; this is the short version. Re-check live signal state with `node memory/check-signal-state.mjs` (this file does not restate it).

## The framework (every test, BTC only)
Cost 0.20% round trip (also read at 0.12% for KuCoin futures taker). Pass bar: 50+ trades (40 if rare), positive after cost in every era with 8+ trades (2017-19, 2020-21, 2022, 2023-24, 2025-26), positive without the best 5%, both halves positive, beats 95% of random draws, and the locked exam (Nov 7 2025 to now) not negative. One trade at a time, every variant counted, rules written before running. A pass goes live only as a public test.

## Scoreboard (Nov 23-24 short-timeframe hunt: about 230 variants, 0 passes)
- Candles and indicators on 5m/15m (RSI, MAs, VWAP, EMA 9/21, StochRSI, volume spikes, time of day, events): nothing clears the cost. Fast signals sit at the cost floor.
- Coinbase premium (follow, 24h) and crowded positioning (fade, 4h): real from 2020 to 2024, gross about zero in every regime since 2025.
- Funding, perp premium, basis, liquidation-cascade proxy, agents' ideas 1-4: no pass.
- OKX order book depth imbalance (24 sampled days, Mar 2023 to Oct 2026): 5/15/30 min gross about +0.00%, net about -0.115%, 0 of 24 days positive. Agent 2's one-sided thinning rule never triggered. Book covers only about 4 bp each side of price.
- What survived: Flow Rider ("Pressure", 24h taker net flow short with RSI > 50): 111 trades, about 12 a year, 53% win, +1.39% a trade in the replay; live caveat in `signal-roster.md`.

## Lessons that carry over
- The market did not become random; the edges that existed in 2020-2024 vanished after 2025. Always split by era.
- Free-index and look-ahead bugs bite: use one trade at a time, `.loc` (not `[]`) for integer-minute slices in pandas.
- Short timeframes need a cost under about 0.05% to work, which is only possible with maker orders and adverse selection kills those.

## Still untested (no free history)
Liquidation history, options skew/GEX, open interest by strike, on-chain exchange flows, KuCoin-vs-Binance perp spread (needs KuCoin kline paging), deeper order book than 400 levels. The collector (`scripts/collect-market.mjs`, workflow collect-market, `data` branch) is the way to build our own history for these. Scheduled runs had not started as of Nov 24 10:55 Honolulu.

## Data and how to get it back
- `memory/data/btc-daily.csv`: one row per UTC day, Aug 2017 to Nov 2026 (price, volume, taker buy share, Coinbase premium; funding and perp premium from 2020; open interest and long/short ratios from Sep 2020; Deribit vol index from Mar 2021). Funding and premium end Oct 31 2026. Rebuild with `scripts/study5/build_daily_digest.py`.
- Raw 1m/5m/15m files (about 3.7 GB) are NOT in git (too big, and public). Re-download with `scripts/study5/fetch_data.py`, `fetch_data2.py`, `fetch_data3.py` (data.binance.vision, Coinbase, Deribit). OKX book days: `study19_extract.py`.
- Live trade record: `node scripts/pull-trades.mjs`.
- Study scripts 1-19: `scripts/study5/`.
