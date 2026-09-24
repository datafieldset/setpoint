# Infrastructure

## Database — Neon Postgres
Key tables: `users`, `signal_track` (core table — every fired signal, `coin, tf, label, dir, fired_at, resolved_at, entry, stop, target, outcome, regime`; `regime` column added later, populated at fire time from `marketRegime()`), `macro_cache`, `whale_track`, `backtest_results` (`run_at, bucket, fired, wins, losses, win_rate` — one row per bucket per run of `/api/backtest`, including condition-split buckets like `"Label · tf · dir · Bias:against"`), `push_subscriptions`.
Unique index: `signal_track_open_unique` on `(coin, tf, label, dir) WHERE outcome = 'open'` — DB-level guarantee only one open position per combo at a time; this is what makes the cron and a live browser tab safe to both attempt logging the same real fire without racing.

## Auth & payments
Auth.js, email/password. Admin: nokanetmail@gmail.com. Stripe live (NOKANET account). Pricing single source of truth: `lib/pricing.js` — Starter $19.99 (1 coin), Trader $49.99 (3 coins), Pro $99.99 (10 coins). Admin accounts exempt from coin limits.

## Push notifications
Web push, VAPID keys in Vercel env. Gated separately from logging (see architecture.md) — a signal always logs when it fires, but only pushes if genuinely, currently verified (checked fresh, right before sending) or an admin viewing a TESTING_SIGNALS combo.

## Cron jobs (GitHub Actions, `.github/workflows/`)
Both crons use the same real, proven pattern: GitHub's scheduler is honestly unreliable at high frequency (real gaps of 1.5-3+ hours were directly confirmed from run history when both were still triggered every 5 minutes) — the unreliable part is specifically the scheduler starting a *new* run, not how long an already-started run can keep going (up to ~6h on a public repo). Fix: trigger a new run only every 2 hours (`0 */2 * * *`), each run internally loops for ~330 real minutes, hitting the live endpoint every 5 real minutes — new starts every 2h while each run lasts 5.5h means several real runs are alive at once, genuine redundancy.
- `check-signals-cron.yml` → `/api/cron/check-signals` — detection, logging, push.
- `close-alert-cron.yml` → `/api/close-alert` — resolves open positions (checks real price against stored stop/target).

## Real, live external data
All real price/candle data from Coinbase Exchange's public API (`api.exchange.coinbase.com`), no key needed. Granularity is in seconds and Coinbase only supports specific values (60/300/900/3600, etc — NOT 14400 for "4h", that returns "Unsupported granularity"); timeframes not directly supported are built by aggregating a smaller, real granularity client/server-side (`aggregateCandles`, `aggFactor` in `lib/timeframes.js`). Paged historical fetch for deep backtesting: 300 real bars max per request, loop backward with `start`/`end`, ~150-250ms delay between requests to stay polite.

## News feed
Removed from the Market tab — Reddit and Bluesky both return 403 from Vercel's server IP range (confirmed directly), no fix found. Only RSS + Telegram (watcherguru) still work, and coverage is uneven (BTC decent, XLM/XRP thin).
