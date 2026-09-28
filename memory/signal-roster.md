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

## Promotions — the real, dated evidence behind each one still live as of last check

(Run the script for the current, authoritative promoted list — this
is the reasoning behind each one, current at time of promotion.)
- Reversal watch | 1h | bull — 100%, thin sample, kept on Na's call,
  from very early in the project
- Momentum | 4h | bull — 93%, hard-gated in-detector to against-bias
  fires only (28W/2L on 30 real fires); the blended, ungated number is
  a much weaker 66%
- Swing | 15m | bear — 82%, promoted after deepening a thin, 5-fire,
  BTC-only result across all 4 watchlist coins (14W/3L on 17 combined)
- Swing Early | 15m | bear — 73%, the one surviving Swing Early combo
- Grind Down | 15m | bear — 62% (26W/16L on 50 real fires)
- Volume spike | 15m | bull — 63% (bias-aligned gate already built
  into the detector; a 100%-on-11-fires "ranging" slice was too thin
  to trust, this uses the more robust 46-fire bias-aligned number)
- Volume spike | 30m | bull — 60% (12W/8L on 22 real fires)
