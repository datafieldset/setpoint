# Social posts (X / Twitter, free account)

When Na asks for "a tweet", do this. ALWAYS deliver the square card image together with the tweet text, every single time. Never send text alone. No code or site changes needed. Don't push unless he says push.

## Steps
1. Render a fresh square card: `NODE_PATH=$(npm root -g) node memory/social/render.mjs --sub "<the meter's one-liner>" --out <path>.png`
   - Numbers (price, 50-day, 200-day, 200-week, Fear & Greed, 24h move, golden cross, verdict) come live from setpointalerts.com/api/market and Coinbase.
   - `--sub` is the Market Meter sentence from the Market tab (Bitcoin is running down and still falling...). Copy it as the site shows it.
   - Output is 1080x1080 at 2x. Square so it works on X, Instagram and LinkedIn. Not 16:9, Na said that looks like a movie screen.
2. Send the PNG with SendUserFile, then the tweet text.
3. If the numbers moved a lot since last time, re-render. No timestamp on the card, the tweet has its own.

## Card rules (Na approved Oct 29)
- Big verdict word (BEARISH / BULLISH), the meter one-liner, big BTC price, then the ladder: 50-day, Bitcoin (highlighted), 200-day, 200-week, each with distance %.
- Bottom bar: golden cross on/off, Fear & Greed number, and the daily close needed to flip the 50-day.
- Small print: "Context, not advice. Never places trades." plus setpointalerts.com.
- Cut on purpose: 90-day chart, volumes, large-trade box. Those can be post 2 of a thread.
- Never put "85% of the market agrees". It sounds like a claim we can't back up. If needed: "our meter reads 85% bearish".

## Tweet format (Na's version, approved)
```
Bitcoin is $[price]. It needs a daily close above $[50-day] to flip the story. Until then, we're [bearish/bullish], [meter words].
Golden cross & 200: still on. Mood: [F&G number], [label]. Meter: [bearish/bullish].

setpointalerts.com
#Bitcoin #BTC #Crypto #CryptoMarket
```
- About 250 characters, under the 280 limit for free accounts.
- Hashtags: #Bitcoin #BTC #Crypto #CryptoMarket. Four max. More looks spammy.
- Adjust the sentences when the picture changes (price above the 50-day, golden cross off, below the 200-day, etc.). Don't leave a line that is no longer true.
- Optional clearer line: "Golden cross: still on. Still above the 200-day."

## Voice
Morning Brew: short, punchy, plain, contractions, no em dashes, a little dry humor. No financial advice, no hype, never mention fees. It's context, not a signal.

## Later ideas (not started)
- Thread: post 1 card, post 2 the 50-day price to beat, post 3 big-trade flow, post 4 the link.
- Daily Market Meter post, same card each morning.
- A Share button on the Market tab that saves the card (needs Na's OK, it's a layout change).
