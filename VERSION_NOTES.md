# Setpoint v3.1

## What Changed

### New: Whale flow price-impact tracker
New route: `/api/whale-track`. Visit it in a browser like `/api/scoreboard`, any time.

**What it does:**
1. Logs every large transfer Whale Alert posts (via the same free Telegram feed `/api/news` already reads), deduped by the transfer's Telegram link so revisiting doesn't double-count
2. Checks BTC price at 15m, 30m, 1h, 4h, and 12h after each transfer fired, filling in whichever checkpoints have had enough time pass
3. Reports whether price actually moved the "traditionally expected" direction (inflow onto exchange → down, outflow off exchange → up) — the same question Na raised about whether that assumption even holds

**Why BTC specifically, regardless of which asset the whale moved:** the question isn't "does an ETH whale move affect ETH price," it's whether large exchange flow in general is a useful market read. BTC is the cleanest bellwether for that, same logic the existing pooled net-flow panel in Market Context already uses.

**New table:** `whale_track` in Neon, auto-created on first visit same as every other table in this app (no manual SQL needed). Columns: link (unique, for dedup), asset, usd_amount, direction, fired_at, btc_price_at_fire, price_15m/30m/1h/4h/12h, resolved_15m/30m/1h/4h/12h.

**Resolution happens on visit, not on a schedule** — same pattern as `/api/scoreboard`, no cron job (Na doesn't want to pay for that Vercel tier yet).

### Backtest download now includes whale flow data
`/api/backtest/download` report now has a "Whale flow price impact" section: individual events with their checkpoint price changes, plus an aggregate table showing what % of the time price actually moved the traditionally-expected direction per checkpoint. Wrapped so a database hiccup can't break the rest of the backtest report.

## Still open
- Not enough data logged yet to say anything real about the inflow/outflow question — this just starts the clock. Revisit `/api/whale-track` periodically (or check the backtest download) to watch the sample build.
- Reversal watch rebuild (RSI divergence, volume climax, momentum deceleration, consecutive-candle streak, Fear & Greed) still pending from before this.
