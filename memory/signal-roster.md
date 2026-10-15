# Signal roster — history and reasoning, not a snapshot

This file used to open with a specific count and a full list of names,
current status, and promotions, restated as fact. That's exactly what
drifted: Whale Flow was fully retired in v19.7, but the memory update
that should have gone with it never happened, and this file sat wrong,
still claiming 14 signals and no mention of the removal, for two real
versions before anyone caught it (Na, not a process check).

The fix: this file no longer asserts a current count, a current list
of names, or which combos are promoted right now as settled fact.
Anything that changes with a routine code commit doesn't belong here
as a claim, it belongs in the code and gets read from there directly.

**For the real, current state, run `node memory/check-signal-state.mjs`
from the repo root.** It imports `ALL_SIGNALS`, `SIGNAL_RATES`,
`KILLED_COMBOS`, and `TESTING_SIGNALS` straight from `lib/signals.js`
and prints the honest, current picture: total count, what's currently
promoted and at what rate, what's testing, what's fully killed, and
what's dark. For whether something is *currently, actually* showing
as verified (not just statically promoted), that also needs a live
check against `/api/market`'s `liveGate`/`regimeGate` — the live gate
can demote a statically-promoted combo in real time, and the
regime-only path can promote a combo with no static entry at all. A
static list was never going to stay honest either way.

What this file keeps, and will keep adding to, is the part that
doesn't go stale: the real, dated reasoning behind every promotion,
kill, and retirement. A historical fact ("this was tested and found
weak on this date, on this sample") stays true forever, even after
the current state moves on.

## Standing rules for how signals get classified

- **Statically promoted** (an entry in `SIGNAL_RATES` at or above the
  bar) is necessary but not sufficient for "currently verified" — the
  live gate can and does demote a statically-promoted combo based on
  its own real, recent record, and this has happened repeatedly
  (Volume spike and Grind Down have each dipped below the bar
  post-promotion; Grind Up's original promotion didn't survive a
  later, deeper audit at all).
- **`TESTING_SIGNALS`** means logged and shown admin-only even while
  unproven, building a real, live track record before ever being
  judged.
- **`KILLED_COMBOS`** stops one specific `(label, tf, dir)`
  combination from ever firing or logging again, while the signal
  *name* stays in `ALL_SIGNALS` if it still has other, real combos
  worth watching (e.g. Swing Early has most of its combos killed, but
  the name stays, since 15m|bear is still alive).
- **Full retirement** (removed from `ALL_SIGNALS` entirely) is the bar
  above killing individual combos — only once every real combo a
  signal could ever fire on is dead, with nothing left worth tracking.
  Once retired, a signal is gone everywhere, including the total
  count — it doesn't stay listed with a "retired" tag. Standing rule,
  set directly by Na.
- **Regime-only verification**: a combo can be "proven" with zero
  static promotion behind it at all, purely from a strong, current,
  condition-specific record (≥10 real trades in that specific regime,
  ≥58%). This is checked live, never asserted as a fixed list here,
  since it's inherently a moving target — the same combo can be
  verified today and not tomorrow depending on real, current market
  behavior.

## Full retirements — the real, dated evidence behind each one

**Grind Up** (Sep 24): originally promoted, then retired after a
deeper audit directly contradicted it — 40% on 406 real fires (5m),
~31% across 4 real coins (15m). An earlier-trigger variant was tested
directly and made no real difference. Specifically checked, on Na's
direct hypothesis, whether it does better in a genuinely
bullish-trending market — it doesn't (25% on 5m, 33% on 15m, barely
different from its already-weak overall numbers). The underlying idea
(recent up-bars predict more upside) didn't hold under any real
condition tested. Grind Down, the separate short-side sibling from the
same detector, was entirely unaffected.

**Whale Flow** (Sep 24, v19.7): both directions tested and found
genuinely weak. Long (buy on an oversold market, 4h): 25% on its own
real, live 20-trade record. Short (sell on an overbought market, 4h):
looked genuinely promising on a real, small, recent, 6-fire sample
(67%), but a properly-deepened, cross-coin test told a different
story — 18W/44L, 29% on 62 real whale-sell events across all four
watchlist coins (BTC alone, on a real but tiny 7-fire slice, was the
only one anywhere near the bar). Same exact trap as Coil on 30m long
(below) — a real, small, recent sample that didn't survive being
properly deepened.

