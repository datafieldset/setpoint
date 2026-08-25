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
//
// Requires ?key=<the shared password>, called only by this app's own
// client-side fetch, see lib/access.js.
//
// This route only reads. Resolving trades against real price is a
// separate concern, handled by /api/close-alert, called on its own
// schedule from the main dashboard refresh and a GitHub Actions cron.
// Keeping this route to just a read means it stays fast regardless of
// how many open positions exist or how many Coinbase calls resolving
// them would take.
//
// signal_track never stored tier/win-rate at fire time, only the raw
// trade (coin, tf, label, dir, entry, stop, target). That's fine, tier is
// a pure lookup by label+timeframe+direction against the current
// SIGNAL_RATES table, so it's looked up fresh here instead, which also
// means it reflects the latest table data, not a stale snapshot from
// whenever the alert originally fired.
//
// Also returns a real, small "recently resolved" list (Aug 25) — a real
// position that leaves Open Alerts used to just vanish with no trace, if
// someone hadn't checked recently enough to catch it resolving live, it
// looked like it disappeared for no reason. This gives real, honest
// closure either way, win or loss, the next time the dashboard loads.
import { provenContext } from "../../../lib/signals.js";
import { checkKey } from "../../../lib/access.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const authFail = checkKey(req);
  if (authFail) return authFail;

  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ positions: [], recentlyResolved: [] }, { headers: noCache });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const [rows, resolvedRows] = await Promise.all([
      sql`
        SELECT coin, tf, label, dir, fired_at, entry, stop, target
        FROM signal_track
        WHERE outcome = 'open'
        ORDER BY fired_at DESC
        LIMIT 100
      `,
      sql`
        SELECT coin, tf, label, dir, fired_at, resolved_at, entry, stop, target, outcome
        FROM signal_track
        WHERE outcome IN ('win', 'loss')
        ORDER BY resolved_at DESC
        LIMIT 30
      `,
    ]);
    const positions = rows.map((r) => {
      const pc = provenContext(r.label, r.tf, r.dir);
      return {
        coin: r.coin,
        tf: r.tf,
        label: r.label,
        dir: r.dir,
        firedAt: new Date(r.fired_at).getTime(),
        entry: parseFloat(r.entry),
        stop: parseFloat(r.stop),
        target: parseFloat(r.target),
        tier: pc.tag,
        tierRate: pc.rate,
      };
    });
    const recentlyResolved = resolvedRows.map((r) => {
      const pc = provenContext(r.label, r.tf, r.dir);
      const entry = parseFloat(r.entry);
      const exit = r.outcome === "win" ? parseFloat(r.target) : parseFloat(r.stop);
      const pctMove = r.dir === "bull" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
      return {
        coin: r.coin,
        tf: r.tf,
        label: r.label,
        dir: r.dir,
        outcome: r.outcome,
        firedAt: new Date(r.fired_at).getTime(),
        resolvedAt: new Date(r.resolved_at).getTime(),
        entry, exit, pctMove,
        tier: pc.tag,
        tierRate: pc.rate,
      };
    });
    return Response.json({ positions, recentlyResolved, generatedAt: new Date().toISOString(), dbRowCount: rows.length }, { headers: noCache });
  } catch (e) {
    return Response.json({ positions: [], recentlyResolved: [], error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
