# Setpoint v4.1

## Whale flow direction panel actually creates its own table now

The download route already had table-creation + logging/resolving built in, but the main /api/backtest page's own whale panel never got the same fix, it just queried whale_track directly and failed with "relation does not exist" whenever the download hadn't been visited first. Now visiting the main page alone is enough, same setup as the download route.