## Killed combos — the real, dated evidence behind each one

All found via either a live audit or a real, direct, independent
backtest against deep history, on large, unambiguous samples (run the
script for the current, exact list):
- Momentum | 1m/15m | bear — weak across every real condition split
  (43-44% down to 21-27%)
- Quiet accumulation | 1m/5m | bull — 32% on 1225 fires, 35% on 579
- Swing Early | every combo except 15m|bear — 1m both directions
  (33%/33% on 573/610), 5m both (35%/33% on 383/407), 15m|bull
  (35%/140), 30m both (33%/29% on 78/104), 1h both (34%/34% on 77/87),
  4h both (39%/35% on 41/37)
- Grind Down | 5m | bear — 32% on 356 fires

## A small sample can go either way — always deepen before trusting it

Two real, opposite outcomes from properly deepening a promising, small
sample, same discipline, different results:
- **Coil | 30m | bull**: 67% on a real, small, BTC-only 6-fire sample
  looked promising. Properly deepened across all four watchlist
  coins: 42%, genuinely doesn't hold.
- **Swing | 15m | bear**: 80% on a real, small, BTC-only 5-fire sample.
  Deepened the same way: 82% combined on 17 real fires across all
  four coins, genuinely held up — promoted.
- **Whale Flow | 4h | bear** (above): same trap as Coil, didn't survive
  deepening.

The only way to know which way a small sample will go is to actually
deepen it — more history, more coins — before promoting. Never promote
on a single-coin, sub-10-fire result alone, and never assume a small
sample is automatically wrong either.

## Real, currently-known condition-specific edges (regime-only, check live for current status)

These were the direct motivation for extending regime-only
verification into `public-stats` and `signal-catalog` — both had been
silently blind to this whole class of real, currently-working signal
until fixed:
- RSI oversold | 1m | bull — was genuinely strong (70% on 10)
  specifically in a sideways-ranging market; weak in trending regimes.
- Reversal watch | 1m | bear — was genuinely strong (90% on 10)
  specifically in a bullish-trending market.
- Volume spike | 1m | bull — was strong (85% on 13) specifically in a
  bearish-trending market; weak in sideways-ranging (33%) and
  bullish-trending (40%). A given open position only counts as
  verified if it fired in the specific regime that's currently
  strong — two positions on the exact same combo can have different
  verified status depending which regime each one fired in.

These specific numbers are a historical snapshot from when they were
found, not a current status — check live for whether they still hold.

## FOCUS MODE (Oct 12, 2026, v19.21)
Na was overwhelmed by too many signals and didn't know which to watch. (History: at v19.21 `VISIBLE_SIGNALS` was an empty list, since v19.26 it holds Trend Rider.) Every original signal keeps being detected and logged (records keep building) but is hidden everywhere: no verified badge (provenContext returns null for hidden labels), no dashboard cards, no Watch Live rows, no push, no promotion pings. The only signal on the dashboard is Trend Rider (lib/trend.js, lib/trendRunner.js), public on six timeframes since v19.22 and v19.23. To bring a signal back: add its exact label to VISIBLE_SIGNALS and add a dated line here saying why it earned it. Coil, Swing and Swing Early are the testing candidates; Swing Early 15m bear is the only one that held up in the full-year live-rule replay, so it is the natural first to return, after a re-test.

## Promotions — the real, dated evidence behind each one still live as of last check

(Run the script for the current, authoritative promoted list — this
is the reasoning behind each one, current at time of promotion.)
- Reversal watch | 1h | bull — 100%, thin sample, kept on Na's call,
  from very early in the project
