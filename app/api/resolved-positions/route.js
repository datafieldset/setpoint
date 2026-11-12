// app/api/resolved-positions/route.js
//
// Shows exactly what a specific fired signal actually resolved to, and
// when, straight from signal_track. Built because aggregate win/loss
// counts shifting elsewhere isn't proof that any ONE specific position
// resolved correctly, only that something did. This lets a specific
// trade (matched by coin, timeframe, label, direction, entry/stop/target)
// be looked up directly against its real outcome and timestamps.
import { QUIET_LOG } from "../../../lib/quietLog.js";
import { isSignalVisible, focusSql, RETIRED_SIGNALS } from "../../../lib/signals.js";
import { checkKey } from "../../../lib/access.js";
import { resultR, exitPrice } from "../../../lib/results.js";
import { ensureSignalTrack } from "../../../lib/schema.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const authFail = checkKey(req);
  if (authFail) return authFail;
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ resolved: [] }, { headers: noCache });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await ensureSignalTrack(sql);
    const { searchParams } = new URL(req.url);
    const coin = searchParams.get("coin");
    // v22.0 (Nov 7, Na: "our data should be centralized so you can access it from one location"): the whole resolved history is readable
    // through this one route (read-only, behind the same ?key=). limit up to 5000, ?before=<ms> pages backward by resolved time,
    // ?since=<ms> stops early, ?label= narrows to one signal. Default is still the latest 50. scripts/pull-trades.mjs pages through it.
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 5000);
    const before = Number(searchParams.get("before")) || null;
    const since = Number(searchParams.get("since")) || null;
    const onlyLabel = searchParams.get("label") || null;
    // v22.2: ?include=quiet adds the quietly logged background signals (lib/quietLog.js) for analysis. Same key, still never shown to customers.
    // v23.4: the same switch also returns retired public tests (Trend Rider, Rebound Rider), so the full history stays readable for analysis.
    const quietLabels = searchParams.get("include") === "quiet" ? [...new Set([...QUIET_LOG.map((q) => q.label), ...RETIRED_SIGNALS])] : [];

    const { noFocus, focusLabels } = focusSql;
    const rows = await sql`
      SELECT coin, tf, label, dir, fired_at, resolved_at, entry, stop, target, exit_price, r, outcome, meta
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
        AND (${coin}::text IS NULL OR coin = ${coin})
        AND (${onlyLabel}::text IS NULL OR label = ${onlyLabel})
        AND (${before}::bigint IS NULL OR resolved_at < to_timestamp(${before}::double precision / 1000))
        AND (${since}::bigint IS NULL OR resolved_at >= to_timestamp(${since}::double precision / 1000))
        AND (${noFocus} OR label = ANY(${focusLabels}) OR label = ANY(${quietLabels}))
      ORDER BY resolved_at DESC
      LIMIT ${limit}
    `;

    const resolved = rows.filter((r) => isSignalVisible(r.label) || quietLabels.includes(r.label)).map((r) => ({
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
      exit: exitPrice(r),
      r: resultR(r),
      outcome: r.outcome,
      shadow: r.meta?.shadow ?? null, // Rebound Rider's logged falling-knife guard (v21.4)
      box: r.meta?.box ?? null, // 48 hour market range in percent, 15m Trend Rider only (v22.5)
    }));

    return Response.json({ resolved }, { headers: noCache });
  } catch (e) {
    return Response.json({ resolved: [], error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
