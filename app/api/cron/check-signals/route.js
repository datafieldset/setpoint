// app/api/cron/check-signals/route.js
//
// The scheduled scan (GitHub Actions cron, see .github/workflows/check-signals-cron.yml). It runs the live signals
// (lib/trendRunner.js: Swing Rider, Flush Rider, Flow Rider, Calm Rider), which log trades and send their own pushes, then the
// big-move heads-up. v25.3: the original signals' detection and push loop was removed here (it had been switched off by FOCUS_MODE).
//
// Requires ?key=<the shared key>, same protection every other
// semi-internal route already uses (close-alert, open-positions).
import { checkKey } from "../../../../lib/access.js";
import { neon } from "@neondatabase/serverless";
import webpush from "web-push";
import { checkBigMove } from "../../../../lib/bigMove.js";
import { runTrend } from "../../../../lib/trendRunner.js";
import { exportState, importState } from "../../../../lib/idleState.js";
import { ensureSignalTrack } from "../../../../lib/schema.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function configureWebPush() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:nokanetmail@gmail.com", pub, priv);
  return true;
}

// The scan's memory travels with the cron loop (lib/idleState.js): every response carries it, signed,
// and the next call sends it back, so a quiet run needs no database call even when Vercel hands the
// call to a fresh server instance.
async function withState(res) {
  try {
    const out = exportState();
    if (!out) return res;
    return Response.json({ ...(await res.clone().json()), idleState: out.state, idleSig: out.sig }, { status: res.status });
  } catch { return res; }
}
export async function GET(req) { return withState(await run(req)); }
export async function POST(req) {
  if (checkKey(req)) return checkKey(req);
  try { const b = await req.json(); importState(b?.state, b?.sig, Date.now()); } catch { /* no carried memory, run as usual */ }
  return withState(await run(req));
}

async function run(req) {
  const authFail = checkKey(req);
  if (authFail) return authFail;

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });
  const hasVapid = configureWebPush();

  const sql = neon(conn, { fetchOptions: { cache: "no-store" } });

  try {
    // Fails loudly (caught below as server_error) instead of letting
    // every insert quietly fail on a missing column.
    await ensureSignalTrack(sql);
    // Server-side trade logging comes first and never depends on push
    // being configured: a trade must open and close whether or not
    // anyone can be notified. A hung feed is cut off after 20 seconds.
    let trend = null;
    try { trend = await Promise.race([runTrend(sql, hasVapid ? webpush : null), new Promise((_, rej) => setTimeout(() => rej(new Error("trend timed out")), 38000))]); } catch (e) { trend = { error: String(e.message || e).slice(0, 80) }; }
    if (!hasVapid) return Response.json({ error: "not_configured", checked: 0, sent: 0, trend });
    // Independent of any watchlist: a plain heads-up when BTC has made a
    // big, fast move. Must never break the signal run itself.
    let bigMove = null;
    try { bigMove = await checkBigMove(sql, webpush); } catch (e) { bigMove = { error: String(e.message || e).slice(0, 80) }; }
    // v25.3 (Nov 22): the original signals are gone from the server. The live signals (lib/trendRunner.js) are all logged and pushed above.
    return Response.json({ checked: 0, sent: 0, reason: "originals_removed", bigMove, trend });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
