// lib/schema.js
//
// The ONE definition of the signal_track table (every signal's trades,
// open and closed) and everything it needs: the table, the columns added
// later, and the unique indexes that stop duplicate open trades. Every
// route and cron that reads or writes signal_track calls
// ensureSignalTrack() instead of carrying its own CREATE TABLE, so the
// copies can never drift apart again. Runs once per server instance.
//
// What a row means:
//   outcome   'open', then 'win' or 'loss' once it ends
//   target    NULL for a trailing-stop trade (Trend Rider): there is no
//             fixed target, the stop follows price. Fixed-target trades
//             always have one.
//   risk      the opening stop distance (R). Used for trailing trades.
//   exit_price / r   where the trade ended and its result in R. Fixed
//             trades are 2:1, so r is +2 or -1. Older rows have NULL and
//             lib/results.js fills in the same +2 / -1.
//   bar_time  the candle a server-detected trade belongs to, so one
//             touch of a level is only ever recorded once.
//   meta      anything only one signal needs (JSON), kept out of the
//             shared columns. Trend Rider keeps its extreme price, how
//             far its stop has been checked, and the market context.
let ready = false;

export async function ensureSignalTrack(sql) {
  if (ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS signal_track (
      id SERIAL PRIMARY KEY,
      coin TEXT NOT NULL,
      tf TEXT NOT NULL,
      label TEXT NOT NULL,
      dir TEXT NOT NULL,
      fired_at TIMESTAMPTZ NOT NULL,
      entry NUMERIC NOT NULL,
      stop NUMERIC NOT NULL,
      target NUMERIC,
      outcome TEXT NOT NULL DEFAULT 'open',
      resolved_at TIMESTAMPTZ
    )
  `;
  await sql`ALTER TABLE signal_track ALTER COLUMN target DROP NOT NULL`;
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS regime TEXT`;
  // Whether the trade counted as verified at the moment it fired. NULL
  // means it was logged before this existed, or the check couldn't run,
  // and readers fall back to today's status for those.
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS verified_at_fire BOOLEAN`;
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS risk NUMERIC`;
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS exit_price NUMERIC`;
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS r NUMERIC`;
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS bar_time BIGINT`;
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS meta JSONB`;
  // Only one open trade per coin, timeframe, signal and direction at a
  // time, enforced by Postgres itself (a browser tab and the cron can
  // never both log the same fire). Once a trade ends, a new one may open.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS signal_track_open_unique
    ON signal_track (coin, tf, label, dir)
    WHERE outcome = 'open'
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS signal_track_one_per_bar
    ON signal_track (coin, tf, label, dir, bar_time)
    WHERE bar_time IS NOT NULL
  `;
  ready = true;
}
