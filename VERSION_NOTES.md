# Setpoint v4.3

## Open positions still not resolving — this version finds out why, doesn't guess

v4.2's resolve step had a real silent failure mode: if the Coinbase fetch failed for any reason (rate limiting, network hiccup, anything), the code just skipped that entire group of positions with no error logged anywhere. That could fully explain why positions are still sitting open with price clearly already past stop.

Rather than guess a fix, this version makes the resolve step report exactly what it's doing every time it runs: which coin/timeframe groups it checked, how many candles it got back, how many positions it resolved, how many it had to skip and why, and any fetch errors it hit. All of this now comes back in the /api/open-positions response itself under "resolveDebug", visible by just visiting that URL directly in a browser.

Once we see real debug output, we'll know for certain whether this is Coinbase rate-limiting, a timing gap, or something else, and can fix the actual cause instead of the third guess in a row.
