# Setpoint v5.8

## Volatility meter: real numbers, not just a dot

Added a signed scale under the meter track, -50 to +50, 0 in the middle, matching what Na asked for. The current lean now also shows as an actual number next to the label, "Leaning low -18" instead of just a dot position with no way to gauge how far it's actually leaning.

Re-verified the direction/color pairing is genuinely correct after v5.7's fix: a low score sits on the left, the left side is now red, confirmed with a direct math check, not just re-reading the code. If it still looks backwards once this is live, that's a real, different issue worth digging into properly, not the same one again.

Also cleaned up a leftover dead CSS class (.tk-meter-fill) found while making this change, unused since the meter was first built.
