# Setpoint v7.2

## The other whale system, actually fixed this time

v7.1 only fixed the live dashboard's panel and explicitly left the backtest page's deeper whale-tracking system (the one with price impact at 15m/30m/1h/4h/12h checkpoints) on the old broken Telegram source, that's what was still showing "183 hours stale." Should have just finished the job instead of leaving it split. Fixed now.

Same real replacement as the live panel: whale-track/route.js reads directly from Coinbase's own trade feed instead of scraping Telegram, real large trades ($500k+) on BTC, logged and checked against real price the same way as before, just a real, reliable source underneath instead of a page that goes silently blocked for a week.

Kept the exact same internal plumbing (direction vocabulary, checkpoint resolution, the aggregation table) so nothing about how this data flows had to change, only where it originates. Updated the labels ("Large sell trades" / "Large buy trades") to honestly describe what's actually being measured now, not leftover wording from the wallet-transfer era.

Also cleaned up the now-fully-dead Telegram whale channel fetch in the news route, it was being fetched and then immediately filtered out and unused, real wasted work for nothing, removed entirely.
