# Infrastructure

## Trend Rider storage (v19.31)
Trend Rider is a normal signal: its trades are rows in `signal_track` like every other signal, with a stop and a target (stop 2 ATR from entry, target 0.75R the other way). The old `trend_positions` table is abandoned. Only `trend_state` remains as its own table (one key, `last_run`, the scan watermark).
`lib/trendRunner.js` only DETECTS: it inserts a row when price touches a breakout level and pushes to admins. The shared resolver (`resolveOpenTrades` in lib/resolve.js, run by close-alert and at the start of every Trend Rider run) closes it at the stop (r = -1) or the target (r = +0.75). `meta.scanFrom` holds the start of the entry candle so the resolver checks the whole entry bar, and `meta` also keeps the market context at entry (200-day average, Fear and Greed, stretch).
`/api/track` rejects any label flagged `serverOnly` in ALL_SIGNALS, so a browser can never log one. `signal_track.target` was made nullable during the trailing-stop experiment (v19.23 to v19.30) and left that way; nothing writes a NULL target now.

## big_move_alerts table (v19.20)
Created lazily by lib/bigMove.js: id, dir ('up'/'down'), pct, alerted_at. One row per alert, used for the 12h cooldown per direction. The check runs inside every /api/cron/check-signals call and never blocks it.

## Database — Neon Postgres
Key tables: `users`, `signal_track` (core table — every fired signal, `coin, tf, label, dir, fired_at, resolved_at, entry, stop, target, outcome, regime, verified_at_fire, risk, exit_price, r, bar_time, meta`; defined once in `lib/schema.js` `ensureSignalTrack(sql)`, which every route and cron calls instead of carrying its own CREATE TABLE; `target` is nullable for trailing-stop signals), `macro_cache`, `whale_track`, `backtest_results` (`run_at, bucket, fired, wins, losses, win_rate` — one row per bucket per run of `/api/backtest`, including condition-split buckets like `"Label · tf · dir · Bias:against"`), `push_subscriptions`.
Unique indexes: `signal_track_one_per_bar` on `(coin, tf, label, dir, bar_time) WHERE bar_time IS NOT NULL` (one touch of a level is recorded once) and `signal_track_open_unique` on `(coin, tf, label, dir) WHERE outcome = 'open'` — DB-level guarantee only one open position per combo at a time; this is what makes the cron and a live browser tab safe to both attempt logging the same real fire without racing.

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

A second, separate workflow, `signals-promotion-cron.yml`, triggers
every 6 hours (`0 */6 * * *`), a single, direct call per trigger, no
internal loop — at this real, low frequency, GitHub's scheduler is
reliable on its own, and the whole point is avoiding adding to the
kind of database load that caused the Neon incident below. Calls
`/api/cron/check-promotions`.

## Caching audit (Oct 2) — the real, direct fix for "minimize database load without losing quality"
Real, direct, methodical audit of every route touching the database,
same discipline as the Neon incident itself: check the actual code,
don't guess. Most routes checked out genuinely fine already — the
crons (`getLiveVerifiedGate`, already cached), `open-positions` and
`close-alert` (small, bounded, genuinely need to be real-time, caching
them would mean showing stale "still open" state), `resolved-
positions` (confirmed never called from the client at all, purely a
manual lookup tool), `track-visit` (a single, cheap insert).

**The one, real, substantial finding: `getSignalBias()` inside
`app/api/market/route.js` ran a direct, completely uncached, 400-row
database query on every single call, and this is the single most
frequently-hit route in the entire app — polled every real 60 seconds
by every active user's dashboard, on top of the cron hitting it too.**
A 400-trade rolling read is inherently slow-moving, it can't shift
meaningfully in the few, real minutes between two consecutive checks,
so there was never a real reason for this. Fixed with the same,
proven, in-memory cache pattern already used for
`getLiveVerifiedGate` (10-minute TTL).

## Tiered confidence system (Oct 2) — the real fix for "only gets
## noticed when someone happens to look in chat"
Nearly every bug found this session traced back to the same root
cause: a real, genuine finding (Whale Flow's retirement, RSI
oversold's real, current edge, Reversal watch's real, current edge)
only ever got surfaced because a human happened to notice it in chat,
not because any real system caught it. Two real, direct pieces fix
this:

**`confidenceTier()`** (lib/signals.js) — a genuinely new function,
deliberately separate from `provenContext()`, which stays completely
untouched and still the one, real, strict gate for anything a real
customer or push notification ever sees. `confidenceTier` classifies
any real combo into one of four honest tiers: `established` (exactly
`provenContext`'s existing "proven" bar), `emerging` (a real, current
edge, 55%+ on at least 5 real trades, genuine but under the full bar),
`early` (any real data at all, even a single trade, always labeled as
thin), `none`. Powered by a new, separate, admin-only data function,
`getFullSignalGate()` — deliberately isolated from
`getLiveVerifiedGate()` (the one the crons actually depend on), with
its own, independent, 5-minute cache, since this is only ever called
when a human opens an admin view, never from a hot, automated loop —
the same class of query-frequency mistake that caused the Neon
incident below is exactly what this isolation is meant to prevent.

