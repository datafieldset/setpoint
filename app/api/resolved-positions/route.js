// app/api/resolved-positions/route.js
//
// Shows exactly what a specific fired signal actually resolved to, and
// when, straight from signal_track. Built because aggregate win/loss
// counts shifting elsewhere isn't proof that any ONE specific position
// resolved correctly, only that something did. This lets a specific
// trade (matched by coin, timeframe, label, direction, entry/stop/target)
// be looked up directly against its real outcome and timestamps.
export const dynamic = "force-dynamic";

export async function GET(req) {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ resolved: [] }, { headers: noCache });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    const { searchParams } = new URL(req.url);
    const coin = searchParams.get("coin");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200);

    const rows = coin
      ? await sql`
          SELECT coin, tf, label, dir, fired_at, resolved_at, entry, stop, target, outcome
          FROM signal_track
          WHERE outcome IN ('win', 'loss') AND coin = ${coin}
          ORDER BY resolved_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT coin, tf, label, dir, fired_at, resolved_at, entry, stop, target, outcome
          FROM signal_track
          WHERE outcome IN ('win', 'loss')
          ORDER BY resolved_at DESC
          LIMIT ${limit}
        `;

    const resolved = rows.map((r) => ({
      coin: r.coin,
      tf: r.tf,
      label: r.label,
      dir: r.dir,
      firedAt: new Date(r.fired_at).getTime(),
      resolvedAt: new Date(r.resolved_at).getTime(),
      hoursOpen: Math.round(((new Date(r.resolved_at).getTime() - new Date(r.fired_at).getTime()) / 3600000) * 10) / 10,
      entry: parseFloat(r.entry),
      stop: parseFloat(r.stop),
      target: parseFloat(r.target),
      outcome: r.outcome,
    }));

    return Response.json({ resolved }, { headers: noCache });
  } catch (e) {
    return Response.json({ resolved: [], error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
