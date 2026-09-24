# Signal roster — current, live status

Ground truth as of v19.2 (Sep 22). This file will drift — before trusting it, re-check `SIGNAL_RATES`/`KILLED_COMBOS`/`TESTING_SIGNALS`/`ALL_SIGNALS` directly in `lib/signals.js`, and for *current* (not just statically-set) status, query `provenContext` live against `/api/market`'s `liveGate`/`regimeGate`. Static promotion is necessary but not sufficient — the live gate can and does demote a statically-promoted combo in real time.

## All 15 real signal names
Reversal watch (brand: Rebound) · Grind Up · Grind Down · Swing · Swing Early · Coil · Momentum · Volume spike (brand: Surge) · Volume building early · RSI oversold (brand: Snapback) · RSI overbought · Quiet accumulation · Breakout · Breakdown · Whale Flow

## Statically promoted (in SIGNAL_RATES) as of v19.2
- Reversal watch | 1h | bull — 100% (thin sample, kept on Na's call, from very early in the project)
- Momentum | 4h | bull — 93%, hard-gated in-detector to against-bias fires only (28W/2L on 30 real fires); the blended, ungated number is a much weaker 66%
- Swing | 15m | bear — 82%, promoted after deepening a thin, 5-fire, BTC-only audit result across all 4 watchlist coins (14W/3L on 17 combined)
- Swing Early | 15m | bear — 73% (the ONLY surviving Swing Early combo — every other timeframe/direction for this signal was killed, see below)
- Grind Down | 15m | bear — 62% (26W/16L on 50 real fires)
- Volume spike | 15m | bull — 63% (bias-aligned gate already built into the detector; the 100%-on-11-fires "ranging" slice was too thin to trust, this uses the more robust 46-fire bias-aligned number)
- Volume spike | 30m | bull — 60% (12W/8L on 22 real fires)

Static promotion ≠ currently showing as verified — check the live gate. As of the last direct check, several of the above were *currently* demoted by their own real, recent record (Grind Up both timeframes were retired outright for this reason — see below; Volume spike and Grind Down have each dipped below the bar on their live-gate record at various points this session). Don't assume a name on this list is firing as verified right now without checking.

## Retired from SIGNAL_RATES (were promoted, no longer are)
- Grind Up | 5m | bull and Grind Up | 15m | bull — both retired (not killed, just removed from the static table) after a real, independent, much-deeper audit directly contradicted the original, smaller promoting samples: 40% on 406 real fires (5m), ~31% across four real coins (15m). Root-cause investigated directly: tested firing on an earlier trigger (fewer confirming bars required) — made no real difference, 29-37% either way. The underlying idea (a recent run of up-bars predicts more upside) doesn't hold, regardless of timing.

## In TESTING_SIGNALS (logged + shown admin-only even while unproven)
Coil, Swing, Swing Early, Whale Flow

## KILLED_COMBOS (never fire again, filtered out of computeSignals entirely)
All found via either a live audit or a real, direct, independent backtest against deep history, on large, unambiguous samples:
- Momentum | 1m | bear, Momentum | 15m | bear — weak across every real condition split (43-44% down to 21-27%)
- Quiet accumulation | 1m | bull (32% / 1225 fires), Quiet accumulation | 5m | bull (35% / 579 fires)
- Swing Early | every combo except 15m|bear — 1m both directions (33%/33% on 573/610 fires), 5m both (35%/33% on 383/407), 15m|bull (35%/140), 30m both (33%/29% on 78/104), 1h both (34%/34% on 77/87), 4h both (39%/35% on 41/37)
- Grind Down | 5m | bear (32% / 356 fires)

## Currently dark / collecting-only (no static entry, not in TESTING_SIGNALS)
Volume building early, RSI overbought, Breakout, Breakdown. Also Whale Flow's two directional variants beyond its testing status: gated in-detector to only fire on outflow-during-oversold (long) or inflow-during-overbought (short), on 4h only — both still testing, neither promoted yet as of last check.

## Real, currently-known condition-specific edges worth remembering
- RSI oversold | 1m | bull — genuinely strong (70% on 10) specifically in a sideways-ranging market; weak in trending regimes. Regime-only verified, no static entry.
- Reversal watch | 1m | bear — genuinely strong (90% on 10) specifically in a bullish-trending market. Regime-only verified.
- Volume spike | 1m | bull — strong (85% on 13) specifically in a bearish-trending market; weak in sideways-ranging (33%) and bullish-trending (40%). A given open position only counts as verified if it fired in the specific regime that's currently strong — two positions on the exact same combo can have different verified status depending which regime each one fired in.
These three were the direct motivation for extending regime-only verification into `public-stats` and `signal-catalog` — both had been silently blind to this whole class of real, currently-working signal.
