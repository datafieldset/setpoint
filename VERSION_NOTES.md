# Setpoint v2.9

## What Changed

### Backtest Download Report - Now shows market condition analysis

The download markdown now captures complete signal context and analyzes when signals actually work.

**Data captured per signal:**
- Signal context tags: biasTag (aligned/against market bias), trendTag (with/against trend), volTag (volume confirmation)
- Market conditions: bias direction, how stretched the market was (biasStretch)
- Full signal metadata: label, direction, tier, strength

**New report sections:**
1. Signals that clear 58% - Only winners shown first
2. How winners perform by market condition - Shows if signal works when aligned vs against market bias
3. Volume confirmation on winners - Does volume matter for the winners?
4. Trend condition on winners - Works better with or against trend?
5. Below 58% reference - Candidates for future improvement

**Why this matters:** Now you can see the exact conditions each signal needs to hit 58%.
