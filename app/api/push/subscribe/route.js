// app/api/push/subscribe/route.js
//
// Stores a real browser push subscription against the signed-in account.
// One row per device/browser, an account with multiple devices
// subscribed just gets a push to all of them. Creates its own table on
// first real use, no separate migration step needed, matches how this
// project already handles new tables elsewhere.
import { auth } from "../../../../auth.js";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const sub = body?.subscription;
  if (!sub?.endpoint) return Response.json({ error: "missing_subscription" }, { status: 400 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await ensureTable(sql);
    // A real device re-subscribing (permission reset, cache clear) sends
    // a new endpoint, ON CONFLICT just keeps the stored payload current
    // rather than growing duplicate rows for the same device over time.
    await sql`
      INSERT INTO push_subscriptions (email, endpoint, subscription)
      VALUES (${session.user.email.toLowerCase()}, ${sub.endpoint}, ${JSON.stringify(sub)})
      ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription, email = EXCLUDED.email
    `;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function DELETE(req) {
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const endpoint = body?.endpoint;
  if (!endpoint) return Response.json({ error: "missing_endpoint" }, { status: 400 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await ensureTable(sql);
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND email = ${session.user.email.toLowerCase()}`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
