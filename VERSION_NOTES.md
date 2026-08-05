# Setpoint v7.4

## The actual root cause, confirmed from Coinbase's own documentation

Found it for real this time. The exact endpoint used in v7.1 and v7.2, /products/BTC-USD/trades, requires authentication, an API key and a signed request, confirmed directly from Coinbase's own docs. It was called with none. Every single request has been silently failing on an auth error and returning nothing, this whole time, on both the live dashboard panel and the backtest page's tracker. That's the entire reason nothing ever changed no matter what else got fixed around it, not caching, not Vercel, not Telegram.

Replaced it with something genuinely public and already proven working: 1-minute BTC candles, no authentication needed, no new signup, no new key. An unusually high-volume 1-minute bar compared to its own recent average stands in for a real burst of large trading activity, direction read from whether that bar closed up or down.

Tested the actual detection logic directly with realistic synthetic candle data before shipping, confirmed it correctly flags real bursts and correctly ignores normal activity.

Being straight about this: v7.1's fix never actually worked either, same underlying bug, it just failed quietly enough to look like nothing was wrong instead of crashing.
