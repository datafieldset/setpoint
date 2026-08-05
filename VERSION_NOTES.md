# Setpoint v6.9

## RSI overbought: volume gate on 30m, full removal on 15m and 1h

Aug 5's backtest showed the 64% winner on 30m was being dragged down by one specific condition, volume showing as "confirmed" only hit 30%, while every other volume state was 75-100%. Gated that one condition out on 30m, real number underneath should be closer to 75-80%.

15m and 1h removed from live firing entirely, both consistently weak (33-35%) with no condition split that redeems either one. 5m untouched, already removed in v5.4. Tested all 6 real cases directly before shipping.

## Whale flow: made the scrape resilient, and made staleness impossible to miss

Real fix instead of a diagnostic: the parser used to depend on matching one exact string in Telegram's page markup, if that string ever changed, everything broke completely and silently, which is exactly what happened, both the live panel and the backtest tracking went a full week without a single new transfer, unnoticed. Now tries three real, known patterns from Telegram's own public widget markup in order, the first one that actually finds real messages wins, instead of depending on one string staying exactly the same forever.

Also fixed the actual "empty fields" you saw directly: when there's no whale data, the panel used to just silently vanish, easy to mistake for a bug. Now it always shows something, either the real data, or a plain explanation that nothing's come through right now. And both the live panel and the backtest page now automatically flag it in red if nothing new has come in for more than 48 hours, no button to press, no test to run, it just says so.

No new signups, no new services, no testing required, this is a durable fix to the actual mechanism, not another diagnostic asking for a click.
