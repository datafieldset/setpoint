# Setpoint v5.0

## The real root cause of the 84 open positions: no server-side dedup, fixed properly

Full audit found it: the only protection against logging the same signal twice lived in browser memory (page.jsx's `fired` ref), which resets to empty on every page refresh. Any signal still genuinely active at the exact moment of a refresh got logged again as if it just fired, creating duplicate open rows for what was really one continuous trade.

**Fixed with a real database constraint**, the same pattern whale_track already proved correct elsewhere in this app: a partial unique index on signal_track, only one 'open' row allowed per (coin, timeframe, label, direction) combination at a time, enforced by Postgres itself. Once a trade resolves, the same combo is free to fire again later as a genuinely new trade.

## Before this deploys: a one-time cleanup is required

The new unique index can't be created while duplicate open rows already exist in the table. Run this in Neon's SQL Editor BEFORE pushing this version:

```sql
-- Optional: see the scope first
SELECT coin, tf, label, dir, COUNT(*) as dupes
FROM signal_track
WHERE outcome = 'open'
GROUP BY coin, tf, label, dir
HAVING COUNT(*) > 1
ORDER BY dupes DESC;

-- The actual cleanup: keeps only the earliest row per duplicate group, removes the rest
DELETE FROM signal_track a
USING signal_track b
WHERE a.outcome = 'open' AND b.outcome = 'open'
  AND a.coin = b.coin AND a.tf = b.tf AND a.label = b.label AND a.dir = b.dir
  AND a.id > b.id;
```

After that runs clean, push this version. Every future refresh-while-active will simply be silently ignored at the database level instead of creating a duplicate.

## Also fixed: the minor duplication

market/route.js had its own separate copy of the candle-aggregation function, now imports the shared one from lib/resolve.js. Found and fixed a real discrepancy in the process: the shared version was missing volume summing and a final time-sort, both of which matter for the live dashboard's volume-based signals. Fixed the shared version to be the complete, correct one before wiring market/route.js to it, rather than silently downgrading it.
