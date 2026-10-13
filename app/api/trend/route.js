// app/api/trend/route.js
//
// Public and read-only (v19.23). Everything the Trend Rider panel shows:
// per timeframe, what it's waiting for, any open trade with its trailing
// stop, and the real scoreboard. Push alerts still go to admins only.
import { neon } from "@neondatabase/serverless";
import { trendState } from "../../../lib/trendRunner.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });
  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    return Response.json(await trendState(sql), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String(e.message || e).slice(0, 150) }, { status: 500 });
  }
}
