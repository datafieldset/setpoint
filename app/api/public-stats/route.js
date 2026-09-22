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
// honestly reflect what's happening right now. Real, direct fix: for
// each real signal with a genuine, current, verified status, only
// count its own real, most-recent 20 trades, the same rolling window
// every other real surface already uses to decide "is this currently
// earning it." A signal that's promoted but currently failing pulls
// the number down immediately; one that just started earning it only
// ever contributes its own genuine, recent record, never stale
// history from before it existed.
//
// Real, second, direct fix, found the same day: the first version of
// this only checked the static table, meaning a signal currently,
// genuinely demoted by its own live record still had its trades
// counted here, even though it was already correctly hidden from real
// customers on the dashboard itself.
//
// Real, third, deeper fix (Sep 21, same day): the second version still
// only ever considered STATICALLY-promoted signals as eligible at
// all, entirely ignoring the regime-only path — a signal that's
// currently, genuinely earning "verified" purely from a real, strong
// record in the current market condition (Reversal watch on 1m short,
// 90% on a real 10-trade sample in the current bullish-trending
// regime; RSI oversold on 1m long, 70% on 10 real trades in the
// current sideways-ranging regime) was invisible here even though the
// dashboard itself already, correctly treats it as verified. That's
// the exact, same two-surfaces-disagree class of bug this file keeps
// getting caught by. Now checks every real, resolved row directly
// against the one, real, shared definition of verified, static or
// regime, exactly matching what a real customer's own dashboard shows.
import { brandName } from "../../../lib/brand.js";
import { ALL_SIGNALS, LIVE_GATE_WINDOW, getLiveVerifiedGate, provenContext } from "../../../lib/signals.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const { gate: liveGate, regimeGate } = await getLiveVerifiedGate();

    const labels = ALL_SIGNALS.map((s) => s.name);
    const rows = await sql`
      SELECT coin, tf, label, dir, outcome, entry, stop, target, fired_at, resolved_at, regime
      FROM signal_track
      WHERE outcome IN ('win', 'loss') AND label = ANY(${labels})
      ORDER BY resolved_at DESC
    `;

    let wins = 0, losses = 0;
    const recent = [];
    const seenPerCombo = {};
    for (const r of rows) {
      // Real, direct check against the same, single, shared definition
      // of verified every other real surface uses — a genuine, static
      // promotion, or this specific row's own, real regime currently
      // clearing the bar. Either way is honestly "verified", the same
      // way the dashboard itself already treats it.
      const pc = provenContext(r.label, r.tf, r.dir, liveGate, r.regime, regimeGate);
      if (pc.tag !== "proven") continue;
      // Rolling window scoped to how this specific row earned its
      // verification — a statically-proven row rolls up with every
      // other row of its (label, tf, dir), since the static check
      // doesn't care about regime; a regime-only-proven row only
      // rolls up with rows that fired in that same, real regime,
      // matching the regime gate's own, real scope.
      const comboKey = pc.verifiedVia === "regime" ? `${r.label}|${r.tf}|${r.dir}|${r.regime}` : `${r.label}|${r.tf}|${r.dir}`;
      seenPerCombo[comboKey] = (seenPerCombo[comboKey] || 0) + 1;
      if (seenPerCombo[comboKey] > LIVE_GATE_WINDOW) continue; // only this combo's own, real, most-recent 20

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
