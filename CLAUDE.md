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

## Standing rule: prove your work before replying

Direct request from Na (Oct 11). Check and fix everything BEFORE sending it back, so he is not going back and forth after each reply. Follow `memory/review/README.md` and `memory/review/checklist.md`: run `node scripts/review.mjs` before replying, run `node scripts/verify-live.mjs` after every push, recompute every number given to him in the same turn, and say plainly what could not be checked. Use a separate agent to re-check high-stakes work (ratings, verification, alerts, anything customers see).

## Standing rule: focus mode (Oct 12)

Na asked to hide every original signal and focus on one new signal at a time. `VISIBLE_SIGNALS` in `lib/signals.js` decides which original signals anyone can see (currently none). Bringing one back means adding its label there plus a dated reason in `memory/signal-roster.md`, in the same commit. Hidden signals still detect and log. Trend Rider (`lib/trend.js`, `lib/trendRunner.js`) is the one signal shown, public since v19.22, on six timeframes with a live scoreboard each (v19.23). It runs outside `computeSignals`. Admin push alerts only for 4h and 1h. Test changes with `scripts/trend-study/` before shipping.

## Standing rule: new signals plug into the existing dashboard layout (Oct 13)

Direct instruction from Na after v19.23 broke it. The coins tab has ONE layout and every signal uses it: timeframe buttons in the top bar (`tf-toggle`, owned by `app/page.jsx`), an "Open Alerts" section that shows a card only for a signal that has fired and is still active on the chosen timeframe, the signal's name only on its card ("Buy Trend Rider"), a "Watching <tf>" empty state when nothing has fired, and the plain-English description of what a signal does only in the Guide. Do not add a standalone panel, big headline, tile row or explainer text for a signal on the dashboard. Extra material (scoreboard, recent results, "what it's watching" checklist) goes in sections below the cards, in the same card and row styles (`sig-card`, `recently-resolved`, `rr-row`, `empty`, `cards-grid`). If a signal needs something the layout can't do, propose the change and wait for a yes before building. Trend Rider follows this since v19.24 (`app/TrendRider.jsx` takes `tfKey` from the page).
