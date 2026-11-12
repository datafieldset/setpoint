# Signal overhaul plan (Nov 11, Na: "ok do it and push")

Goal: at least one signal we can stand behind, because the signals are what Setpoint sells. "Reliable" means a positive average after costs on enough trades, in more than one market period, then confirmed live. It does not mean it wins every time.

Rules are written here BEFORE results are looked at. Do not move the bar after seeing a number.

## Pass bar (same for every signal, live or hidden)
- Bitcoin only (standing rule).
- Costs: 0.15% round trip fee plus 0.05% slippage, so 0.20% per trade. Fees stay in our grading only, not in what customers see (Na, Oct 11).
- Positive after costs in every era that has at least 8 trades: 2020-21, 2022, 2023-24, 2025 (to the lock date).
- Enough trades: 100+ on charts under 1 hour, 50+ on 1 hour and slower.
- Still positive with its best 5% of trades removed.
- Beats the luck test: clearly better than random entries with the same stop and target, taken in the same trend conditions.
- Then the locked exam: the most recent 12 months of data (Nov 7 2025 to Nov 6 2026) are graded once, at the end.
- Honest limit: Swing Rider and Flush Rider were designed with those 12 months in view, so the exam is only clean for new ideas. For those two the real exam is the live record.

## Steps
1. Scoreboard: replay every signal under the rules above, with the luck test. Retire what fails (list it for Na first, retiring is a code change and needs his yes).
2. Stress-test Swing Rider and Flush Rider: worse fills, shifted start dates, losing streaks, drawdown, time in trade, 1-minute data for which-was-hit-first, Coinbase prices instead of Binance.
3. A few improvements from a short written list (below), each counted, each judged on data it was not tuned on (tune on one stretch, test on the next, roll forward).
4. Look for a third candidate, a few ideas only: slow charts, bigger targets, trend filters. Biggest gap: every live signal is a buy and most go quiet under the 200-day, so there is nothing for a bear market.
5. Live proof: sellable at 20+ live trades with a positive average; compare live to replay monthly.

## Idea list (add here BEFORE testing; count every try)
- Flush Rider: only below the 50-day (seen Nov 8 as a subgroup cut, so it needs fresh data or the live record).
- A down-market or sell-side candidate (not designed yet).
- "Move the stop to break-even" exit that still fits the fixed card (layout question for Na before building).

## Tries written down Nov 11 BEFORE running them (Na away: "just do the test and improvements or changes without me")
Counted: 17 tries. With this many, a pass needs the full bar, the luck test and the locked exam, and neighbors that agree.
- Swing Rider neighbors (robustness, not shopping): target 2R, target 4R, lookback 10 bars, lookback 40 bars.
- Swing Rider on other slow charts: 2 hour, 6 hour, 12 hour, daily.
- Sell side (the bear-market gap): the same breakout rules as a 4 hour sell with a 3R target; the same on 1 hour; and "Pop" (Flush Rider mirrored: a 1 hour bar up 2.5%+ that breaks the 48 hour high, sell the retest, 3R).
- Trend Rider 1 hour with a 2R target and with a 3R target; Rebound Rider 1 hour with a 3R target.
- Flush Rider: below the 50-day only; neighbors (drop 2% and 3%, target 2R and 4R) as robustness.
- Added Nov 11 after the tougher luck test, BEFORE running (tries 18 and 19): "trend-state buy": no breakout needed. Buy the next bar's open whenever the chart is above its 200-day, RSI above 60 and ADX above 20, stop 2 ATR, target 3R, one trade at a time. On 4 hour (N1) and on 1 hour (N2). Why: random buys under those three conditions made +0.36R on 4h, almost what Swing Rider makes (+0.46R), so the trend state may be the edge and the breakout trigger may add little.
Ship rule while Na is away: only a signal that passes everything above ships, as a public test, through the normal data-only path. Live signals that fail stay as they are until Na picks (retire, hide or keep).

## Guardrails
No look-ahead (use only what was visible at entry; see the Nov 8 Volume spike trap). Memory updated with every change. A separate agent re-checks anything customers see. Nothing ships to the site without Na's yes.

