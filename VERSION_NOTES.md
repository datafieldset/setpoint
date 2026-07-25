# Setpoint v4.4

## Resolved positions lookup — real proof on a specific trade

Aggregate win/loss counts shifting in the Live scoreboard proves something resolved, not that any ONE specific position resolved correctly. New route reads signal_track directly for whatever's already resolved (win or loss), showing entry, stop, target, when it fired, when it actually resolved, and how many hours it sat open.

Visit /api/resolved-positions in a browser (no password) to see the most recent 50 across all coins, or /api/resolved-positions?coin=SOL to filter to just SOL. This is how to check whether a specific trade you watched sitting past its stop actually resolved to the correct outcome, not just whether the aggregate numbers moved somewhere.
