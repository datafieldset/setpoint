# Setpoint v7.1

## Whale flow: replaced the broken source entirely, not patched again

Investigated this myself directly this time. Fetched the actual Telegram page myself, confirmed it's genuinely alive and posting real transfers. Checked Whale Alert's own official API docs directly: there is no free tier at all, only a paid $29.95/mo plan with a 7-day trial. Given the evidence now clearly pointed to something structural (works everywhere tested, still failed from Vercel even after two different real fixes), continuing to patch the scraper wasn't going to work.

Replaced it entirely with something built on infrastructure this app already proves reliable: Coinbase's own trade feed, the same API every signal on this dashboard already depends on. The live "Large trade flow" panel (renamed from "Whale net flow") now tracks real, individual trades above $500k on Coinbase directly, net buy vs. sell pressure, no scraping, no third-party page that can silently break.

Worth being precise about what changed: this measures something genuinely different than before, real buy/sell pressure on one exchange, not wallet transfers across the whole blockchain. Direct and unambiguous instead of a debated proxy, more buying is simply bullish, more selling is simply bearish, no interpretation needed.

**Known remaining gap:** the backtest page's separate whale-tracking system (the one measuring price impact at 15m/30m/1h/4h/12h checkpoints) still depends on the same broken Telegram source. That's a bigger, separate rebuild, not touched in this fix, flagged clearly rather than left quietly inconsistent.
