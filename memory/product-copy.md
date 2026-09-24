# Product copy — voice in practice

Real, direct examples of the house voice actually applied (see writing-style.md for the general rule). Pull fresh examples from the live code before writing new copy — these can drift.

## Real, working examples from the live product
- Empty state: "Nothing to watch on {timeframe} yet"
- Open position: "Fired and still open, tracking toward target or stop."
- Verified/unverified framing, always a real sentence, never a bare number: "right about 63% of the time, currently live for real customers" vs "right about 45% of the time, real, current record, not currently shown to customers" — the second half of that sentence is doing real work: it tells a viewer *why* a percentage exists without a "verified" badge next to it, rather than just hiding the number.
- Condition breakdowns translated into full sentences, never raw keys (`Trend:against`, `Bias:with` never shown as-is): "93% right when the broader market is leaning the other way (29 right out of 31)." — built via `translateCondition()` in `SignalCatalog`.
- Market Meter scope note: "A short-term, 5m read. Can genuinely differ from the day's overall move, both are real, they're just answering different questions." — the house pattern for flagging a real, honest limitation without undermining trust in the number itself.
- Disclaimer footer: "Informational alerts only. Setpoint does not execute trades or provide financial advice. Levels are computed reference points (1.5x ATR stop, 2R target), not recommendations."

## Standing copy rules
- Never claim "verified" without it being true *right now* — verification is a live status (see lessons-learned.md), and copy must never imply permanence ("this signal works") where the honest claim is conditional ("this signal is currently earning it, here's the real number behind that").
- Every stat gets a plain-English sentence, not a bare number or a raw condition key — a viewer should never need to read the source code to understand what a panel is telling them (this was directly, repeatedly flagged by Na as the single biggest recurring copy failure — see the Market Meter panel discussion).
- Brand names (Snapback/Surge/Rebound etc., see `lib/brand.js`) are the only names a real customer ever sees; internal names (RSI oversold/Volume spike/Reversal watch) are dev/admin-only vocabulary. Any admin tool should show both together to avoid the confusion this caused directly (see lessons-learned.md).
- Comments in the codebase itself follow the same real, direct, dated, evidence-citing voice as customer copy ("real, direct promotion (Sep 21): 63% on X real fires...") — this is a deliberate, standing convention, not incidental. New comments explaining a promotion/kill/fix should keep this pattern: what changed, the real, dated evidence, in plain language.
