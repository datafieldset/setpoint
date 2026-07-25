// app/api/close-alert/route.js
//
// Checks every open signal against real price and closes (resolves) any
// that have actually hit target or stop. This used to be a side effect
// buried inside /api/open-positions, meaning a position only got checked
// whenever someone happened to load that specific panel. Pulled out into
// its own endpoint so it can be called on its own schedule, tied to the
// main dashboard refresh (runs on a timer regardless of whether any new
// alert is firing) AND a GitHub Actions cron job (.github/workflows/
// close-alert-cron.yml, every 5 minutes, independent of anyone's browser
// being open at all). No Vercel cron needed, no paid tier.
//
// Requires ?key=<SETPOINT_CRON_KEY> since this triggers real database
// writes and is called by an external, unauthenticated caller (GitHub's
// servers). Same shared key used across open-positions and the backtest
// pages, see lib/access.js.
import { fetchCoinbaseCandles, walkForwardOutcome } from "../../../lib/resolve.js";
import { checkKey } from "../../../lib/access.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const authFail = checkKey(req);
  if (authFail) return authFail;

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ checked: 0, resolved: 0 }, { headers: noCache });
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    const open = await sql`SELECT id, coin, tf, dir, fired_at, entry, stop, target FROM signal_track WHERE outcome = 'open'`;
    const groups = new Map();
    for (const row of open) {
      const key = `${row.coin}:${row.tf}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const minuteCache = new Map();
    let resolvedCount = 0;
    const errors = [];
    for (const [key, rows] of groups) {
      const [coin, tf] = key.split(":");
      let candles;
      try {
        candles = await fetchCoinbaseCandles(coin, tf);
      } catch (e) {
        errors.push(`${key}: ${String(e.message || e).slice(0, 100)}`);
        continue;
      }
      for (const row of rows) {
        const firedMs = new Date(row.fired_at).getTime();
        const target = parseFloat(row.target), stop = parseFloat(row.stop);
        const outcome = await walkForwardOutcome(candles, firedMs, row.dir, target, stop, coin, tf, minuteCache);
        if (outcome) {
          await sql`UPDATE signal_track SET outcome = ${outcome}, resolved_at = now() WHERE id = ${row.id}`;
          resolvedCount++;
        }
      }
    }
    return Response.json({ checked: open.length, resolved: resolvedCount, errors }, { headers: noCache });
  } catch (e) {
    return Response.json({ checked: 0, resolved: 0, error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