- Momentum | 4h | bull — PULLED Oct 11 (v19.20). The old 93% came from
  a backtest that skipped the per-timeframe move-size rule (Momentum
  fired every bar). Under the live rule BTC gives 1 fire in a year.
  Needs a real re-test before it gets a badge again. Full-year live-rule
  replay of every combo on BTC: all sit near 33% (random entry level);
  only Swing Early | 15m | bear holds (40% on 225 fires, 43% on the
  held-back test). Quiet accumulation ratings were all below the bar
  already, so none changed. Swing Rebound (Reversal watch bull 1h/4h)
  tested with 2-4x wider stops and 12-72h holds: 22 and 15 fires a year,
  nothing holds up (avg R between -0.3 and +0.3), nothing built.
- Swing | 15m | bear — 82%, promoted after deepening a thin, 5-fire,
  BTC-only result across all 4 watchlist coins (14W/3L on 17 combined)
- Swing Early | 15m | bear — 73%, the one surviving Swing Early combo
- Grind Down | 15m | bear — 62% (26W/16L on 50 real fires)
- Volume spike | 15m | bull — 63% (bias-aligned gate already built
  into the detector; a 100%-on-11-fires "ranging" slice was too thin
  to trust, this uses the more robust 46-fire bias-aligned number)
- Volume spike | 30m | bull — 60% (12W/8L on 22 real fires)

## Killed-combo recheck, first run (Oct 11, 2026)
Every killed combo from 5m up replayed on fresh BTC history under the live rules: nothing came back. Best was Momentum 15m bear at 51% on 49 fires, but 44% in the second half, too thin and fading. Everything else sits at 29-38%. Runs monthly now (scripts/recheck-killed.mjs); 1m combos are not rechecked.

Oct 13 (v19.26): old dashboard layout restored but the original signals stay hidden (FOCUS_MODE = true). Trend Rider is the one signal shown, as cards in Open Alerts. SIGNAL_RATES, KILLED_COMBOS, TESTING_SIGNALS unchanged.

Oct 13 (v19.28): Trend Rider registered as a public test in ALL_SIGNALS (publicTest, serverOnly, coins BTC, tfs six). It is visible to admin and public with a 'testing' tag and its real record, with no verified badge, because it has no SIGNAL_RATES entry. It only becomes verified through the same live bar as everything else. SIGNAL_RATES, KILLED_COMBOS, TESTING_SIGNALS unchanged.

Oct 13 (v19.31): Trend Rider moved to a plain stop and target (stop 2 ATR, target 0.75R, 4 hour sells off), no trailing stop. Still a public test (publicTest, serverOnly) with no SIGNAL_RATES entry. SIGNAL_RATES, KILLED_COMBOS, TESTING_SIGNALS unchanged.

## Oct 13 (v19.35): Trend Rider covers every coin
Na asked that Trend Rider include every coin he adds, not just Bitcoin. The ALL_SIGNALS entry lost its `coins` list (no list means every coin); the runner scans Bitcoin plus every watchlisted coin. Still a public test (not yet verified): the rules were tuned on Bitcoin, so other coins are a live experiment and the track record for each coin builds from here.

## Oct 13 (v19.36): Rebound Rider registered
New ALL_SIGNALS entry "Rebound Rider": publicTest + serverOnly, tfs ["1h"], no coins list (every watched coin), added to VISIBLE_SIGNALS. No SIGNAL_RATES entry, so it is a public test (not verified) until it clears the live bar. SIGNAL_RATES, KILLED_COMBOS, TESTING_SIGNALS unchanged. Reason: Na asked for the bounce catcher back; the Oct 13 rebound study found a thin edge on the 1h chart only.

Oct 14 (v19.38): Trend Rider description updated (1 minute chart no longer checks the 1 hour chart). SIGNAL_RATES, KILLED_COMBOS, TESTING_SIGNALS unchanged.

## Oct 15 (v19.40): Rebound Rider on 5m
Rebound Rider tfs now ["1h","5m"]; the 5m scan skips the 1h-trend condition (REBOUND_FREE_TFS). Same label, no brand or mark. History says roughly break-even on 5m (58%, +0.02R, 1,214 BTC trades), kept as a watched experiment at Na's request. Remove it if the live record sits near or under 57%.
