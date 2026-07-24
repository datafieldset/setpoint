# Setpoint v4.2

## Open Positions was never resolving on its own

Real bug: the Open Positions panel only ever read the database, it never checked real price itself. Resolution only ran when someone visited the password-protected backtest research page. That meant a position could blow straight through its stop and just sit there marked "open" for hours or days until someone happened to visit that internal page, exactly what showed up: an XLM long sitting open with live price already well below its stop.

Fixed by giving this route its own resolve step, run before every response, same logic used elsewhere (real price, real target/stop check, real 1-minute drill-down for the rare ambiguous case). The page paying members are actually watching now keeps itself current on every poll, no longer depends on an internal page getting visited.

Verified the fix with a synthetic scenario (price sitting safely between stop and target in older history, breaking down past stop in recent candles) before shipping, resolves correctly to a loss.
