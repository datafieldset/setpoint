// app/api/public-stats/route.js
//
// Genuinely public, no password, no login, nothing. That's the whole
// point: this feeds the Watch Live page, and the entire premise of that
// page is "don't take our word for it," which only means something if
// anyone can check it without an account.
//
// The headline number is the real, live win rate across setups that are
// actually verified (58%+, same bar used everywhere else in this app),
// since that's the honest answer to "how good is Setpoint," not a number
// blended together with setups still being tested that were never
// promoted to customers in the first place. The feed below still shows
// every resolved trade, verified and testing both, wins and losses both,
// nothing hidden, each one tagged so it's clear which is which. Real
// transparency means showing everything, it doesn't mean pretending two
// different things are the same thing.
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
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, testingTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`
      SELECT coin, tf, label, dir, outcome, fired_at, resolved_at
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
      ORDER BY resolved_at DESC
    `;

    let verifiedWins = 0, verifiedLosses = 0, testingWins = 0, testingLosses = 0;
    const tagged = rows.map((r) => {
      const verified = isVerified(r.label, r.tf, r.dir);
      if (verified) { r.outcome === "win" ? verifiedWins++ : verifiedLosses++; }
      else { r.outcome === "win" ? testingWins++ : testingLosses++; }
      return {
        coin: r.coin,
        tf: r.tf,
        name: brandName(r.label),
        dir: r.dir,
        outcome: r.outcome,
        verified,
        resolvedAt: r.resolved_at,
      };
    });

    const verifiedTotal = verifiedWins + verifiedLosses;
    const testingTotal = testingWins + testingLosses;
    const verifiedWinRate = verifiedTotal > 0 ? verifiedWins / verifiedTotal : null;
    const testingWinRate = testingTotal > 0 ? testingWins / testingTotal : null;

    return Response.json({
      verifiedWinRate, verifiedTotal, verifiedWins, verifiedLosses,
      testingWinRate, testingTotal,
      recent: tagged.slice(0, 50),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, testingTotal: 0, recent: [], error: String(e.message || e).slice(0, 150) }, { headers: { "cache-control": "no-store" } });
  }
}
