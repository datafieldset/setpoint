// app/api/track-visit/route.js
//
// Deliberately minimal, real visit counting, not a full analytics
// platform. One row per real page load of a public page, path + day,
// nothing about who, no cookies, no fingerprinting. Just "how many real
// visits is this getting, and is that growing."
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ ok: false });

  let body;
  try { body = await req.json(); } catch { return Response.json({ ok: false }); }
  const path = (body.path || "/").slice(0, 100);

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await sql`
      CREATE TABLE IF NOT EXISTS page_views (
        id SERIAL PRIMARY KEY,
        path TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`INSERT INTO page_views (path) VALUES (${path})`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }); // a missed visit log should never surface as a real error to a visitor
  }
}
