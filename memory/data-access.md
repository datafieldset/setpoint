# Where the data lives and how a session reads it (v22.0, Nov 7, Na)

Na's rule: all data is reachable from one place, so no session ever asks him to download, paste or copy anything. A session that "can't reach the database" has missed this file.

- **Live trades (signal_track, every resolved win/loss):** `node scripts/pull-trades.mjs BTC trades-live.json` from the repo root. It pages through `GET https://setpointalerts.com/api/resolved-positions?key=<key>&coin=BTC&limit=2000&before=<ms>`. The key is the shared one in `lib/access.js` (`verified2026`). Optional params: `since=<ms>`, `before=<ms>`, `label=Trend Rider`, `limit` up to 5000. Each row has coin, tf, label, dir, firedAt, resolvedAt, entry, stop, target, exit, r, outcome and `shadow` (Rebound Rider's falling-knife guard note, v21.4 onward). Only the signals in VISIBLE_SIGNALS come back (focus mode).
- **Public numbers:** `GET /api/public-stats?coins=BTC` (rolling stats, last 60 trades, per timeframe breakdown). Fine for headline checks, not for analysis.
- **Candles for replays:** Coinbase via `/api/market?symbols=BTC&tf=1h` (what the page sees), or Binance mirror `data-api.binance.vision` for long history (reachable from the cloud session; Binance futures and Bybit are not).
- **Backtest pages:** `/api/backtest` and `/api/backtest/download` (same key, or Basic Auth user `setpoint`).
- **Not reachable from a cloud session:** the Neon database itself (DATABASE_URL lives in Vercel). Never ask Na to paste it. If a question needs a table the routes above do not expose, add a read-only field or route here, then update this file.
- **Open issue, flagged to Na:** the key is hard-coded in `lib/access.js`, so anyone who can read the repo has it. It guards read-only data and the alert-closing routes. Moving it to an environment variable is the proper fix and needs Na's yes (Vercel setting).

- **Replays on 2 years of BTC:** `node scripts/fetch-btc-history.mjs` (Binance mirror, writes BTC_5m.json and BTC_1d.json), then `node scripts/replay-background.mjs <tf>` for the original signals. Trend Rider and Rebound Rider replays use `lib/trend.js` / `lib/rebound.js` directly (see version-history v22.1 for the approach).
- **Quiet-logged background signals (v22.2):** rows in signal_track for the labels in `lib/quietLog.js`; they are hidden from every customer surface, and `scripts/pull-trades.mjs` already asks for them (`?include=quiet` on resolved-positions, same key).

- **The access key is public by design (found Nov 7):** the repo datafieldset/setpoint is PUBLIC on GitHub, and the key `verified2026` is typed into lib/access.js and used by the dashboard's own browser calls. Treat it as known to anyone. It only reads data or triggers resolving against real prices (it cannot invent a win or loss), but someone could call the routes in a loop and burn Neon compute. A real fix means separating browser routes from internal ones plus rate limits; not done, ask Na before starting.
