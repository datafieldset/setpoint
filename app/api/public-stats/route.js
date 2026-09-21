// app/api/public-stats/route.js
//
// Genuinely public, no password, no login. This page's entire premise is
// "check it yourself", which only works if anyone can hit this endpoint
// without an account.
//
// Only ever returns trades from signals that are BOTH statically
// verified AND currently clearing 58% on their real recent-20 trades
// (or a real, regime-specific record, gated the exact same way), the
// same live gate the customer dashboard itself uses. This page used to
// check only the static table, a real, found inconsistency (Aug 19):
// the dashboard could quietly stop showing a drifted signal as an
// active alert while this page kept counting its trades toward the
// headline number regardless, two surfaces of the same product
// disagreeing about what "verified" currently means. Fixed to share
// the exact same check.
//
// Real, second, deeper fix (Sep 21): the shared check above was itself
// a separate, hand-rolled copy, not the actual, real provenContext
// every other real surface now uses, and it never had any regime
// awareness at all. Found after a real, direct audit showed this
// page's own headline number counting a trade under "Climb", a signal
// name retired and renamed to Grind Up long ago — old, stale history
// with no current, matching entry anywhere, still dragging the real,
// public number down. Now calls the same, single, shared function
// everything else does, so a name with no real, current entry
// correctly stops counting on its own, nothing to remember to exclude
// by hand.
//
// Every trade includes its locked entry/stop/target, exactly as they
// were the moment it fired, that's the actual proof behind "we don't
// redraw", a visitor can check every one of these against their own
// chart. The exit price is never a separate, editable field, it's always
// exactly the target (on a win) or the stop (on a loss), the same two
// numbers that were locked in from the start.
import { brandName } from "../../../lib/brand.js";
import { getLiveVerifiedGate, provenContext } from "../../../lib/signals.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const [rows, liveGateResult] = await Promise.all([
      sql`
        SELECT coin, tf, label, dir, outcome, entry, stop, target, fired_at, resolved_at, regime
        FROM signal_track
        WHERE outcome IN ('win', 'loss')
        ORDER BY resolved_at DESC
      `,
      getLiveVerifiedGate(),
    ]);
    const { gate: liveGate, regimeGate } = liveGateResult;

    let wins = 0, losses = 0;
    const recent = [];
    for (const r of rows) {
      if (provenContext(r.label, r.tf, r.dir, liveGate, r.regime, regimeGate).tag !== "proven") continue; // testing-tier, currently underperforming, or a stale/renamed signal name with no current, matching entry — never shown here
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
