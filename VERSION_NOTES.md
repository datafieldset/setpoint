# Setpoint v4.9

## Full audit: consolidated duplicated code, locked down exposed URLs

**Consolidation:** the resolve logic (fetchCoinbaseCandles, aggregate, the 1-minute ambiguous-bar drill-down) was copy-pasted across backtest/route.js, backtest/download/route.js, and close-alert/route.js, exactly why the ambiguous-bar fix earlier needed four separate edits in one day. Pulled all of it into lib/resolve.js, one shared source of truth. Also consolidated the password check into lib/access.js. Combined line count across the three main files dropped from 1555 to 1310, while adding consistent access control everywhere.

**Removed:** /api/resolved-positions entirely. It was a diagnostic tool built for one specific verification today, nothing in the live app depends on it.

**Access control, consistent everywhere now:** same shared key (honolulu26) used two ways depending on who's calling:
- Browser visitors to the backtest pages still get the familiar login popup (Basic Auth), or can pass ?key=honolulu26 directly
- Machine callers (this app's own client-side checks, GitHub's cron) use ?key=honolulu26 in the URL

Previously open-positions and close-alert had no protection at all, anyone with the link could hit them. Now all four remaining semi-internal routes (both backtest pages, open-positions, close-alert) require the same credential, one password to remember, consistent everywhere.