**`/api/cron/check-promotions`** — the real, automated half. Runs
every 6 hours (see cron section above), checks every real signal,
every timeframe, every direction, for anything genuinely qualifying
for established or emerging tier that doesn't have a static
`SIGNAL_RATES` entry yet, and sends a real, direct, admin-only push if
so. Deliberately never writes to `SIGNAL_RATES` itself — a promotion
still means a real, deliberate decision, this only ever surfaces the
real candidate, same discipline as every promotion this whole
project, just no longer gated behind someone happening to notice
first. Dedup tracked in a new `promotion_alerts` table (created
automatically on first run) — re-alerts only on a genuine tier change
or after a real 24 hours, so it doesn't nag on the same, already-seen
candidate every single run.

**The real, honest admin feed** (Guide page, admin-only, "See every
real signal, every timeframe, right now") shows the same tiered data
on demand — every real combo with any data at all, honestly labeled
by tier and real sample size, built via `/api/signal-catalog`.

**What this deliberately doesn't do yet, real, honest next steps:**
make any of this tiered data visible to a real, paying customer (today
it's 100% admin-only, by design — what a customer sees should stay
exactly as strict as `provenContext` already is), and the real
caching-layer overhaul discussed but not yet built (see Na's own
priority order: automated promotion checking first, caching second,
customer-facing tiers last, each deserving its own focused pass).

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

**Resolution (same day, Sep 28):** database recovered on its own,
confirmed directly across multiple live endpoints — Na confirmed he
hadn't upgraded, so this wasn't paid access kicking in. Real,
honest correction: the assumption that the monthly quota resets
Oct 1 (calendar month start) was never actually confirmed, just
inferred from the billing page showing "usage since Sep 1." The
real, more likely explanation is the billing cycle resets on
whatever day the Neon project was originally created, which would
put the real reset around Sep 28, not Oct 1 — worth confirming the
exact, real cycle dates directly in Neon's billing page next time
this comes up, rather than assume the calendar month.

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

## signal_track columns added after creation (Oct 9)
`regime` and `verified_at_fire` were added with real ALTERs, not CREATE TABLE IF NOT EXISTS, which never helps a live table. Both live in `lib/schema.js` (`ensureSignalTrackColumns`), memoized per server instance so it costs nothing per request. Any new column on signal_track goes there, and any route reading it must call that helper first or it will fail until something else has written a row. If the ALTER fails, the cron stops loudly (server_error) instead of letting every insert fail quietly.

## Neon compute, second round (Oct 16, v19.41): quiet runs make zero queries
Neon emailed at 80% of the 100 CU-hour month (80.4 used by Oct 16, about 6 a day). Cause: the 5-minute cron queried the database every run (open trades, coin list, last-finished times, run marker, close-alert) and Neon only sleeps after 5 idle minutes, so it never slept. Fix (lib/idleState.js, used by lib/trendRunner.js runTrend): the scan keeps what the database last said in instance memory and does a "dry pass" first, the same scan code with database calls answered from memory. No new fire and no trade touching stop or target means no queries at all. Otherwise the normal run happens, always at least hourly (HEARTBEAT_MS) and on a cold instance. Unknown queries or missing records send the run down the real path (the dry pass can only find more work than the real run, never less). Also in v19.41: FOCUS_MODE stops the originals being detected and logged by the cron (check-signals returns right after Trend Rider, Rebound Rider and the big-move check) and by /api/track (hidden label -> `{inserted:false, skipped:"hidden"}`); close-alert returns from memory if a scan looked within 4 minutes; the cron loop no longer calls close-alert (the scan already closes trades). Replay (scripts/trend-study/e2e.mjs, BTC+XLM): Oct 10 and Oct 8, trades and pushes identical with and without the shortcut (fingerprint match), about 80% of runs make no database call, estimated awake share 22 to 31% instead of 100%. Live traffic (4 coins, open dashboards polling open-positions, resolved-positions, public-stats and my-watchlist) will push that up; check Neon's CU-hours a few days after deploy. Further levers if still tight: slower cron (10 or 15 minutes), longer server cache on the dashboard endpoints, pausing the 1 minute charts.
Oct 16 follow-up (v19.41c): instance memory alone was not enough (Vercel handed 5-minute-apart calls to a fresh instance about half the time), so the cron loop in signals-cron.yml carries the scan's memory: response fields `idleState` (a JSON string) and `idleSig` (HMAC, secret = IDLE_STATE_SECRET or VAPID_PRIVATE_KEY or DATABASE_URL), sent back in the next POST. Forged or stale memory is rejected (lib/idleState.js importState). A direct GET (anyone testing by hand) still works and uses instance memory only.
