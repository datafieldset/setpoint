// app/api/my-watchlist/route.js
//
// Persists which coins a signed-in user is tracking, tied to their account
// so it follows them across devices and browsers, not just the one tab
// they set it up in. Before this, watchlist only ever lived in browser
// memory (useState), so any add/remove vanished the moment the page
// refreshed, it had nowhere to actually save to.
import { auth } from "../../../auth.js";

export const dynamic = "force-dynamic";

async function getSql() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return null;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
  // Same safe pattern used for is_admin: this column may not exist yet on
  // an already-live users table, IF NOT EXISTS makes adding it a no-op
  // once it's there.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS watchlist TEXT`;
  return sql;
}

export async function GET() {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ watchlist: null }, { status: 401, headers: noCache });
  }
  try {
    const sql = await getSql();
    if (!sql) return Response.json({ watchlist: null }, { headers: noCache });
    const rows = await sql`SELECT watchlist FROM users WHERE email = ${session.user.email.toLowerCase()}`;
    const raw = rows[0]?.watchlist;
    let watchlist = null;
    if (raw) {
      try { watchlist = JSON.parse(raw); } catch { watchlist = null; }
    }
    return Response.json({ watchlist }, { headers: noCache });
  } catch (e) {
    return Response.json({ watchlist: null, error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}

export async function POST(req) {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ saved: false }, { status: 401, headers: noCache });
  }
  try {
    const body = await req.json();
    const watchlist = Array.isArray(body?.watchlist) ? body.watchlist.filter((s) => typeof s === "string" && s.length > 0 && s.length <= 10) : null;
    if (!watchlist || watchlist.length === 0) {
      return Response.json({ saved: false, error: "watchlist must be a non-empty array of symbols" }, { status: 400, headers: noCache });
    }
    const sql = await getSql();
    if (!sql) return Response.json({ saved: false, error: "DATABASE_URL not set" }, { headers: noCache });
    await sql`UPDATE users SET watchlist = ${JSON.stringify(watchlist)} WHERE email = ${session.user.email.toLowerCase()}`;
    return Response.json({ saved: true }, { headers: noCache });
  } catch (e) {
    return Response.json({ saved: false, error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
