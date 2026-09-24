# Signal roster — current, live status

Ground truth as of v19.6 (Sep 24). This file will drift — before trusting it, re-check `SIGNAL_RATES`/`KILLED_COMBOS`/`TESTING_SIGNALS`/`ALL_SIGNALS` directly in `lib/signals.js`, and for *current* (not just statically-set) status, query `provenContext` live against `/api/market`'s `liveGate`/`regimeGate`. Static promotion is necessary but not sufficient — the live gate can and does demote a statically-promoted combo in real time.

## All 14 real signal names
Reversal watch (brand: Rebound) · Grind Down · Swing · Swing Early · Coil · Momentum · Volume spike (brand: Surge) · Volume building early · RSI oversold (brand: Snapback) · RSI overbought · Quiet accumulation · Breakout · Breakdown · Whale Flow

## Statically promoted (in SIGNAL_RATES) as of v19.2
- Reversal watch | 1h | bull — 100% (thin sample, kept on Na's call, from very early in the project)
- Momentum | 4h | bull — 93%, hard-gated in-detector to against-bias fires only (28W/2L on 30 real fires); the blended, ungated number is a much weaker 66%
- Swing | 15m | bear — 82%, promoted after deepening a thin, 5-fire, BTC-only audit result across all 4 watchlist coins (14W/3L on 17 combined)
- Swing Early | 15m | bear — 73% (the ONLY surviving Swing Early combo — every other timeframe/direction for this signal was killed, see below)
- Grind Down | 15m | bear — 62% (26W/16L on 50 real fires)
- Volume spike | 15m | bull — 63% (bias-aligned gate already built into the detector; the 100%-on-11-fires "ranging" slice was too thin to trust, this uses the more robust 46-fire bias-aligned number)
- Volume spike | 30m | bull — 60% (12W/8L on 22 real fires)

Static promotion ≠ currently showing as verified — check the live gate. As of the last direct check, several of the above were *currently* demoted by their own real, recent record (Grind Up both timeframes were retired outright for this reason — see below; Volume spike and Grind Down have each dipped below the bar on their live-gate record at various points this session). Don't assume a name on this list is firing as verified right now without checking.

## Fully retired (removed from ALL_SIGNALS entirely — never shown, never counted, anywhere)
- Grind Up — fully removed from the registry (Sep 24), not just unpromoted or marked "retired." Standing rule set directly by Na: once something's killed for good, it's gone everywhere, including the total count — a signal that's fully done doesn't stay listed with a "retired" label, it's deleted from `ALL_SIGNALS` outright. Total signal count is 14, not 15. Real, exhaustive testing history behind this one: originally promoted, then retired from SIGNAL_RATES after a deeper audit contradicted it (40% on 406 fires, 5m; ~31% across 4 coins, 15m); an earlier-trigger variant was tested directly and made no real difference; specifically checked, on Na's direct hypothesis, whether it does better during a genuinely bullish-trending market — it doesn't (25% on 5m, 33% on 15m, barely different from its already-weak overall numbers). The underlying idea (recent up-bars predict more upside) simply doesn't hold under any real condition tested. Grind Down (the separate, short-side sibling from the same detector) is entirely unaffected — still live, still promoted on 15m, still counted.
- `KILLED_COMBOS` (in `lib/signals.js`) is a different, narrower thing from full retirement — it stops one specific `(label, tf, dir)` combination from ever firing/logging again, while the signal *name* stays in `ALL_SIGNALS` if it still has other, real combos worth watching (e.g. most of Swing Early's combos are killed, but the name itself stays, since 15m|bear is still live). Only remove a name from `ALL_SIGNALS` entirely once every real combo it could ever fire on is dead and there's nothing left worth tracking — that's the bar for "gone everywhere," not just "currently weak."

## In TESTING_SIGNALS (logged + shown admin-only even while unproven)
Coil, Swing, Swing Early, Whale Flow

## KILLED_COMBOS (never fire again, filtered out of computeSignals entirely)
All found via either a live audit or a real, direct, independent backtest against deep history, on large, unambiguous samples:
- Momentum | 1m | bear, Momentum | 15m | bear — weak across every real condition split (43-44% down to 21-27%)
- Quiet accumulation | 1m | bull (32% / 1225 fires), Quiet accumulation | 5m | bull (35% / 579 fires)
- Swing Early | every combo except 15m|bear — 1m both directions (33%/33% on 573/610 fires), 5m both (35%/33% on 383/407), 15m|bull (35%/140), 30m both (33%/29% on 78/104), 1h both (34%/34% on 77/87), 4h both (39%/35% on 41/37)
- Grind Down | 5m | bear (32% / 356 fires)
- Grind Up | 5m | bull, Grind Up | 15m | bull — see "Fully retired" above

## Currently dark / collecting-only (no static entry, not in TESTING_SIGNALS)
Volume building early, RSI overbought, Breakout, Breakdown. Also Whale Flow's two directional variants beyond its testing status: gated in-detector to only fire on outflow-during-oversold (long) or inflow-during-overbought (short), on 4h only — both still testing, neither promoted yet as of last check.

## Real, currently-known condition-specific edges worth remembering
- RSI oversold | 1m | bull — genuinely strong (70% on 10) specifically in a sideways-ranging market; weak in trending regimes. Regime-only verified, no static entry.
- Reversal watch | 1m | bear — genuinely strong (90% on 10) specifically in a bullish-trending market. Regime-only verified.
- Volume spike | 1m | bull — strong (85% on 13) specifically in a bearish-trending market; weak in sideways-ranging (33%) and bullish-trending (40%). A given open position only counts as verified if it fired in the specific regime that's currently strong — two positions on the exact same combo can have different verified status depending which regime each one fired in.
These three were the direct motivation for extending regime-only verification into `public-stats` and `signal-catalog` — both had been silently blind to this whole class of real, currently-working signal.
