# Setpoint v4.0

## Open positions now show their win-rate tag too
The Open Positions panel never showed PROVEN/TESTED tags, signal_track never stored tier at fire time, and the card-building code never looked it up either. Fixed by exporting provenContext (the same lookup live signals already use) and calling it fresh per open position based on label/timeframe/direction. Better than storing at fire time, this reflects the current SIGNAL_RATES table, not a stale snapshot from whenever the alert first fired.

## Dashboard layout fixed — Open Positions was breaking the grid
The dashboard's layout is a strict 2-column grid: left column holds Opportunities + Early signals, right column (300px) holds Market context. Adding Open Positions as its own separate block pushed everything else out of place. Fixed by making Opportunities and Open Positions two tabs within the same left-column panel instead of two separate blocks. Early signals stays below, Market context stays on the right, the original layout. No colors or fonts changed, structural fix only.
