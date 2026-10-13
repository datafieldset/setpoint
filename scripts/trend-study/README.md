# Trend Rider study kit

Not part of the app. These scripts run the REAL engine (`lib/trend.js`, `lib/trendRunner.js`) over saved Coinbase candles, so a change to the rules can be tested before it ships.

1. Download candles into a working folder: `node fetch-candles.mjs 86400 10 BTC_1d.json`, then `3600 6 BTC_1h.json`, `900 1 BTC_15m.json`, `300 0.5 BTC_5m.json`, `60 0.17 BTC_1m.json`.
2. `node replay.mjs 4h,1h,30m,15m,5m,1m` replays the rules bar by bar with the live exits (2 ATR stop, 0.75R target). The 4h to 5m results are in memory/version-history.md (v19.31). Takes several minutes for the fast timeframes.
3. `node e2e.mjs 2026-10-05T00:00:00Z 2026-10-12T17:00:00Z` drives `runTrend` and the shared resolver with a real Postgres (pglite, point `PGLITE` at an installed copy) and a fake feed, stepping 5 minutes at a time like the cron. It takes fewer 1m and 5m trades than the plain replay, because the live runner waits for the resolver before re-entering.

Run these from the folder holding the candle files. Never download two assets into one filename (an ETH download once overwrote the BTC daily file).
