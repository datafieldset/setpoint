# Setpoint v5.2

## One-line diagnostic: proves definitively whether this is caching or something deeper

Everything else has checked out today: the database itself is clean (24 real open positions, zero duplicates, confirmed via direct SQL), the deployed commit matches the latest push, and the actual file content on GitHub is byte-for-byte correct. The one thing never actually confirmed is whether the live response is a fresh read each time or a frozen, cached copy.

This adds two fields to the /api/open-positions response: `generatedAt` (the exact moment the server built this response) and `dbRowCount` (literally rows.length, straight from the query result, before any transformation).

**The test:** visit /api/open-positions?key=honolulu26 twice, a few seconds apart.

- If `generatedAt` is identical both times: proven caching, somewhere between the server and the browser, not a database or code issue at all.
- If `generatedAt` changes each time but `dbRowCount` still says 84 with the same duplicates: proven the code is genuinely re-running, but reading from something other than the real, clean database we already confirmed has 24 rows, pointing to a connection or environment mismatch we haven't found yet.
- If `dbRowCount` says 24, matching the real database: everything's actually fine, and whatever was seen before was a caching artifact that's now cleared, no code issue at all.
