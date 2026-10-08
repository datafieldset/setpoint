# Lessons learned — read before touching anything that smells familiar

## Small samples lie, but not always the same direction
A promising small sample can be a genuine fluke (Coil|30m|bull: 67% on 6 real BTC-only fires, directly deepened across all 4 coins → 42% combined, genuinely doesn't hold) or can hold up (Swing|15m|bear: 80% on 5 BTC-only fires, deepened across 4 coins → 82% combined on 17, genuinely real). The only way to know which is to actually deepen the sample (more history, more coins) before promoting — never promote on a single-coin, sub-10-fire result alone, and never assume a small sample is automatically wrong either. Also: firing a signal *earlier* (fewer confirming bars) does not automatically fix a weak signal — tested directly for Grind Up, made no real difference.

## "Two surfaces disagree about what verified means" is a recurring bug class, not a one-off
This exact bug has been found and fixed multiple times, in different places, across this project: the client-side "Opportunities" filter, `/api/open-positions`, `/api/public-stats` (twice — once for stale, all-time history dilution; once for entirely ignoring the regime-only path), and `signal-catalog` (same regime-blindness bug as public-stats, found the same day). The fix every time was the same: stop re-deriving "is this verified" locally, call the one, real, shared `provenContext` function directly. Any new surface that shows verification status must go through it — do not write a new, parallel check, even a seemingly-simple one.

## Logging and pushing must never share a fate
Early bug (client-side): the DB log call and the push-notification call were two independent, un-awaited fetches — if logging silently failed or lagged, the push still fired, with no real record behind it. Fixed by requiring a confirmed, successful insert before ever sending a push (this is now the pattern everywhere: cron and client both gate the push behind `inserted === true`). Related, more recent bug: even with that pattern, the push decision can use verification data (live/regime gate) that was fetched once at the top of a long-running check and is stale by the time a later signal in that same run gets processed — fixed by re-fetching fresh gate data right before the push decision specifically, not just once per run.

## Never silence a signal from collecting data, even if it'll never be shown
Momentum was never promoted and never added to TESTING_SIGNALS, so it never logged a single real trade — right up until it would have caught a real, fast, ~6-8% BTC move that Na directly asked about. The fix wasn't "log everything that's promoted" but "log everything, always, regardless of tier" (removed the early tier-check gate in the cron entirely) — visibility (dashboard display, push) stays exactly as gated as before; only the underlying, silent data collection changed. This is now a standing principle: a signal being unproven or even conclusively weak is a reason to hide it, never a reason to stop recording its real, ongoing performance — with one deliberate exception: `KILLED_COMBOS` entries, reserved for combos with a real, large, conclusive sample already in hand, where there's no realistic scenario left to learn from by continuing to watch.

## GitHub Actions' scheduler is unreliable at high frequency, but a running job isn't
Both cron jobs hit this independently before the fix was generalized: `*/5 * * * *` looked reliable on paper but real run history showed multi-hour gaps. The fix is never "run more often," it's "trigger less often, loop internally once started."

## Verification is a live status, never a permanent badge
Multiple times this session, a signal's real, live, rolling record has decayed below the bar within days or even hours of being promoted (Volume spike, Grind Down both dipped post-promotion; Grind Up's original promotion didn't survive a deeper, later audit at all). The live gate demoting a statically-promoted signal in real time is the system working correctly, not a bug — this needs to be Na's default mental model too, not just the code's.

## A live, browser-side JS bundle can run stale, pre-fix code after a deploy
If Na's dashboard tab has been open continuously since before a given deploy, his browser is still running the old, bundled client-side logic (e.g. an old `KILLED_COMBOS` list) until he does a real, full page refresh — a server-side fix alone won't retroactively change what an already-loaded tab is doing. When a "the fix didn't work" report doesn't match a direct, fresh check of the live, deployed code, ask whether the tab's been refreshed before assuming the server-side fix is actually broken.

## Raw stats are not an explanation — plain, direct sentences are
Recurring, repeated feedback from Na: condition breakdowns like `93% — 4h · bull · Bias:against (29W/2L)` are unreadable without already knowing the codebase. Every surface showing signal performance should translate this into a real, plain sentence a non-technical reader can act on ("93% right when the broader market is heading the other way"), not raw keys and abbreviations. This generalizes past signal stats — any dashboard panel that requires reading the source code to explain (see the Market Meter / signal-bias panel conversation) is a real design failure worth fixing, not a comprehension gap on Na's end.

## Timing/investigation discipline
When investigating a reported bug, verify directly against live, deployed data and code before proposing or building a fix — several "bugs" turned out to be honest, correct behavior once checked directly (e.g. a trade correctly excluded because it fired in a currently-weak regime, not a bug). When a real root cause can't be confidently pinned down (the ~40min push-notification timing gap), say so plainly rather than presenting a partial, plausible theory as solved.

## Memory itself can drift the exact same way code and copy do
Whale Flow was fully retired in v19.7 (both directions, real, deepened
evidence behind it), but the memory update never happened, in that
commit or any after it — `signal-roster.md` sat wrong, still claiming
14 signals with no mention of the removal, for two real versions,
until Na caught it directly. Same root cause as the logging/pushing
bug above: two things that should share a fate were allowed to happen
as separate, un-coupled steps, and the second one silently didn't.
The fix follows the same shape too: don't treat "update memory" as a
follow-up, make it part of the same, atomic commit as the change
itself (see CLAUDE.md's standing rule). Separately, stop hand-copying
facts into memory that are cheap to check directly and expensive to
keep in sync by hand — a specific count or name list is exactly the
kind of thing that goes stale fastest and matters least to get from
memory versus a 5-second script check (`memory/check-signal-state.mjs`).
What memory should hold is what a script can't tell you: the real,
dated reasoning behind a decision, which stays true forever once
written, unlike a current-state snapshot.

## A fix for one real problem can quietly create a different, real problem — check the actual numbers, don't guess from code alone
The overlapping-runs cron design (Sep 6) was a genuinely correct fix
for a real, confirmed problem: GitHub Actions' scheduler was
unreliable at high frequency. But that same design, hitting the
database every 5 minutes via multiple, redundant, overlapping runs,
directly, meaningfully contributed to Neon's free-tier compute-hour
quota getting exhausted a few weeks later (Sep 28, see
infrastructure.md's "Neon compute-hour incident" for the full,
real numbers). Two real, separate, correct decisions, made at
different times for different reasons, compounded into a real,
serious problem neither one alone would have caused.

The real, direct lesson: when investigating a resource or cost
problem, check the actual, real usage numbers from the source
(Neon's own billing page, in this case) before proposing a fix —
reasoning from the code alone gave a real, plausible, but unconfirmed
theory; the real numbers (110 CU-hours against genuinely tiny storage
and network transfer) directly confirmed which theory was actually
right and roughly by how much, rather than fixing based on a guess.
This generalizes past this one incident: a change that's honestly
correct for the problem it was built to solve can still be a real,
direct contributor to a different problem later — worth periodically
asking "what did this fix actually cost us elsewhere," not just
"did this fix work."

## A retired or killed signal's old, frozen history will keep looking active in any new query that doesn't explicitly check for it — confirmed hitting real, customer-facing numbers, not just internal tools
First public-stats (fixed for the ALL_SIGNALS gap specifically, a
retired signal name like Whale Flow or EMA cross counting), then the
backtest report's live scoreboard (same thing), then check-promotions
flagging a killed combo as a fresh finding within hours of shipping.
The predicted fourth instance landed Oct 4, found live by Na, not by
me: public-stats still had the OTHER gap, KILLED_COMBOS specifically
(a real signal name that's still active, Swing Early, but one
specific combo of it killed for being genuinely unprofitable).
"Swing Early short on 1m" was contributing 11 of 17 trades to the
real, customer-facing "verified win rate" on Watch Live, 82% and 17
trades, when the real, honest number, once that killed combo's old
history was excluded, was 67% on 6 trades. This wasn't a cosmetic
bug, it was the single headline trust number on the site built mostly
out of a signal that's been dead for weeks. Same audit then found the
identical, exact gap in signal-catalog (the admin feed) and
open-positions (individual trade-card labels) — every real caller of
provenContext or confidenceTier across the app got checked this time,
not just the one place the symptom showed up, and all four now filter
by both ALL_SIGNALS and KILLED_COMBOS.

The real, direct rule, now confirmed through a real, customer-facing
miss, not just a close call: any new code that queries signal_track
for "is this currently real, active, worth trusting" — not just
logging a fresh fire, but READING historical rows to answer a
current-state question — needs to check both ALL_SIGNALS (is the
label even still a real signal) and KILLED_COMBOS (is this specific
combo still allowed to count) before trusting what it finds, every
single time, with no exception for "it's just an internal tool" or
"it's just metadata on a card." The pattern doesn't stop just because
it's been fixed before, each new query is a fresh chance to reintroduce
it, which is exactly what happened here.

## BTC is the test bed, and there is no tradeable lag between BTC and the alts (Oct 8 study)
Na's call: always build and test signals on BTC, because the rest of the market follows it. Before locking that in we tested the one reason it might be wrong, a lag between BTC and the other coins that could itself be a signal (read-only study, nothing in the app changed).

What was measured: all 10 watchlist coins against BTC on 1m (14 days), 5m (121 days), 15m (181 days) and 1h (375 days). Trades used the app's own rule (stop 1.5 ATR, target 3 ATR, so breakeven is a 33% win rate), sorted by how strong the BTC move was (z-score of the bar return), with the last 30% of the data held back.

Findings:
- Same-bar correlation with BTC is high (ETH ~0.86, SOL ~0.8, XRP/DOGE/ADA/LINK/SUI ~0.65-0.77, XLM and AVAX the loosest at ~0.55-0.6). One bar later it is ~0 on 5m, 15m and 1h. On 1m it is ~0.03, and the alts lead BTC by about the same amount, so BTC is not the leader there either.
- Following BTC, fading BTC, entering one bar late, strong moves, weak moves: all land at 30-38% wins, the same as random entries (32-35%). The few spots that looked good did not hold on the held-back data (1m strong moves 34% then 15%; 1h huge moves 28% then 67% on 21 trades from a handful of events). Alts in one event are not independent trades, so effective samples are much smaller than the trade counts.
- Limit: Coinbase's finest data is 1 minute. Any lag under a minute is invisible here and could not be acted on from a phone alert anyway.

Takeaways: BTC-only testing is a fair proxy for the alts. Fix thin samples with more BTC history. A lead-lag signal is not worth building. An untested idea: using BTC's direction as a filter on existing signals.
