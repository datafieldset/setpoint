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

## Backtest and live scanner drifted apart (Oct 11, v19.20)
- Backtest routes called computeSignals with plain DEFAULT_TH while live code added the per-timeframe pctMin. Momentum fired every bar in backtests (fake 93% rating) and Quiet accumulation never fired. Another case of two copies of one rule drifting.
- Fix: one helper, thresholdsFor(tfKey, base), used everywhere. Any new caller of computeSignals must use it.
- A rating is only as good as the backtest behind it. After any change to detector inputs, re-run the full-year BTC replay.

## Trend-following study and the 2025-26 regime shift (Oct 12, 2026)
- "Verified" has no predictive power. A year of BTC replay, applying the exact gate to every fire: next trade wins 33% when the setup is "verified" vs 33.5% when it is not. A rolling hot streak on signals with no edge is luck, so verification just labels luck. Real edge has to be found first, then gated.
- Breakout trend-following on BTC (buy a close above the 20-bar high, short below the low, trailing stop 2-4 ATR): daily longs +0.28R to +0.80R over 10 years in all 9 settings, positive in both halves; 4h longs +0.11R to +0.50R over 6 years. But entering on ANY bar with the same exit earns +0.31R daily and +0.15R on 4h, so most of it is the exit (cut losers, let winners run) in a market that drifted up. Breakout entry adds about +0.16R daily, +0.07R on 4h, not statistically firm. Shorts: about zero; below the 200-day average about +0.26R to +0.37R daily (18-28 trades), +0.15R on 4h.
- Regime shift: BTC's average daily range fell from 5-7% (2017-2021) to about 3.4% in 2025-26; days moving over 3% fell from 25-45% of days to 13-15%; buy and hold was flat (-6%, -6%). In the last 24 months the 4h trend signal averages +0.0R to +0.17R (4 ATR stops best), shorts negative. Mean-reversion fades (Bollinger and RSI extremes, 1h and 4h) also sit at about zero in the same window. Nothing simple has a measurable edge in the new regime yet.
- Fibonacci (three versions, incl. Na's 1m checklist document) and RSI/top-bottom reads: no edge on any timeframe; as a location filter on existing signals the lift was small, faded in the second half, and flipped sign between long and short.
- Decision (Na, Oct 12): build Trend Rider as an admin-only forward test; hide every other signal (focus mode) and bring them back one at a time.


## Oct 13: confirmations, market conditions and the fast timeframes (Trend Rider v19.23)
- Bounce entries (buy a new low that closes back up, tight trailing stop) have no edge on 5m, 15m, 30m or 1h: -0.03R vs +0.02R for entering on any candle. The breakout is the only entry that beat the any-candle baseline.
- Breakout-and-trail on short charts: 1h buys held up over 6 years (+0.13R, 5 of 6 years better than baseline). Touching the level (earlier) cost nothing vs waiting for the close. 15m and 30m flip sign between halves. Sells are about 0R everywhere except as a test.
- Confirmations that helped: RSI above 60 plus ADX above 20 (best pair in 3 of 4 tables, 4h buys 6 of 6 years), then the bigger chart agreeing (1h/4h trend) on the fast charts (+0.04 to +0.17R). MACD, EMA stack, VWAP, volume, volatility, Ethereum agreeing, time of day and weekends added about nothing. Market Meter direction is redundant with ADX.
- Market-condition add-ons that helped (6 years): do not buy when price is more than 20% above its 200-day average (4h buys 46% to 48% wins, +0.46R to +0.66R; 1h 37% to 41%, +0.20R to +0.37R); and crowd not greedy (Fear & Greed at or below 50: 4h +0.74R, 1h +0.52R but only 21% to 37% of trades kept). Stretch check is a hard rule for buys; Fear & Greed is only a tag with its own win rate on the panel.
- About 15 candidates per table were tried, so the top lift is partly luck. Expect smaller live numbers.
- 1m and 5m: tiny stops (about 0.12% and 0.26%), months of data in a rising market; edges of +0.2R to +0.3R are weak evidence. The cron runs about every 5 minutes, so the fast charts only work because each run scans the last 15 minutes of bars and checks stops on finer candles.
- Process lessons: an ETH download script re-ran the daily BTC fetch and overwrote BTC_1d.json with ETH prices (caught because shorts returned zero trades; those results were discarded). Never let a fetch script write a filename another asset uses. A backtest and the live runner can agree on every common trade yet differ on the sample if entry order differs, so compare trade lists, not only totals.

## Oct 13: audit of the original signals with the Trend Rider lessons
- Method: replayed every original signal on BTC (4h 6y, 1h 6y, 15m 1y) with live code, then re-exited with the Trend Rider trailing stop (4 ATR on 4h, 3 ATR elsewhere) and added 200-day side, not-stretched, bigger-chart agreement and RSI/ADX. Compared with an "any bar" baseline using the same exit and filters. Scripts: scripts/trend-study/walk3.mjs, analyze.mjs (need BTC candle files, see README).
- The trailing exit alone lifted every old signal's win rate about 6 to 10 points versus the fixed 2:1 target. Most still sit near the baseline (about 0R to +0.1R).
- Only real candidate: Volume spike buys on 4h with price above the 200-day average and not stretched: 52% wins, +0.48R, 54 trades, both halves of history agree (50% and 53%); baseline for the same filters is 38%, +0.14R. Quiet accumulation buys on 4h with the same filters: 53%, +0.31R, 32 trades. Momentum 4h buys look strong but only 10 trades.
- Nothing useful in sells, 1h, or 15m (all within noise of the baseline). Not yet checked: overlap with Trend Rider 4h buys.
- No signal changed or brought back. Awaiting Na's go.

## Oct 13: stop and target for Trend Rider (v19.31)
Na wanted Trend Rider to look like every other signal: Entry, Stop, Target. Side study on the same entries (BTC history, entries from the trailing replay): a fixed target cuts the trailing edge a lot. 4 hour buys: trailing +0.51R (44% wins), fixed 3R +0.46R, 2R +0.33R, 1R +0.12R. A closer target only raises the win rate (0.25R: about 80 to 87% wins, 0.5R: 63 to 72%, 0.75R: 56 to 63%, 1R: 49 to 56%) while the average result stays near zero, because the break-even win rate for a target of k R is 1 / (1 + k). Tighter stops: 1 ATR is noise (negative everywhere), 1.5 ATR about break-even, 2 ATR keeps a small edge. Picked: stop 2 ATR, target 0.75R. Honest note: R is now half the size, so the percentage gain per trade is about a fifth of the trailing version on 4 hour buys. Live-rule replay is smaller still because it re-enters right after each close (see version-history v19.31).

## Oct 13: rebound study (v19.36)
Tested ideas for catching a bounce on BTC and XLM (entry at next bar open, stop 2 ATR, target 0.75R, sells mirrored). Fading bands loses. Plain dip entries are a coin flip. Adding the 200-day side and the 1h-chart-agrees rule lifts it. Chosen: dip more than 2 ATR below the 20-bar average within 4 bars, then a green bar back above (average minus 1 ATR), 1h chart only. 1h was the only timeframe that held on both coins; 30m and faster showed nothing. About 116 BTC and 41 XLM trades historically, small and thin, picked from many tests, BTC's second half about flat. Treat live results as the real test.

## Oct 14: look at the real screen before replying
The Open Alerts ladder shipped looking smashed (labels stacked on each other) because a missing live price turned every position into NaN and tiny 1 minute XLM levels sat on top of each other. I had changed the 1 minute rules without ever looking at a real open-position card, and Na found it. Fix: v19.38c, plus a new checklist section in memory/review/checklist.md (log into the live site, inject test data if needed, try tiny and not-yet-loaded values, report what was and was not seen).

## Oct 15: the bounce hunt (no new signal)
Na asked what could have caught the Oct 15 BTC bounce ($79.7k to $82k, bottom ~3:55am HST). Tested on 6 months of BTC 5m (stop 2 ATR, target 0.75R, break-even 57%): long-tail candle 54%, sweep of a 4h low 53%, sweep of a round number 57% (0.00R), selling climax 53%, tail+sweep+volume 54%. Requiring a fast drop first (1%+ in 2h) lifted the long-tail candle to 73% on 73 BTC trades, winning every month, but on SOL the same rule was 59% (+0.03R), so it was a BTC-only find after ~35 variations. Not built. Taker flow (OKX) showed buyers took over at 4:00am but a similar buyer stretch at 3:05am failed, so nothing predictive. Rebound Rider without its 1h check: 58%, +0.01R on 1h (1,078 trades), flat on 5m, so the 1h check is what gives it an edge. Lesson: a rule that fires at the exact bottom is hindsight until it holds on other coins and unseen months.

## Oct 22: flips and stop size
Mirror (opposite) trades of the old hidden signals on 6 years of BTC (2:1 setup, luck line 33%): original and mirror both sit 31-36%, no clear flip edge. Mirror of buys is faintly above luck (35-37% in several slices, steady in both halves, ~+0.05 to +0.1R); original sells 35.7% (~+0.07R). Parked, not built (Na: forget it for now, no new signals). Trend Rider stop size: wider-stop quartile wins more on 5m/15m (not 1m, not Rebound); wider stop plus bigger target showed nothing. Led to v19.42. Note: Trend Rider does short (about 2,500 sell pushes in a 6-month replay); the Oct 20-22 window just had only buys.

## Oct 22: time-of-day / weekday checks on Trend Rider (nothing changed in the app)
Na asked for time-of-day cuts. BTC replay of the live rules (win/avgR, break-even 57%): 1h 6 years (866 trades), 30m and 15m 1 year, 5m 6 months, 1m 2.5 months. Windows are Hawaii time.
- 4 six-hour blocks: 1h is flat (60/60/59/58%). 30m/15m show 6am-noon weak and evening strong, but the halves flip (6-12 was 59% older half, 54% newer; evening 56% older, 72% newer). Noise.
- Weekdays 61% vs weekends 59% (1,266 vs 409 trades): inside the margin of error; 1h alone 60% vs 60%. Weekends still make +0.03R. Not acted on.
- 5am-10am weekdays: only 1m looks bad (49%, -0.14R on 79 trades vs 63% elsewhere, 2.5 months of data); 5m/15m/30m slightly lower, 1h better. The window was picked after seeing earlier results.
- 3am-8am weekdays: ~average (62% vs 60%), 1m halves 71% then 49%. Not actionable.
- Lesson: five different clock cuts gave five different answers; the more windows tried, the more likely luck looks like a pattern. Candidate to re-check in about a month: pause 1m Trend Rider 5am-10am weekdays. Re-test when each chart has a few hundred more live trades. Nothing was built.

## Oct 27: EXA and 7-day average studies (tests only, nothing built)
- EXA (EMA Exhaustion, a TradingView indicator: distance from the 50 EMA scored against the last 9 candles). Scored every BTC replay trade (about 2,900). Trend Rider: no steady pattern at 1m/5m/15m/1h, halves disagree. Rebound Rider 5m: skipping trades where price hasn't stretched against the trade side gave 59% / +0.03R kept vs 55% / -0.03R skipped, in 2 of 3 time chunks, sells only, gone in the newest third. Too thin to act on. Parked; rerun on live Rebound results once there are a few hundred more.
- 7-day average of daily closes (Na asked because BTC closed below it). As a "more downside" signal it does nothing: next 3 days up 55% on any day, 55% after a close below, 54% after the first cross below (3,600 days since 2016, flips by year). As a Trend Rider filter, sells while price is still ABOVE the 7-day average did worse in replay: 47% win, -0.18R (190 trades, but only 26 distinct days, overlapping timeframes) vs 62%, +0.09R below it; same direction on 5m/15m/30m/1h and in all three time thirds, weaker in the newest third. Buys: no difference.
- Live check Oct 27 could not test it: all four coins closed below their 7-day average every day since Oct 22, so zero live sells above it. Live Trend Rider sells below it: 48 trades, 67%, +0.17R (all XLM).
- Na said yes to adding it to the Nov 22 re-check (scheduled task now covers the market-open window and the 7-day average sells). Proposed rule if it holds: skip Trend Rider sells while price is above its 7-day average. Do not build without his yes.

## AI/ML trade filter study (Oct 29)
Walk-forward test on 2,943 BTC replay trades (logistic regression + small boosted trees, 14 features, trained on earlier trades, scored on later ones). Out-of-sample AUC 0.40 to 0.61, mostly near 0.50 (coin flip). Keeping the "best" 60% of Trend Rider trades: 61.0% vs 60.5% (logistic), 60.0% (trees). Rebound 5m: worse than keeping all. A random 60% matched or beat the model 35% to 75% of the time. Decision: no AI filter. Do not claim AI in landing copy or meta description.

## Neon quota, round two (Oct 29)
The 5-minute cron was already idle-safe (v19.41). The remaining drain was the dashboard: any visible signed-in tab asked the database every 30 to 60 seconds, and two routes ran uncached CREATE TABLE plus SELECT on every call. Neon only sleeps after 5 quiet minutes, so a gap of 6 minutes saves almost nothing; quiet-tab refresh gap is 20 minutes on purpose. I first proposed a key-value store for this, but the idle design already existed: read memory/infrastructure.md and version-history.md before proposing infra.

## Parked: faster 1-minute checks for Trend Rider 1m (Na, Oct 29, after the Neon quota resets)
Our real entry lag is our own scan: the cron runs every 5 minutes and an open tab checks every minute, so a 1m breakout can be noticed minutes late. Checking every minute for Trend Rider 1m only would bring entries sooner, but costs about 5x the database time. Revisit once the v19.57 database savings are proven on Na's Neon graph.

## Other exchange data, what is reachable (Oct 29)
From a US cloud server: binance.com and fapi.binance.com return 451 (blocked). data-api.binance.vision (Binance's market-data-only mirror, same BTCUSDT prices) works, so does data.binance.vision (history files). OKX, Kraken, Bitfinex, Bitstamp, Gemini, Deribit, KuCoin, Gate and MEXC all answered. Bybit 403. CoinGecko free tier rate-limited (429).
Quick test, 3,000 one-minute BTC candles: Binance and Coinbase move together (same-minute correlation 0.989). Neither leads the other at 1-minute resolution (lag correlations all under 0.05). Binance trades about 2.3x Coinbase's BTC volume. Takeaway: the speed gap is sub-second, invisible to our 1m+ candles. Possible uses, both untested: Binance volume as a breakout filter for Trend Rider, and Coinbase-vs-Binance gap as Market tab context.

## Binance as a filter, replay test (Oct 29, 2,943 BTC trades, Apr 20 to Oct 23)
Matched every replay trade to the same-bar Binance candle (data-api.binance.vision). Tried three reads per group: Binance volume ratio, Coinbase volume ratio, and the Coinbase-vs-Binance price gap in the trade's direction. 15 splits in all, so a few will look good by luck.
Trend Rider: nothing holds. Binance volume on 15m showed +11 points high vs low (220 trades, 15% luck chance), too thin; 1m and 5m disagree with each other.
Rebound Rider 5m: the gap is the one that held. High-gap third 52.6% / -0.08R vs low-gap third 63.4% / +0.11R, luck chance under 1%, same direction in both halves and all three time thirds. Walk-forward (threshold from the first half, applied to the unseen second half): skipping the top third of gap kept 58.1% / +0.02R vs 56.1% / -0.02R for all; skipping the top half kept 61.2% / +0.07R vs 56.1% / -0.02R. Skipped trades ran 50% / -0.12R. Barely correlated with the Coinbase volume read (-0.06).
Caveats: Rebound 5m is the weakest signal (+0.005R overall), replay vs live usually a few points worse, one regime, and the live scan would need a Binance mirror call from Vercel (reachability from Vercel not yet confirmed). Not built. Candidate for the Nov 22 re-check.
Built as v20.1 (Na: "why wait?"). Real-engine replay, Jul 1 to Oct 12, BTC, same scan code as the cron: Rebound 5m with the gap rule OFF 133 trades 57.9% / +0.013R; ON 94 trades 60.6% / +0.061R. No errors. Trend Rider trades untouched. The JS gap number matches the study's Python number on 1,151 trades (largest difference 3e-15). Fails open when Binance prices are missing; the scan result shows `gapFilter: "on"` or `"unavailable"` for BTC 5m. First thing to check live: that Vercel can reach data-api.binance.vision (gapFilter "on").

## Wallet study: can we find top traders by win rate? (Oct 29, read-only, Hyperliquid)
Hyperliquid publishes a leaderboard of 48,422 wallets and every wallet's fills (reachable from a US server). Took 700 random wallets with account above $10k and over $1M volume last month; 346 had 100+ closing orders in the last 120 days. A "trade" here is one closing order (fills grouped by order id, net of the fill's own cost). Scratch data and scripts stayed in the session scratchpad, no wallet data in the repo.
Findings: median win rate 56%; 27% of wallets (92) sit at 70%+, 14% at 80%+. Those 70%+ wallets have a payoff of only 0.47 (average win is under half the average loss), yet 77% of them are profitable overall, versus 57% of all wallets. Persistence, first 60% of each wallet's trades vs last 40%: win rate correlates 0.60 (high win rate is a stable style), profit per dollar traded only 0.18 (weak). Picked on 70%+ wins in the past: later win rate 75%, 67% of wallets profitable, median profit +0.26% of dollars traded; everyone else 50%, 52%, +0.03%. Top 10% by past profit per dollar traded: 74% profitable later, median +2.2%.
Caveats: only the survivors with money in the account today (wallets that blew up are missing, so profit shares look better than reality); one 4-month regime; all coins, not BTC; wins counted per closing order so scaling out in small pieces inflates win rate; many high win rate wallets are bots, market makers or hedged on another venue; copying lag. Not built. Possible next step: does what the best wallets hold on BTC predict BTC moves? Context for the Market tab at most, not a signal.

## Wallet study part 2: do the best wallets' BTC trades predict BTC? (Oct 29, read-only, Hyperliquid)
Pulled 2,400 random active wallets (account over $10k, over $1M volume last month). Picked, using only data before Sep 5 (55 days ago): 100+ style BTC traders, 50+ closing orders, win rate 70%+, 15+ closing orders in the 30 days before, 30+ BTC fills = 79 wallets ("high win rate, actually trading"). Comparison: 204 BTC traders under 55% win rate. Measured the group's rolling 24h net BTC buying (from fills) against BTC's next 4h and 24h move, Sep 5 to Oct 29.
Result: after heavy group selling BTC averaged -0.99% over the next 24h, after heavy buying +0.20%, quiet hours +0.04%; gap +1.19 points, luck chance 18% (sliding the signal in time). Same direction in both halves. The comparison group showed nothing (gap -0.31, luck chance 80%). But hours overlap heavily: collapsed to separate episodes there were only 6 heavy-selling episodes (BTC down in 4 of 6, avg -1.25%) and 7 heavy-buying (down in 3 of 7). The group also trades against the move (correlation with the prior 24h move -0.44). Verdict: a hint that the best wallets' selling is worth noticing, not proof. Too few episodes, one falling market. Not built. If revisited: needs a longer history than Hyperliquid's fills allow (about 4 months), or a rerun in a rising market. Candidate for a Nov 22 re-check using fresh data.

## Nov 7: research round (2 years of Binance BTC, plus all 267 live BTC trades) — nothing built from these yet
- **Trend Rider sells (price under its 200-day average):** BTC was under the 200-day on 328 of 730 days, so buys were silent 45% of the time. Replay of the sell side: 1,682 trades, 57% wins, +0.005R (break-even is 57.1%), halves +0.001R / +0.009R. By timeframe: 5m -0.031R, 15m +0.041R (both halves), 30m +0.024R, 1h +0.022R, 4h none. Bad months and good months alternate (2026-06 +0.211R, 2026-04 -0.190R). Meaning: if BTC breaks its 200-day ($73,186 on Nov 7) both signals start selling with no proven edge. The edge so far is a bull market edge.
- **Volume filter for Trend Rider buys (strongest lead):** last-hour volume vs the 24h average at entry. History (969 buys, 5m to 1h): below 1.0x = 282 trades, 55% wins, -0.038R; at or above 1.0x = 687 trades, 64%, +0.128R. At 1.1x: skipped -0.013R, kept +0.126R. The skipped group was negative in 3 of 4 time slices (-0.136, -0.072, -0.007, +0.077), improving over time, so the effect may be fading. Live out of sample (never used to pick the idea): 5m to 1h buys with volume under 1.1x = 31 trades, 52%, -0.097R vs 46 trades at 72%, +0.255R; 1m buys under 1.1x = 66 trades, 56%, -0.019R vs 33 trades, 64%, +0.114R. Candidate rule: skip when the last hour's volume is below its 24 hour normal. Needs Na's yes to build.
- **Volatility (24h range) filters:** no consistent effect on Trend Rider or Rebound Rider buys. **Volume on Rebound Rider buys:** busy dips did slightly worse (-0.052R at high volume vs +0.014R at low), flips between halves, ignored.
- **Same-weeks live vs replay:** Trend Rider 5m to 1h live 64% +0.114R vs replay 67% +0.167R (Oct 13 to Nov 6). The earlier gap to the all-time live number came from old tiny-stop rules (1m stops averaged 0.09% before v19.48) and the 1m, not from execution.
- **Rebound Rider since the Oct 27 rule changes:** 2 wins in 11 (-7.5R), every buy lower than the last. Led to the v22.1 falling-knife guard (the 5 live buys it skips all lost).
- **Background signals (all originals) on 2 years of BTC:** pooled 33% wins and -0.008R at 2R targets, no edge as a group; four positive in both halves are logged quietly since v22.2.

Nov 7 (Na: "How difficult would it be to create a trading bot", exchange fee test). Question: would auto-trading Setpoint's BTC buys survive exchange fees? Used Crypto.com's advertised spot fees (from 0.075%, 0% maker; undated page, unclear for US accounts) as the best case. Result, average R per trade after fees: Trend Rider 5m+15m+30m replay (819 trades, stops about 0.62% of price) +0.079R before fees, -0.115R in the best case (0.075% in, free limit exit on wins, 0.075% on stops), -0.202R at 0.075% each way, -0.296R at 0.1% each way. Live BTC Trend Rider 5m+15m+30m (68 trades) +0.132R -> -0.145R best case. Live Rebound Rider 5m (90 trades, stops 0.33%) +0.011R -> -0.412R. 1h Trend Rider (stops 1.09%) closest: +0.085R -> -0.027R best case. Break-even needs stops around 2% of price or wider. Not modeled: slippage. Conclusion: do not build an auto-trading bot on these signals; they stay an alert service. KuCoin is not an option (does not serve US persons; Na is in Honolulu; do not help route around that). A bot would need a wider-stop signal proven on BTC first. Script: scratchpad fees.mjs (replay from rb2/tr_trades.json, live from trades-live.json).

Nov 7 (Na: "Run it", pullback entries). Idea: instead of buying the moment price touches the breakout, rest a limit order X ATR below it and wait M bars (cancel if the original stop or target trades first). Two years of BTC, buys only, one trade at a time, entry bar counted, stop checked first. Script: scripts/replay-pullback.mjs. "Keep levels" = same stop and target prices as the breakout trade (closer stop, bigger R on wins). "Shift" = same 2 ATR stop and 0.75R target moved down to the pullback price. Fees: taker both ways 0.15% round trip, or maker entry and target with a 0.075% taker stop.
Baseline breakouts after fees: 5m 180 trades -0.239R, 15m 260 -0.208R, 30m 224 -0.184R, 1h 127 -0.100R. Key find: breakouts that pull back 1 ATR within 4 to 8 bars lose in the baseline (-0.35 to -0.72R after fees); the ones that run away are about break-even. Pullback entries on the same events: "shift" variants do nothing (about +0.0 to +0.1R before fees). "Keep levels" lifts gross R in a smooth pattern with depth on 5m, 30m, 1h (30m: +0.19 at 0.75 ATR, +0.31 at 1.0, +0.36 at 1.25, +0.75 at 1.5, but win rate falls to 25-43%). After taker fees only 1h stays positive: 0.75 ATR 67 trades +0.080R, 1.0 ATR 43 trades +0.296R (halves +0.425/+0.160), 1.25 ATR 42 trades +0.326R (halves +0.324/+0.329); 1.5 ATR 26 trades -0.334R. With maker entry and target: 30m +0.09 to +0.41R, 1h +0.07 to +0.64R. 15m does not show it (taker -0.40 to -0.48R). Not confirmed: samples are 26 to 99 trades, about 44 settings tried across four charts, 15m disagrees, and the maker case assumes 0% maker fees and that every resting order fills when price trades through it. At those depths 1h fires about 2 times a month and 30m about 4. Next step proposed: fetch 6+ years of BTC 1h/30m and test ONE fixed setting (1.0 ATR, wait 8 bars, keep levels) out of sample before any live change. Nothing was changed in the app.

Nov 7 (Na: "Run it"), out-of-sample check of the pullback entry. Fetched BTC 5m from Jan 2020 to Nov 6 2024 (509,832 bars, scripts/fetch-btc-history-old.mjs) and ran ONE setting fixed in advance (1 ATR below the breakout, wait 8 bars, keep stop+target levels), no tuning. Result, buys only, fees 0.15% round trip taker: 5m 244 fills of 548, gross +0.363R, net -0.212R; 15m 206 of 427, +0.240 gross, -0.192 net; 30m 163 of 336, +0.138 gross, -0.214 net; 1h 77 of 214, -0.000 gross, -0.236 net. The 1h "+0.30R" from the 2 recent years was luck (best of ~44 settings). With maker entry and target (0% maker, 0.075% taker stop, every touch fills): 5m +0.183R, 15m +0.100, 30m +0.018, 1h -0.084. What held up: pullback entries raise gross R on 5m/15m/30m in both periods; buying the breakout and then getting a 1 ATR pullback loses -0.35 to -0.72R after fees in both periods; breakouts that never pull back are +0.07 to +0.24R after fees in both periods, but you only know that afterwards, so it is not a filter. Conclusion: no price-entry tweak on BTC 5m to 1h clears realistic taker fees. Only the maker case on 5m/15m is positive, and it rests on 0% maker fees (not confirmed for US accounts) and perfect fills. Auto-trading stays off the table; Setpoint stays an alert and explanation product unless a wider-stop idea (4h/daily) proves out on BTC. Nothing changed in the app.

Nov 7 (Na: "find a solution with what we have and what history can tell us"), exit study. Script: scripts/replay-exits.mjs. 6.9 years of BTC (Jan 2020 to Nov 2026, merged 5m file), Trend Rider buys, 2 ATR stop, fee 0.15% round trip (taker both ways), each exit with its own one-trade-at-a-time gating. 2022 has no buys (trend filter), so a bear market is untested. Net R per trade after fees:
1h: today's 0.75R target 342 trades -0.087R; fixed 2R +0.039; fixed 3R 199 trades (29/yr, win 33%) +0.190R (eras +0.138/+0.425/+0.049); trailing stop 3 ATR 211 trades +0.271R; trailing 4 ATR 187 trades (28/yr, win 34%) +0.353R (eras 2020-21 +0.143, 2023-24 +0.841, 2025-26 +0.146); avg hold 19 to 28h, worst losing streak 9, worst drawdown about 12R, avg stop 1.3%.
4h: today's 0.75R 106 trades +0.141R; fixed 2R 71 trades +0.331; fixed 3R 60 trades (9/yr, win 40%) +0.537R (eras +0.500/+0.502/+0.615); trailing 3 ATR 62 trades +0.734R; trailing 4 ATR 54 trades (8/yr, win 46%) +0.859R (eras +0.835/+0.916/+0.816); avg hold 3.5 to 5 days, avg stop 2.6%, worst drawdown 4 to 7R.
15m and 30m: no exit fixes it; best is trailing 4 ATR: 15m -0.003R, 30m +0.033R (eras -0.165/+0.371/-0.055). Bigger targets or trails help on every chart (smooth), but only 1h and 4h end clearly positive after fees in every era. Why: the fee is a fixed cost, so wide stops (1.3% and 2.6%) cut the fee drag and letting winners run lifts the average win. Not day trading: holds are 1 to 5 days, about 3 trades a month combined on 1h and 4h with fixed 3R. Caveats: fills at exact stop/target levels (no slippage), 2022 bear untested, about 10 exit settings tried, Binance data. Nothing changed in the app yet; proposal pending Na's yes: per-timeframe target multiple (3R on 1h and 4h) so the card keeps Entry/Stop/Target; a trailing stop would add +0.15 to +0.3R more but needs "move your stop" alerts.

Nov 7 (Na: "between the 2 live signals and the dozen hidden ones... there has to be a way to improve them"; asked about 80% win rates). The 80%+ rates in SIGNAL_RATES are tiny early samples: Swing 15m bear 82% was 14W/3L on 17 fires (Sep 21); a 2 year BTC replay found 29 fires, 10 wins (34%). Reversal watch 1h bull 100% was 3W/0L on 5 fires; replay 15 fires, 6 wins (40%). Same regression seen in the roster for Volume spike 5m (90% on 10 -> 35% on 57), RSI oversold 5m (75% on 8 -> 19% on 63), Quiet accumulation (75% -> 43% on 207).
Full hidden-signal replay on 6.9 years of BTC (scripts/replay-hidden.mjs; 45,285 trades, 24 combos with 100+ trades, built stop and 2R target, fee 0.15% round trip). Positive after fees: only Momentum 1h bull (193 trades, 38% wins, +0.08R, eras +0.13/+0.10/-0.03/-0.05, fading) and Momentum 30m bull (454 trades, 39% wins, +0.06R, eras -0.04/+0.17/+0.16/+0.21). Note Momentum 30m bull looked like +0.22R on 58 trades over the last 2 years; the 6.9 year number is +0.06R. Everything else loses after fees (Grind Down 15m bear, Swing Early 15m bear, Momentum 5m: -0.2 to -0.4R). Other exits (3R, 4R, trailing 2x/3x of the signal's own risk) on 120 combo-exit pairs: only Momentum 1h bull with trailing 3x (+0.12R, 191 trades) and 4R (+0.08R) are positive in every era. Confluence (other hidden signals firing the same way within 2 bars): signals almost never agree above 5m (15m 154 trades, 30m 47, 1h 24); on 5m one extra signal lifts net from -0.63R to -0.30R, still negative. About 150 comparisons, so a couple of survivors are expected by luck. Conclusion: combining the hidden signals does not produce an edge after fees; the slow Trend Rider (1h and 4h with 3R or trailing exits) remains the only result that is positive after fees in every era with a sensible reason (fee is a smaller share of wide stops). No app change made.

Nov 7 (Na: traders who trade the 1h/4h bounce off a 7, 9 or 20 day moving average). Script: scripts/replay-ma.mjs. 6.9 years BTC, SMA of 7, 9, 20 days on 1h and 4h charts, buys and sells, two setups: bounce (6+ bars closed above a rising MA, then a candle dips to the MA and closes back above, mirrored for sells) and cross (close crosses the MA), stop = signal bar extreme -/+ 0.5 ATR, exits 2R, 3R, trail 3 ATR, fee 0.15%. 62 setups with 40+ trades; 20 positive after fees; NONE positive in every era. 7 day bounce buys: 4h 2R 87 trades 43% +0.18R (eras +0.58/-0.19/+0.02/-0.03), 1h 3R 84 trades 33% +0.18R (+0.49/-0.66/+0.02/+0.23); about 12 trades a year. Best overall 4h 20 day cross-up with trail 3 ATR: 203 trades +0.32R but 2023-24 +1.00 carries it and 2025-26 is -0.05. The slow Trend Rider (4h 3R +0.54R, all eras positive) beats every MA version. Caveat: human MA traders use discretion and context we can't replay.

Nov 7 (Na: "Ok go"), three tests on the slow Trend Rider (1h and 4h buys, 6.9 years BTC, fee 0.15%, script scripts/replay-swing.mjs, 2022 has no Trend Rider buys). Planned name for the slow signal: Swing Rider (new name, not a reused old signal, so it carries no old history); not built yet.
A. Scale-out. 4h: all-in 3R 60 trades +0.54R; all-in trail 4 ATR 54 trades +0.86R (46% profitable, worst streak 5, drawdown 5R); half off at 1R then trail 4 ATR 56 trades +0.56R, 64% of trades profitable, worst streak 3, worst drawdown 3R, eras +0.57/+0.64/+0.46; half at 1.5R rest trail 4: 50% profitable +0.51R. 1h: all-in 3R 199 trades +0.19R; trail 4 +0.35R; half at 1R rest trail 4: 53% profitable +0.12R (eras +0.05/+0.27/+0.05), streak 6; half at 1.5R rest trail 4: +0.15R, last era -0.03. Scale-out smooths the ride and raises profitable trades but costs return.
B. Trend filter (exit half at 1.5R, rest trail 4). 1h: none +0.15R (183 trades, last era -0.03); week is up (close above close 7 days ago) 140 trades 48% +0.28R (eras +0.37/+0.47/+0.04); above 20-day line 136 trades +0.26R; above rising 7-day line 121 trades +0.20R. Opposite (week down) 71 trades +0.02R. 4h: none +0.51R; above rising 7d line 45 trades +0.62R; above 20d line 48 trades +0.58R; week up 51 trades +0.47R; week down only 8 trades. Filters help a little; samples small.
C. Volatility squeeze then breakout: 1h 426 trades +0.02R, 4h 137 trades -0.10R (3R) / +0.06R, drawdowns 29R to 51R. Not an edge. Dropped.
Open design question: scale-out and trailing do not fit the fixed Entry/Stop/Target card; a single fixed 3R target does (1h +0.19R, 4h +0.54R). Also decide whether Trend Rider stops firing on 1h/4h once Swing Rider exists (same breakouts would otherwise fire twice).

Nov 8 (Na, after BTC flushed to $73,510 at 11:00 HST: "we should be catching this. These are times when traders gain and lose most"). The meter said the same multi-day sentence before and after the flush; it has no "something just happened" line (proposal: a short fresh-event line, auto-expiring, same card, plus a freshness check in review). Flush = a 1h bar whose low is 2.5%+ under its open and under the prior 48 hours' low. 219 events in 6.8 years (about 32 a year, scripts/replay-flush.mjs). After a flush: new lower low within 24h 69% (within 72h 77%), price higher after 24h 57% (50% in 2025-26), typical further dip 2.7%, typical bounce 2.5%. Trades, fee 0.15%: E1 market buy right after: 2R -0.04R, 3R +0.02R, trail -0.02R (no edge). E3 buy after a higher close: +0.09 to +0.14R, uneven by era. E4 sell when a 1h bar closes below the flush low: -0.06 to -0.19R (shorts lose). E2 resting limit buy at flush low +0.25 ATR (up to 24 bars, stop flush low -0.75 ATR, so risk is 1 ATR): 123 fills of 219, 3R target +0.37R (eras +0.37/+0.32/+0.04/+0.85, 37% profitable, positive in all four); trail 3 ATR +0.57R (eras +0.68/+0.46/-0.01/+0.99, 34% profitable); 2R +0.19R. Caveats: touch counts as a fill (adverse selection ignored), 12 variants here on top of earlier tests, 2023-24 is about flat, and stops were wider in the past (avg stop by era 1.71/1.51/0.99/1.11%) than now (Nov 8 ATR14(1h) 322, risk 0.44%, which would make the 0.15% fee cost 0.34R), so today's edge is likely smaller than the backtest. Proposed name Flush Rider; not built.

## Nov 8: Flush Rider build notes
Independent review caught: dir as a SQL literal breaks the idle dry-run (it reads dir at insert parameter 3, so pass it as a parameter); a late cron scan could push a stale alert (push only when scanMs <= 2x scan interval); the scan window must include an extra cooldown of bars; the 24-hour wait must be clock time. Wording lesson: "7 in 10 retest" is not "7 in 10 trades". Open research from Na: how Trend Rider, Rebound Rider and the hidden signals behave around flushes and could improve there.

## Nov 8: Swing Rider build note
Splitting a signal off a chart means its old rows keep the old label, so the one-trade-at-a-time check must read both labels or deploy day can fire the same breakout twice. The 4h e2e only fires if the run happens after price touches the level inside the forming bar; a test run too early shows no insert.

## Nov 8: meter wording needs a live half
Na: a headline that only tells the week's story stays the same all day while price moves. The fix is two halves, a story (slow) and a right-now line off the week's low (live, bounce % changes each refresh). Two percentages in one sentence (down 7.1% from the peak vs down 3.8% on the week) read as a contradiction because they start from different points; say which start each one uses.

## Nov 8: flush research (Na: "how our current signals can improve in these situations, even the background signals")
Method: BTC 5m history Jan 2020 to Nov 6 2026, 221 flushes (same test as Flush Rider: 1h bar down 2.5%+ from open that breaks the 48h low). Replayed Trend Rider (1h/30m/15m), Swing Rider 4h, Rebound Rider (1h, 5m) and every hidden signal (bg_*.json, 2R targets), 0.15% round trip fee, and grouped each entry by hours since the last flush. Scripts: scratchpad fctx.mjs, fctx2-4.mjs, fr200.mjs (not in repo).
1. Live signals are silent after flushes. In the 3 days after a flush: Trend Rider 1h 36 of 342 buys, Rebound 1h 13 of 75, Swing 2 of 60. Their 200-day and 1h-trend checks shut buys off in a crash. Nothing to fix there: Flush Rider is the one built for it.
2. TRAP: hidden Volume spike 5m SELL looked like +0.30R after fees in the 6 hours after a flush, positive in all four eras. It is look-ahead. All of it sits in the flush hour itself: sells that fired BEFORE the 1h bar had dropped 2.5% (when no one could know it was a flush) won 84% (+1.21R, 269 trades); sells that fired once the flush was already visible won 30% (-0.27R, 177 trades). Any "0-6h after a flush" bucket includes the flush hour and is contaminated the same way, buys too. Rule: a flush filter must use only what was visible at entry (drop so far this hour, or a completed 1h bar).
3. After the flush bar closes, no hidden signal has an edge (Volume spike sells 1-6h after: -0.33 to -0.38R; Momentum, Swing, Breakdown and Grind Down 0-6h mostly within +-0.1R, a few sample sizes under 50).
4. Hidden "oversold" buys right after a flush lose most (RSI oversold 5m 6% wins, 1h 14%, 15m 13% in the 0-6h bucket, small n and partly the look-ahead above). Direction of the idea: do not buy oversold into a flush, wait for the retest like Flush Rider does.
5. Flush Rider split by trend (124 trades, +0.36R): below the 50-day +0.47R (83 trades, positive in all four eras) vs above the 50-day +0.15R (41); below the 200-day +0.48R (70) vs above +0.21R (54). Looks useful but it is subgroup cutting on the same 124 trades (about 6 cuts tried), so NOT adopted. Revisit after 20 live trades. Today (Nov 8) price is under the 50-day and above the 200-day.
6. Nov 8 side checks for Na's 200-line questions: touches of the 200-DAY from above (11 events since 2019): +4.9% a week later (64% up) but no edge at 14 and 30 days. Reclaim of the 200-day after 7+ days under (14 events): +8.8% at 30 days (64% up), +15.2% at 60 days (79% up), 5 of 14 fell back under within 2 weeks. The 200-WEEK line is about $68,100 (site) and Bitcoin has not touched it since Aug 2026; the 200-day was last under price Aug 18 and was not breached last month.
