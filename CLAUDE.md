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
