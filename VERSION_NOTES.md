# Setpoint v4.5

## Dedicated close-alert endpoint, no cron needed

Open positions were only resolving as a side effect of visiting a specific panel, meaning a trade could sit stale for 12+ hours (confirmed in v4.4's resolved-positions lookup) until someone happened to load it.

Pulled resolution out into its own endpoint, /api/close-alert. It's now called on every cycle of the main dashboard's existing 60-second refresh, the one that already runs continuously whenever the dashboard is open, regardless of how often new alerts happen to fire. No Vercel cron job needed, this rides on traffic the app already generates.

/api/open-positions goes back to being a simple, fast read, resolving is no longer its job. Single responsibility: close-alert checks and closes, open-positions just shows what's still open.

This shrinks the worst-case staleness from "however long until someone visits a specific page" down to "up to 60 seconds, as long as the dashboard tab is open somewhere."
