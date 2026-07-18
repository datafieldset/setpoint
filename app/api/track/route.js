// app/api/track/route.js
//
// Logs a live signal the moment it genuinely fires (not on every refresh,
// the client only calls this once per new firing, reusing the same cooldown
// dedup already built into page.jsx). This is the raw data the scoreboard
// reads: what actually happened, not another backtest replay.

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
    await sql`
      INSERT INTO signal_track (coin, tf, label, dir, fired_at, entry, stop, target)
      VALUES (${coin}, ${tf}, ${label}, ${dir}, ${firedAt ? new Date(firedAt) : new Date()}, ${entry}, ${stop}, ${target})
    `;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e).slice(0, 200) }, { status: 500 });
  }
}
