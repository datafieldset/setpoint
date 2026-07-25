# Setpoint v4.6

## Watchlist now saves to your account

Adding or removing a coin used to only ever live in browser memory, nothing saved it anywhere, so the moment the page refreshed or you came back later, it reset straight back to the hardcoded BTC/SOL/XLM default. Everything looked like it worked because the UI updated instantly, it just had nowhere to persist to.

Fixed properly, tied to your account rather than just the browser: a new `watchlist` column on the existing `users` table (same safe pattern already used for is_admin, added automatically, no migration needed), and a new /api/my-watchlist endpoint that saves on every add/remove and loads on sign-in.

This means your watchlist now follows you across devices and browsers, same as your plan already does, instead of resetting on every fresh page load.
