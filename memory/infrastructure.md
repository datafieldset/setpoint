# Infrastructure

## Database — Neon Postgres
Key tables: `users`, `signal_track` (core table — every fired signal, `coin, tf, label, dir, fired_at, resolved_at, entry, stop, target, outcome, regime`; `regime` column added later, populated at fire time from `marketRegime()`), `macro_cache`, `whale_track`, `backtest_results` (`run_at, bucket, fired, wins, losses, win_rate` — one row per bucket per run of `/api/backtest`, including condition-split buckets like `"Label · tf · dir · Bias:against"`), `push_subscriptions`.
Unique index: `signal_track_open_unique` on `(coin, tf, label, dir) WHERE outcome = 'open'` — DB-level guarantee only one open position per combo at a time; this is what makes the cron and a live browser tab safe to both attempt logging the same real fire without racing.

## Auth & payments
Auth.js, email/password. Admin: nokanetmail@gmail.com. Stripe live (NOKANET account). Pricing single source of truth: `lib/pricing.js` — Starter $19.99 (1 coin), Trader $49.99 (3 coins), Pro $99.99 (10 coins). Admin accounts exempt from coin limits.

## Push notifications
Web push, VAPID keys in Vercel env. Gated separately from logging (see architecture.md) — a signal always logs when it fires, but only pushes if genuinely, currently verified (checked fresh, right before sending) or an admin viewing a TESTING_SIGNALS combo.

## Cron jobs (GitHub Actions, `.github/workflows/`)
One combined workflow, `signals-cron.yml`, checking both real endpoints
back-to-back on the same internal loop. Same real, proven pattern as
before: GitHub's scheduler is honestly unreliable at high frequency
(real gaps of 1.5-3+ hours were directly confirmed from run history
when triggered every 5 minutes) — the unreliable part is specifically
the scheduler starting a *new* run, not how long an already-started
run can keep going (up to ~6h on a public repo). Fix: trigger a new
run only every 5 hours (`0 */5 * * *`), each run internally loops for
~330 real minutes, hitting both live endpoints every 5 real minutes —
new starts every 5h while each run lasts 5.5h means a small, real,
honest overlap for safety, not nearly triple redundancy.
- Calls `/api/cron/check-signals` (detection, logging, push) then
  `/api/close-alert` (resolves open positions against real price)
  each real, 5-minute cycle.
- Was two separate workflows (`check-signals-cron.yml`,
  `close-alert-cron.yml`), each independently triggered every 2
  hours — see "Neon compute-hour incident" below for why this
  changed.

## Neon compute-hour incident (Sep 28) — ongoing area, revisit if usage climbs again
The database hit Neon's free-tier compute-hour quota and went down
hard — every DB-backed route started returning real 402s
("account or project has exceeded the quota"), confirmed directly:
`liveGate`/`regimeGate` silently fell back to `{}`, `signalBias` to
`null`, `/api/public-stats` returned the raw 402 in its own error
field. Not data loss, Neon never deletes anything on a quota hit, just
a full compute lockout until the monthly reset or an upgrade.

**Root cause, confirmed directly from Neon's own usage numbers, not
guessed:** 110 CU-hours used in under a month on the free tier (100
CU-hours/month), against genuinely tiny storage (0.04GB) and network
transfer (2.43GB) — this was never a "too much data" or "heavy query"
problem, purely a "database almost never got to sleep" problem. The
math: 110 CU-hours over ~27 days ≈ 4 CU-hours/day ≈ the smallest
compute size (0.25 CU) actively awake roughly 16 of every 24 hours.
Direct cause: two separate cron workflows, each independently
triggering every 2 hours with a ~5.5-hour internal run — since 5.5h
comfortably outlives a 2h trigger gap, up to 3 real, overlapping
copies of EACH workflow could be alive at once, meaning the database
was getting hit by both together roughly once a minute, continuously,
24/7. Neon's scale-to-zero only saves real compute-hours when the
database gets an actual, real idle window; this never gave it one.

**Real, contributing, second cause, found in the same investigation:**
the Sep 25 fix to re-check verification status fresh right before
every push decision (see lessons-learned.md, "verification is a live
status") originally bypassed `getLiveVerifiedGate`'s cache entirely
(`getLiveVerifiedGate(0)`), forcing a full, real database scan on
every single push, potentially many times within one long-running
cron invocation. Real trade-off worth remembering: that fix solved a
genuine problem (a push reflecting an already-stale regime status),
but the fully-uncached version of it directly, meaningfully added to
the compute cost. Changed to a short, real cache (90 seconds,
`PUSH_CHECK_CACHE_MS`) instead of full bypass — close enough to fresh
for the real problem it solves, without a full scan on every push.

**Fixes shipped (v19.9), all real, direct, none should cost detection
quality:**
1. Combined the two, separate cron workflows into one
   (`signals-cron.yml`) — halves the independent, overlapping
   processes hitting the database.
2. Stretched the trigger interval from every 2 hours to every 5,
   matching the real, ~5.5-hour run duration — cuts overlapping runs
   from up to ~3x down to ~1x.
3. Fixed the uncached push-decision re-check to use a short, real
   cache (90s) instead of a full bypass.

**Immediate options considered, for the record, if this happens
again before a permanent fix lands:** wait for the monthly reset
(free, but real downtime the whole time); upgrade to Neon's Launch
plan (genuinely usage-based, no monthly minimum, ~$0.106/CU-hour, so
realistically just a couple of real dollars to finish out a
billing period, not a real ongoing commitment); or migrate to a
brand-new, separate free Neon project, since compute quotas are
tracked per-project, not per-account (genuinely free, but real,
direct work — export/import the database, update Vercel's
`DATABASE_URL`, real downtime during the switch).

**Worth revisiting if usage climbs again:** whether 5-minute checking
is genuinely necessary on every timeframe (slower ones like 1h/4h
plausibly don't need it), and whether client-side dashboard polling
(currently 60s while any real user has the app open) is worth a
second look — lower priority than the cron fix above since it only
runs while someone's actually using the app, a natural, expected
source of load, unlike the crons running whether or not anyone is.

## Real, live external data
All real price/candle data from Coinbase Exchange's public API (`api.exchange.coinbase.com`), no key needed. Granularity is in seconds and Coinbase only supports specific values (60/300/900/3600, etc — NOT 14400 for "4h", that returns "Unsupported granularity"); timeframes not directly supported are built by aggregating a smaller, real granularity client/server-side (`aggregateCandles`, `aggFactor` in `lib/timeframes.js`). Paged historical fetch for deep backtesting: 300 real bars max per request, loop backward with `start`/`end`, ~150-250ms delay between requests to stay polite.

## News feed
Removed from the Market tab — Reddit and Bluesky both return 403 from Vercel's server IP range (confirmed directly), no fix found. Only RSS + Telegram (watcherguru) still work, and coverage is uneven (BTC decent, XLM/XRP thin).
