# Setpoint v5.4

## RSI oversold: regime-aware, gated by trend

Jul 28's backtest showed RSI oversold collapsing uniformly against-trend across every timeframe (10-33%, all weak). Added a gate: it no longer fires when it would be fighting an established downtrend, only when neutral or aligned. Tested directly: confirmed it correctly suppresses in a real, strong downtrend scenario. Same detection logic underneath, unchanged, just no longer fires straight into the exact condition that just broke it.

## Four confirmed weak signals removed from live firing entirely

Each backed by repeated data across multiple runs, not one bad stretch:
- EMA cross down 30m bear (0%, consistent across runs)
- Volume building early, bear side on 5m and 15m (0% repeatedly)
- RSI overbought 5m bear (0%, confirmed multiple times)
- Quiet accumulation 1h bull (11% backtest, 20% live on a real 20-fire sample)

These will no longer fire on the live dashboard or show up in future backtests. Historical data on all of them stays in the SIGNAL_RATES table and memory for reference, nothing about the past record is erased, they just stop generating new noise going forward.
