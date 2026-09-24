# Setpoint — Overview

Crypto signal dashboard. Next.js 14, deployed on Vercel. Domain: setpointalerts.com.
Live repo: github.com/datafieldset/setpoint (public).
Owner: Na, NOKANET LLC, Honolulu.

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
- `signal-roster.md` — current, live status of all 15 signals — READ THIS FIRST for any signal question, it's ground truth, more current than this file
- `infrastructure.md` — database, Stripe, auth, cron jobs, env
- `version-history.md` — condensed version log
- `lessons-learned.md` — the hard-won, recurring mistakes — read before making any change that smells familiar

## Working pattern every session
1. Bootstrap: re-clone the repo fresh into `/home/claude/gh-current/repo` (a prior sandbox clone rarely survives to a new session).
2. Read every file in `/memory/` before doing anything else.
3. For any signal-status question, verify directly against the live, deployed code/API rather than trusting memory of a past conversation — signal promotions and kills change often and memory files can lag.
4. Discuss and propose before building — Na's explicit, standing preference. Only proceed straight to building when he's given a clear, direct go-ahead (or the request itself is an explicit, detailed build spec).
5. Validate every change locally (`node --check`, JSX parse check) before pushing. Push directly to `main` (no PR flow in use). Bump the version string in commit messages (vX.Y). Wait ~90s after push, then curl the homepage to confirm 200 and no client-side exception before reporting back.
6. Update `/memory/` after any major decision — new promotion, new kill, new architectural pattern, new lesson learned.
