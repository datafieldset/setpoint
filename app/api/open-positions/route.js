// app/api/open-positions/route.js
//
// Returns signals that fired and are still open (haven't hit target or
// stop yet), read from signal_track. The live dashboard's Opportunities
// feed only shows conditions that are true RIGHT NOW, the moment a
// signal's trigger condition stops being true, it disappears from that
// feed even though the trade itself is still live and unresolved.
// Paying members watching a paper trade need to see it stay visible until
// it actually resolves, that's what this route and the Open positions
// panel on the dashboard are for.
export const dynamic = "force-dynamic";

export async function GET() {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ positions: [] }, { headers: noCache });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    const rows = await sql`
      SELECT coin, tf, label, dir, fired_at, entry, stop, target
      FROM signal_track
      WHERE outcome = 'open'
      ORDER BY fired_at DESC
      LIMIT 100
    `;
    const positions = rows.map((r) => ({
      coin: r.coin,
      tf: r.tf,
      label: r.label,
      dir: r.dir,
      firedAt: new Date(r.fired_at).getTime(),
      entry: parseFloat(r.entry),
      stop: parseFloat(r.stop),
      target: parseFloat(r.target),
    }));
    return Response.json({ positions }, { headers: noCache });
  } catch (e) {
    return Response.json({ positions: [], error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