## Status Nov 11 (after Na's decisions)
- Done: steps 1 to 4 (results in lessons-learned.md). Shipped v23.4: Swing Rider entry replaced, Trend Rider and Rebound Rider retired.
- Live now: Swing Rider (4h) and Flush Rider (1h), both public tests. Sellable bar: 20+ live trades with a positive average; compare live to replay monthly.
- Open: no down-market signal (three sell ideas failed). Next research should use data beyond price (see lessons-learned.md Nov 11 for what was tried).

## Second and third signal hunt (Nov 11 night, Na: "12 trades a year is not enough to charge people... start building another alert that is more frequent"; also "look at what we discussed", meaning data beyond price, and the traditional indicators traders still use)
Target: a signal that passes the same bar AND fires at least about 40 times a year. Written here BEFORE running. Tries 20 to 27 (8 new), so 27 in total.
Data found reachable from the cloud: Binance futures funding rate (every 8 hours, Jan 2020 on) and Binance futures "metrics" (open interest, top-trader and all-account long/short ratios, taker buy/sell ratio, every 5 minutes, Sep 2020 on) from data.binance.vision. Bybit and BitMEX are blocked (403); OKX only keeps about 3 months. Eras for these ideas: Sep 2020-21, 2022, 2023-24, 2025 to the lock. All on Bitcoin, cost 0.20%, entry at the next bar's open, one trade at a time, only data finished before the entry.
- D1 Squeeze buy (1h): the latest funding print is negative (shorts are paying) and a 1h bar closes above the high of the prior 24 bars. Stop 2 ATR, target 3R.
- D2 Washout buy (1h): open interest fell 5% or more over the last 4 finished hours while price fell 2% or more over the same 4 hours. Stop 2 ATR, target 3R, 24 hour wait between entries.
- D3 Crowded-long sell (1h): funding at or above the 90th percentile of the last 90 days, open interest up 5% or more in 24 hours, and a 1h close under the low of the prior 24 bars. Stop 2 ATR, target 3R. (The bear-market gap.)
- D4 Fresh-money breakout buy (1h): close above the prior 48-bar high, open interest up 3% or more in 24 hours, funding below its 90-day median (not crowded yet). Stop 2 ATR, target 3R.
- D5 Crowd-is-short buy (4h): all-account long/short ratio in the lowest 10% of the last 30 days at a 4h close that is an up bar. Stop 2 ATR, target 3R.
- D6 Crowd-is-long sell (4h): the mirror (ratio in the highest 10%, a down bar, price under the 200-day). Stop 2 ATR, target 3R.
- T1 Pullback in an uptrend (1h, traditional): price above the 200-day and the 50-day is rising (above its value 10 days ago); 1h RSI(14) closed under 35 within the last 6 bars and a 1h bar now closes back above its 20-bar EMA. Stop 2 ATR, target 3R.
- T2 Yesterday's-high break (1h, traditional): price above the 200-day, yesterday closed above its 20-day average; the first 1h close of the day above yesterday's high. Stop 2 ATR, target 3R, one a day.
Not a new try: the looser Swing Rider (no "not stretched" check, about 25 a year, +0.35R) is already tested and is the fallback for frequency.
A pass needs the full bar, the luck test and the locked exam. With 27 tries, one lucky pass is expected by chance, so a pass also needs its neighbor settings to agree.
- Try 28, written Nov 11 after the first run and BEFORE running it: D4 with the project's standing buy rule added (price above the 200-day). Why: D4 was positive overall (+0.31R, 102 trades) and failed only on 2022, the bear year, where every buy idea in this project loses. This is a change made after seeing a result, so it only counts if the locked year and the neighbor settings agree. Also run as checks, not tries: the plain 48-bar breakout with the same stop and target (does the open-interest and funding part add anything?), and D4's neighbors (24 and 72 bars, open interest 2% and 5%, target 2R and 4R).

## Status Nov 11 night
- Tries 20 to 28 are done: all fail or are too rare (results in lessons-learned.md). 28 tries counted.
- Shipped v23.6 (Na: "Yes do it"): Swing Rider without the "not stretched" check. The real replay number is +0.23R on 163 trades, not the +0.35R first quoted (see signal-roster.md, Nov 11 v23.6).
