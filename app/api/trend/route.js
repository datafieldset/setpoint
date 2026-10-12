// app/api/trend/route.js
//
// Admin-only. Everything the Trend Rider panel shows: what it's watching,
// the open trade with its trailing stop, and the track record so far.
import { auth } from "../../../auth.js";
import { neon } from "@neondatabase/serverless";
import { trendState } from "../../../lib/trendRunner.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) return Response.json({ error: "not_admin" }, { status: 403 });
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });
  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    return Response.json(await trendState(sql), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String(e.message || e).slice(0, 150) }, { status: 500 });
  }
}
