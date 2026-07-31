# Setpoint v5.6

## New: a continuous top/bottom volatility meter per coin

Not a fired alert, a constantly-updating visual read that sits right on each coin's chip, translating a genuinely useful idea from a GainzAlgo TradingView indicator Na's been using. The concept, not the code, Pine Script can't run in this app, this is a fresh JavaScript implementation of the same underlying logic.

**How the score works, 0-100, 50 is neutral:**
- **Compression** (tight, coiled, low volatility relative to its own recent history) → stays near 50, no lean
- **Expansion** (a real directional move actively building) → leans toward the direction it's moving, 60-75 depending on strength
- **Exhaustion** (was recently in a strong expanding move, and that volatility is now visibly declining) → pushes hardest toward the extreme, 90 near a top, 10 near a bottom. This is the actual "catch the turn" signature, the move that built the trend running out of steam.

Tested with four synthetic scenarios before shipping: neutral compression, building expansion, and exhaustion at both the top and bottom, all confirmed reading correctly.

This is purely informational for now, nothing here logs to the database or fires a trackable alert. If it proves useful over time, the plan is to build a real, backtestable alert around it next, likely improving Reversal watch with this same volatility-exhaustion signature rather than starting a new signal from scratch.
