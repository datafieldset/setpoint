// app/api/public-stats/route.js
//
// Genuinely public, no password, no login. This page's entire premise is
// "check it yourself", which only works if anyone can hit this endpoint
// without an account.
//
// Real, direct redesign (Sep 21): the previous version counted a
// signal's ENTIRE, all-time history the moment it counted as verified
// at all, static promotion or the newer, dynamic regime-only path.
// That let one strong, recent stretch get diluted by months of older
// trades from before the signal was ever actually earning it, or by a
// condition-specific slice that only performs well in the current
// market, dragging the headline number down in a way that didn't
// honestly reflect what's happening right now. Real, direct fix: only
// count signals with a genuine, static, deliberate promotion behind
// them (SIGNAL_RATES, not the dynamic regime path, which is built for
// live, internal decision-making, not a stable, public number), and
// for each one, only its own real, most-recent 20 trades, the same
// rolling window every other real surface already uses to decide
// "is this currently earning it." A signal that's promoted but
// currently failing pulls the number down immediately; one that just
// started earning a real promotion only ever contributes its own
// genuine, recent record, never stale history from before it existed.
import { brandName } from "../../../lib/brand.js";
import { SIGNAL_RATES, PROVEN_THRESHOLD, LIVE_GATE_WINDOW } from "../../../lib/signals.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });

    const promoted = Object.entries(SIGNAL_RATES)
      .filter(([, v]) => v.rate != null && v.rate >= PROVEN_THRESHOLD)
      .map(([key]) => {
        const [label, tf, dir] = key.split("|");
        return { label, tf, dir };
      });
    const labels = [...new Set(promoted.map((p) => p.label))];
    if (labels.length === 0) {
      return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
    }

    const rows = await sql`
      SELECT coin, tf, label, dir, outcome, entry, stop, target, fired_at, resolved_at
      FROM signal_track
      WHERE outcome IN ('win', 'loss') AND label = ANY(${labels})
      ORDER BY resolved_at DESC
    `;

    let wins = 0, losses = 0;
    const recent = [];
    const seenPerCombo = {};
    for (const r of rows) {
      const isPromoted = promoted.some((p) => p.label === r.label && p.tf === r.tf && p.dir === r.dir);
      if (!isPromoted) continue;
      const comboKey = `${r.label}|${r.tf}|${r.dir}`;
      seenPerCombo[comboKey] = (seenPerCombo[comboKey] || 0) + 1;
      if (seenPerCombo[comboKey] > LIVE_GATE_WINDOW) continue; // only this signal's own, real, most-recent 20

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
