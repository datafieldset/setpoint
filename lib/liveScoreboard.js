// lib/liveScoreboard.js
//
// The live scoreboard shown on the admin backtest report and in its
// download: real signals that fired on the live app, resolved against
// real price, with a rolling win rate per (signal, timeframe, direction).
// One copy, shared by both (they used to each carry their own, and the
// download's copy had drifted: it never filtered out retired signals).
import { ALL_SIGNALS } from "./signals.js";
import { TF } from "./timeframes.js";
import { resolveOpenTrades } from "./resolve.js";
import { ensureSignalTrack } from "./schema.js";

export const ROLLING_N = 20; // how many recent resolved outcomes count per bucket

export async function getLiveScoreboard() {
  const empty = (errors = []) => ({ buckets: [], totalTracked: 0, totalOpen: 0, resolveInfo: { checked: 0, resolved: 0, errors } });
  const conn = process.env.DATABASE_URL;
  if (!conn) return empty();
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await ensureSignalTrack(sql);
    const resolveInfo = await resolveOpenTrades(sql);
    const totalTrackedRows = await sql`SELECT COUNT(*)::int AS n FROM signal_track`;
    const totalOpenRows = await sql`SELECT COUNT(*)::int AS n FROM signal_track WHERE outcome = 'open'`;
    // Only signals that still exist: a retired signal's old, frozen
    // history would otherwise look active forever (the rolling window
    // never empties).
    const activeLabels = ALL_SIGNALS.map((s) => s.name);
    const resolvedRows = await sql`
      SELECT label, tf, dir, outcome
      FROM (
        SELECT label, tf, dir, outcome,
               ROW_NUMBER() OVER (PARTITION BY label, tf, dir ORDER BY resolved_at DESC) AS rn
        FROM signal_track
        WHERE outcome IN ('win', 'loss') AND label = ANY(${activeLabels})
      ) t
      WHERE rn <= ${ROLLING_N}
    `;
    const bucketMap = new Map();
    for (const r of resolvedRows) {
      const key = `${r.label} · ${TF[r.tf]?.label || r.tf} · ${r.dir}`;
      const b = bucketMap.get(key) || { key, n: 0, wins: 0, losses: 0 };
      b.n++;
      if (r.outcome === "win") b.wins++; else b.losses++;
      bucketMap.set(key, b);
    }
    const buckets = [...bucketMap.values()]
      .map((b) => ({ ...b, winRate: b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : null }))
      .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
    return { buckets, totalTracked: totalTrackedRows[0]?.n || 0, totalOpen: totalOpenRows[0]?.n || 0, resolveInfo };
  } catch (e) {
    return empty([String(e.message || e).slice(0, 200)]);
  }
}
