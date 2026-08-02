# Setpoint v6.2

Everything folded into one release, v6.1 (Volume spike short gate) was never pushed separately.

## Volume spike short: timeframe-aware trend gate (carried from v6.1)
15m/1h short only fire when not riding with the trend, 30m only fires when it is, 5m stays ungated. See v6.1 notes for the full data breakdown.

## Confluence flag — proven signal + extreme meter reading, together

When a proven (58%+) signal fires on a coin whose lean meter is independently sitting at a genuine extreme, in the matching direction, that card now gets a distinct amber glow and an "⚡ extreme read" tag, and gets pulled to the top of Opportunities regardless of strength score. Proven-only by design, an unproven signal getting the same visual weight would teach trusting the flag itself instead of the underlying data.

## In-app Guide, gated to signed-in accounts

A new "GUIDE" button next to your plan badge opens a plain-English explainer covering proven alerts, the lean meter, and the news read, right inside the dashboard, with a back button to return. The proven-alerts list is generated live from the real SIGNAL_RATES table on every render, not hardcoded, so it can never drift out of sync as signals get tuned. Only reachable from inside the authenticated dashboard, so it's automatically limited to signed-in accounts.

## Real bug caught before shipping

While inserting the Guide component, an editing mistake deleted the actual `function Dashboard(...)` declaration line. Caught immediately with the real JSX parser (the process fix from v5.9), not left for the next build to fail on. Fixed and reverified before packaging.
