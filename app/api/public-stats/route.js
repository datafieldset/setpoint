// app/api/public-stats/route.js
//
// Genuinely public, no password, no login. This page's entire premise is
// "check it yourself", which only works if anyone can hit this endpoint
// without an account.
//
// Only ever returns trades from signals that are BOTH statically
// verified AND currently clearing 58% on their real recent-20 trades,
// the same live gate the customer dashboard itself uses (v9.8). This
// page used to check only the static table, a real, found inconsistency
// (Aug 19): the dashboard could quietly stop showing a drifted signal as
// an active alert while this page kept counting its trades toward the
// headline number regardless, two surfaces of the same product
// disagreeing about what "verified" currently means. Fixed to share the
// exact same check.
//
// Every trade includes its locked entry/stop/target, exactly as they
// were the moment it fired, that's the actual proof behind "we don't
// redraw", a visitor can check every one of these against their own
// chart. The exit price is never a separate, editable field, it's always
// exactly the target (on a win) or the stop (on a loss), the same two
// numbers that were locked in from the start.
import { brandName } from "../../../lib/brand.js";
import { SIGNAL_RATES, PROVEN_THRESHOLD, getLiveVerifiedGate } from "../../../lib/signals.js";

export const dynamic = "force-dynamic";

function isVerified(label, tf, dir, liveGate) {
  const entry = SIGNAL_RATES[`${label}|${tf}|${dir}`];
  if (!entry?.rate || entry.rate < PROVEN_THRESHOLD) return false;
  const gate = liveGate[`${label}|${tf}|${dir}`];
  if (!gate) return true; // not enough recent data yet, trust the backtested number
  return gate.rate >= PROVEN_THRESHOLD;
}

export async function GET() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const [rows, liveGate] = await Promise.all([
      sql`
        SELECT coin, tf, label, dir, outcome, entry, stop, target, fired_at, resolved_at
        FROM signal_track
        WHERE outcome IN ('win', 'loss')
        ORDER BY resolved_at DESC
      `,
      getLiveVerifiedGate(),
    ]);

    let wins = 0, losses = 0;
    const recent = [];
    const _byLabel = {}; // temporary, real diagnostic — every resolved row, regardless of current verified status
    for (const r of rows) {
      const dKey = `${r.label}|${r.tf}|${r.dir}`;
      _byLabel[dKey] = _byLabel[dKey] || { win: 0, loss: 0 };
      _byLabel[dKey][r.outcome]++;

      if (!isVerified(r.label, r.tf, r.dir, liveGate)) continue; // testing-tier or currently underperforming, never shown here
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

    return Response.json({ verifiedWinRate, verifiedTotal, wins, losses, recent, _byLabel }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [], error: String(e.message || e).slice(0, 150) }, { headers: { "cache-control": "no-store" } });
  }
}
