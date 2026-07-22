# Setpoint v3.5

## Scoreboard merged into the research page, redesigned as a dashboard

The standalone /api/scoreboard page is retired. Everything it did (resolving open live signals against real price, reporting a rolling win rate) now lives inside /api/backtest, one page instead of two.

**What changed:**

- Visiting /api/backtest now does double duty: runs the historical replay like before, AND resolves any still-open live signals and reports their real win rate, same as the old scoreboard page used to.
- The .md download now carries both datasets in one file: the historical replay sections, then a Live scoreboard section, then the whale flow section. One file to paste in here instead of two.
- Full visual redesign: summary stat cards up top (signals replayed, live signals logged, still open, top live performer), then organized panels instead of one long page. Every panel is marked either **LIVE** (a pulsing dot, real trades) or **REPLAY** (simulated history), so the two can never get confused with each other.

**Also found, not fixed yet:** the whale_track table error from earlier isn't actually missing code, /api/whale-track/route.js already has the table-creation logic, it's just never been visited to run it. Visiting that URL once should fix the whale flow section on the next backtest download.

## Also in this release
- Live scoreboard data folded into SIGNAL_RATES (from v3.4): real trade win rates now shown alongside backtest numbers on dashboard cards
- Volume building early and Quiet accumulation wired into the tier system for the first time (were never checking the table at all before)

## Next up
Visit /api/whale-track once to get the whale flow section working again.

## v3.5.1 — Password Protection

/api/backtest and /api/backtest/download now require a password. Visiting either prompts the browser's native login popup: any username, password `honolulu26`. Both routes share the same realm, so authenticating once on the main page carries over to the download link automatically, no second prompt.

## v3.6 — Whale Flow Fixed, Reversal Watch Cleanup Instructions

**Whale flow:** the table and its logging/resolving logic only ran when someone visited /api/whale-track directly, which nobody had, so the table never got created and this section always failed. The download route now creates the table and runs logging/resolving itself, same as visiting that page would, so downloading alone is enough to get it started. Will show "no transfers logged yet" on the very next download after this deploys, then start filling in as more downloads happen over time.

**Reversal watch live data contamination:** signal_track has no code-version marker, only a fired timestamp, and there's no timestamp trustworthy enough to filter by after today's back-and-forth pushes/reverts. Real fix is a one-time manual cleanup, not code: run `DELETE FROM signal_track WHERE label = 'Reversal watch';` once in Neon's SQL Editor. Clears every pre-rebuild fire, only new confirmation-gated fires remain from that point on.
