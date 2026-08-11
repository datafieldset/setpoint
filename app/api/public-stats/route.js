// app/api/public-stats/route.js
//
// Genuinely public, no password, no login, nothing. That's the whole
// point: this feeds the Watch Live page, and the entire premise of that
// page is "don't take our word for it," which only means something if
// anyone can check it without an account.
//
// Returns every resolved trade, wins and losses both, real percentages
// only, computed fresh from signal_track every time. Deliberately not
// filtered to only currently-verified signal types, hiding the ones that
// didn't work would be exactly the kind of thing this page exists to
// not do.
import { brandName } from "../../../lib/brand.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ totalResolved: 0, wins: 0, losses: 0, winRate: null, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`
      SELECT coin, tf, label, dir, outcome, fired_at, resolved_at
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
      ORDER BY resolved_at DESC
      LIMIT 50
    `;
    // Totals computed from the full table, not just the 50 shown, the
    // headline number should reflect everything, not just the recent feed.
    const totals = await sql`
      SELECT outcome, COUNT(*)::int AS n
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
      GROUP BY outcome
    `;
    const wins = totals.find((t) => t.outcome === "win")?.n || 0;
    const losses = totals.find((t) => t.outcome === "loss")?.n || 0;
    const totalResolved = wins + losses;
    const winRate = totalResolved > 0 ? wins / totalResolved : null;

    const recent = rows.map((r) => ({
      coin: r.coin,
      tf: r.tf,
      name: brandName(r.label),
      dir: r.dir,
      outcome: r.outcome,
      firedAt: r.fired_at,
      resolvedAt: r.resolved_at,
    }));

    return Response.json({ totalResolved, wins, losses, winRate, recent }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ totalResolved: 0, wins: 0, losses: 0, winRate: null, recent: [], error: String(e.message || e).slice(0, 150) }, { headers: { "cache-control": "no-store" } });
  }
}
