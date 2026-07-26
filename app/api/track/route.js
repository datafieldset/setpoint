// app/api/track/route.js
//
// Logs a live signal the moment it genuinely fires. This is the raw data
// the scoreboard and open-positions read: what actually happened, not
// another backtest replay.
//
// Real bug found and fixed here: the ONLY dedup protection used to live
// in browser memory (page.jsx's `fired` ref), which resets on every page
// load. Any signal still genuinely active at the moment of a refresh got
// logged again as a "new" fire, creating duplicate open rows for what was
// really the same ongoing trade. Same category of problem whale_track
// already solved correctly elsewhere in this app (a real UNIQUE
// constraint), just never applied here. Fixed with a partial unique
// index: only one 'open' row allowed per (coin, tf, label, dir) at a
// time, enforced by Postgres itself, not by anything client-side. Once
// that row resolves, a genuinely new fire can create a fresh one.
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const { coin, tf, label, dir, entry, stop, target, firedAt } = body || {};
  if (!coin || !tf || !label || !dir || entry == null || stop == null || target == null) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const sql = neon(conn);
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
        target NUMERIC NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'open',
        resolved_at TIMESTAMPTZ
      )
    `;
    // Partial unique index: only enforced among rows still marked 'open',
    // so once a trade resolves, the same combo is free to fire again
    // later as a genuinely new trade.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS signal_track_open_unique
      ON signal_track (coin, tf, label, dir)
      WHERE outcome = 'open'
    `;
    const result = await sql`
      INSERT INTO signal_track (coin, tf, label, dir, fired_at, entry, stop, target)
      VALUES (${coin}, ${tf}, ${label}, ${dir}, ${firedAt ? new Date(firedAt) : new Date()}, ${entry}, ${stop}, ${target})
      ON CONFLICT (coin, tf, label, dir) WHERE outcome = 'open' DO NOTHING
      RETURNING id
    `;
    return Response.json({ ok: true, inserted: result.length > 0 });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e).slice(0, 200) }, { status: 500 });
  }
}
