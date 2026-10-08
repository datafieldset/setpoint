# Setpoint — Project Memory

All project memory is in the `/memory/` folder. Read all files there at the start of every session before doing anything.

Keep `/memory/` updated as the project evolves: read it before every push, update it after every major decision.

## Standing rule: memory and code change together, in the same commit

This isn't optional or a follow-up step. Any commit that touches
`SIGNAL_RATES`, `KILLED_COMBOS`, `ALL_SIGNALS`, or `TESTING_SIGNALS` in
`lib/signals.js` must update `memory/signal-roster.md` in that same
commit — not "after," not "when there's time." One atomic change,
code and its own memory together.

This rule exists because it was broken once, concretely: Whale Flow
was fully retired in v19.7, but the memory update never happened in
that commit or any commit after it. `signal-roster.md` sat wrong,
still claiming 14 signals with no mention of the removal, for two real
versions, until Na caught it directly, not a process check.

Before trusting any specific count, name, or "currently promoted"
claim in `signal-roster.md`, run `node memory/check-signal-state.mjs`
from the repo root — it pulls ground truth straight from the live
code. The roster file deliberately doesn't restate these as fact
anymore; it holds the real, dated reasoning and history instead, which
doesn't go stale the way a copied list does.

## Standing rule: update the real, customer-facing Guide page whenever something new ships

Direct instruction from Na (Oct 2). Whenever a real, shipped change
touches what Setpoint actually does, a new signal, a changed
promotion, a new feature, a retired combo, check whether `Guide`
(the in-app component, admin-only sections included) still describes
it accurately, and update it in the same push if not. The Guide page
is the one place meant to honestly explain the real, current product
to whoever's looking at it, admin or customer — it drifting out of
sync with reality is the same, real class of problem `signal-roster.md`
already learned this lesson from once.

## Standing rule: BTC is the test bed for building and testing signals

Direct decision from Na (Oct 8). Build, tune, backtest and test every signal on BTC. Do not use other coins as a cross-check or as extra evidence before promotion. Na has watched the market for 9 years and the alts have never moved without BTC, and the Oct 8 lead-lag study (memory/lessons-learned.md) confirmed it with data: the other coins move with BTC in the same bar, so they add little independent evidence. Other coins only matter when checking how a specific entry or stop level fits a coin a customer actually trades. Longer BTC history is the fix for thin samples, not borrowing from alts.
