// app/api/public-stats/route.js
//
// Genuinely public, no password, no login. This page's entire premise is
// "check it yourself", which only works if anyone can hit this endpoint
// without an account.
//
// Only ever returns trades from currently-verified (58%+) signals, the 7
// setups actually sold to customers. A visitor here is checking Setpoint
// the product, not the whole engine, testing-tier signals were never
// promoted to anyone and don't belong in a page proving what customers
// actually get.
//
// Every trade includes its locked entry/stop/target, exactly as they
// were the moment it fired, that's the actual proof behind "we don't
// redraw", a visitor can check every one of these against their own
// chart. The exit price is never a separate, editable field, it's always
// exactly the target (on a win) or the stop (on a loss), the same two
// numbers that were locked in from the start.
import { brandName } from "../../../lib/brand.js";
import { SIGNAL_RATES, PROVEN_THRESHOLD } from "../../../lib/signals.js";

export const dynamic = "force-dynamic";

function isVerified(label, tf, dir) {
  const entry = SIGNAL_RATES[`${label}|${tf}|${dir}`];
  return entry?.rate != null && entry.rate >= PROVEN_THRESHOLD;
}

export async function GET() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`
      SELECT coin, tf, label, dir, outcome, entry, stop, target, fired_at, resolved_at
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
      ORDER BY resolved_at DESC
    `;

    let wins = 0, losses = 0;
    const recent = [];
    for (const r of rows) {
      if (!isVerified(r.label, r.tf, r.dir)) continue; // testing-tier, never shown here
      r.outcome === "win" ? wins++ : losses++;
      const entry = parseFloat(r.entry);
      const exit = r.outcome === "win" ? parseFloat(r.target) : parseFloat(r.stop);
      const pctMove = r.dir === "bull" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
      if (recent.length < 40) {
        recent.push({
          coin: r.coin,
          tf: r.tf,
          name: brandName(r.label),
          dir: r.dir,
          outcome: r.outcome,
          entry, exit,
          pctMove,
          firedAt: r.fired_at,
          resolvedAt: r.resolved_at,
        });
      }
    }

    const verifiedTotal = wins + losses;
    const verifiedWinRate = verifiedTotal > 0 ? wins / verifiedTotal : null;

    return Response.json({ verifiedWinRate, verifiedTotal, wins, losses, recent }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [], error: String(e.message || e).slice(0, 150) }, { headers: { "cache-control": "no-store" } });
  }
}
