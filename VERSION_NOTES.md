# Setpoint v2.8

## What's Fixed

### Download Route Tier Tracking Bug
The `/api/backtest/download` endpoint was using `s.proven` (undefined) instead of `s.tier` when recording signal data. This caused all signals to show as "Weak" in the backtest report, even:
- Signals with tier: "proven" (which should show as "Proven")
- Signals with tier: null (like Reversal watch, which should show as "Testing")

**Fix:** Changed line 105 to properly record `tier: s.tier` instead of `proven: s.proven`.

### Risk Field Label
The risk level from `reversalRisk()` was being mislabeled as "Bias" in the summary output. 

**Fix:** Changed to `risk: risk.level` and relabeled in summarize as "Rev risk" to clarify this is reversal risk, not market bias.

### Tier Categorization in Output
The summarize function now properly handles three tier states:
- `tier === "proven"` → shows as "Proven"
- `tier === "weak"` → shows as "Weak"  
- `tier === null` or undefined → shows as "Testing" (for new/unproven signals like Reversal watch)

## Result

Now when you run a backtest and download the report:
- Reversal watch signals will appear as their own type
- All signals will show their correct tier (Proven/Weak/Testing)
- Reversal risk (elevated/high) will be properly tagged in the output

This allows analysis of whether Reversal watch is actually performing as hypothesized across multiple runs.

## Next Steps

Run a clean backtest and download to confirm Reversal watch signals now appear in the report with correct tier tracking. Then analyze:
1. Do Reversal watch signals fire frequently enough to analyze?
2. Win rate on Reversal watch vs. standard signals
3. Whether reversal risk level (elevated vs high) correlates with outcome
4. Regional breakdown by market condition (trend vs bias situation when fired)
