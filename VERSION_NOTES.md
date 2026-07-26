# Setpoint v5.3

## Found it: Next.js was caching the internal database call itself

The diagnostic in v5.2 proved it conclusively: `generatedAt` changed on every request (the code was genuinely re-running), but `dbRowCount` stayed frozen at 84, even though a direct SQL query confirmed the real, live database had 24 rows. Code running fresh, data frozen, that's a very specific signature.

Next.js caches `fetch()` calls made from server code by default, not just the response sent back to the browser, any internal network request the server code itself makes. The Neon database driver talks to Neon's servers over exactly this kind of internal fetch call, and since the query text never changes, it looked perfectly cacheable to Next.js. The `dynamic = "force-dynamic"` export only controls the outer route's own caching, it doesn't automatically reach into a third-party library's internal fetch calls.

Fixed by passing `{ fetchOptions: { cache: "no-store" } }` directly to every `neon()` call in the app, forcing that specific internal request to never cache, at the source, not just the outer response. Applied consistently across all 12 files that use this pattern, not just the one we were debugging, matching the same audit standard from earlier today.

This was likely quietly affecting other things too, not just open positions. Worth watching whether anything else that seemed inconsistent today starts behaving differently now.
