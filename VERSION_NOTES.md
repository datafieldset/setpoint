# Setpoint v7.3

## Fixed a real leftover: the warning text still blamed Telegram

Found and fixed one genuine bug: after replacing the whale data source with Coinbase in v7.2, the staleness warning message itself was never updated, it was still hardcoded to say "a Telegram scrape, no official API," which is exactly why every report kept sounding like nothing had changed even though the actual source had. That's fixed now, on both the backtest page and the download report.

That explains why the wording looked identical. It doesn't explain why the exact same timestamp, to the second, has shown up across four separate rounds now. I checked every layer that could cause that on my end, fetch caching, database query caching, the page's own HTTP response headers, all three are correctly set to never cache, all three were already the exact category of bug fixed once before today elsewhere in this app, and none of them are the issue here. That specific pattern, the identical frozen second, points to something in how the page is being viewed, not what's actually deployed.
