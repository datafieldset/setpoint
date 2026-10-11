# Checklist by kind of work

## Any code change
- [ ] `node scripts/review.mjs` passes
- [ ] The change was exercised, not just parsed (ran the function, hit the route, rendered the component data)
- [ ] Checked the edge cases: empty data, one row, huge values, missing fields
- [ ] Searched for every other copy of the rule being changed (grep), and made them share one helper
- [ ] memory/ updated in the same commit (version-history, plus signal-roster if ratings/kill lists changed)
- [ ] Guide page still describes reality (CLAUDE.md rule)

## Signals, ratings, verification
- [ ] Tested on BTC only (standing rule)
- [ ] Tested with the LIVE rules (thresholdsFor), never a copy of them
- [ ] Sample size stated; held-back half checked; thin samples called leads, not facts
- [ ] Reasoning written in signal-roster.md with a date

## Anything customers see (Watch Live, alerts, Guide, pushes)
- [ ] Read the actual wording out loud: is any number misleading on its own?
- [ ] Morning Brew voice, no em dashes
- [ ] Mobile layout considered
- [ ] Nothing exposes admin-only data

## After pushing
- [ ] `node scripts/verify-live.mjs` passes (waits for the deploy)
- [ ] Looked at a real response from the changed route, not just the status code

## Before replying to Na
- [ ] Every number in the reply was recomputed this turn
- [ ] Anything I could not check is named as unchecked
- [ ] Short, plain, Morning Brew voice; the decision he needs to make is stated clearly
