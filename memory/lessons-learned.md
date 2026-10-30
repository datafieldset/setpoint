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
