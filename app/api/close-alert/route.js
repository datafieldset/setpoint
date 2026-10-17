// app/api/close-alert/route.js
//
// Checks every open fixed-target signal against real price and closes
// (resolves) any that have actually hit target or stop. Its own endpoint
// so it runs on its own schedule (the dashboard refresh, and the GitHub
// Actions cron in .github/workflows/signals-cron.yml every 5 minutes,
// independent of anyone's browser). No Vercel cron needed, no paid tier.
// The resolving itself lives in lib/resolve.js, shared with the
// scoreboard and the backtest pages.
//
// Requires ?key=<SETPOINT_CRON_KEY> since this triggers real database
// writes and is called by an external, unauthenticated caller (GitHub's
// servers). Same shared key used across open-positions and the backtest
// pages, see lib/access.js.
import { resolveOpenTrades } from "../../../lib/resolve.js";
import { ensureSignalTrack } from "../../../lib/schema.js";
import { checkKey } from "../../../lib/access.js";
import { idle } from "../../../lib/idleState.js";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const authFail = checkKey(req);
  if (authFail) return authFail;

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ checked: 0, resolved: 0 }, { headers: noCache });
  // The 5-minute scan already checks every open trade (lib/trendRunner.js), so when it has looked in the last
  // 4 minutes there is nothing new to find: skip the database (dashboards call this every minute).
  if (idle.recentlyChecked(Date.now(), 4 * 60 * 1000)) return Response.json({ checked: idle.openCount(), resolved: 0, recentlyChecked: true }, { headers: noCache });
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await ensureSignalTrack(sql);
    return Response.json(await resolveOpenTrades(sql), { headers: noCache });
  } catch (e) {
    return Response.json({ checked: 0, resolved: 0, error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
