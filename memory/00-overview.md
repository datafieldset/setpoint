# Setpoint — Overview

Crypto signal dashboard. Next.js 14, deployed on Vercel. Domain: setpointalerts.com.
Live repo: github.com/datafieldset/setpoint (public).
Owner: Na, NOKANET LLC, Honolulu.

**Database status (Sep 28): the Neon database hit its free-tier
compute-hour quota, went fully down (real 402s on every DB-backed
route), then recovered the same day, confirmed directly across
multiple live endpoints. Na hadn't upgraded, so the real, likely
explanation is the monthly billing cycle resets on whatever day the
Neon project was originally created, not the 1st of the calendar
month — "usage since Sep 1" on the billing page was just the current
cycle's start as displayed, not proof the next reset falls on Oct 1.
Worth confirming the real, exact cycle dates directly in Neon's
billing page next time this comes up, rather than assume. See
infrastructure.md's "Neon compute-hour incident" for the full,
real root cause and fixes — re-check whether this has recurred, since
the fix (crons keeping the database almost never idle) hasn't been
observed through a full billing cycle yet.**

## What it does
Watches BTC/XLM/XRP/SOL (user-configurable watchlist) across six timeframes (1m, 5m, 15m, 30m, 1h, 4h) for ~15 distinct technical signal families. Each signal gets a real, honest win-rate track record before it's ever shown to a paying customer as "verified." The whole product's pitch is: no fake backtests, every trade locked in with real entry/stop/target, checkable against your own chart.

## Access
- Backtest password: `verified2026` (used as `?key=verified2026` on several read-only admin API routes)
- Admin account: nokanetmail@gmail.com
- GitHub token lives in the sandbox at `/home/claude/.creds/gh_token` — re-check it exists each session, recreate if missing (see architecture.md for the exact bootstrap commands used every session).

## Where things live (see other files for depth)
- `writing-style.md` — how to talk to Na and how the product itself talks to users
- `product-copy.md` — real, concrete copy examples and standing copy rules
- `design-system.md` — real, exact color tokens, typography, recurring UI patterns
- `architecture.md` — file structure, core patterns (computeSignals, provenContext, KILLED_COMBOS, regime verification)
- `signal-roster.md` — the real, dated reasoning behind every signal promotion, kill, and retirement. Doesn't assert a current count or list — run `node memory/check-signal-state.mjs` for that, straight from the live code.
- `infrastructure.md` — database, Stripe, auth, cron jobs, env
- `version-history.md` — condensed version log
- `lessons-learned.md` — the hard-won, recurring mistakes — read before making any change that smells familiar

## Working pattern every session
1. Bootstrap: re-clone the repo fresh into `/home/claude/gh-current/repo` (a prior sandbox clone rarely survives to a new session).
2. Read every file in `/memory/` before doing anything else.
3. For any signal-status question, run `node memory/check-signal-state.mjs` and/or check live against the deployed API rather than trusting memory of a past conversation — signal promotions and kills change often and memory files can lag (this happened once already — see CLAUDE.md's standing rule).
4. Discuss and propose before building — Na's explicit, standing preference. Only proceed straight to building when he's given a clear, direct go-ahead (or the request itself is an explicit, detailed build spec).
5. Validate every change locally (`node --check`, JSX parse check) before pushing. Push directly to `main` (no PR flow in use). Bump the version string in commit messages (vX.Y). Wait ~90s after push, then curl the homepage to confirm 200 and no client-side exception before reporting back.
6. Update `/memory/` after any major decision — new promotion, new kill, new architectural pattern, new lesson learned. Any commit touching `SIGNAL_RATES`/`KILLED_COMBOS`/`ALL_SIGNALS`/`TESTING_SIGNALS` updates `signal-roster.md` in that same commit, not a later one.
