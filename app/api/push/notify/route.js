// app/api/push/notify/route.js
//
// Sends a real push to every device the signed-in account has
// subscribed on. Called client-side at the exact moment a signal both
// fires for the first time AND is currently verified, no separate
// trigger list, that decision already happened before this route is
// ever reached.
import { auth } from "../../../../auth.js";
import { neon } from "@neondatabase/serverless";
import webpush from "web-push";

export const dynamic = "force-dynamic";

function configureWebPush() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:nokanetmail@gmail.com", pub, priv);
  return true;
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });
  if (!configureWebPush()) return Response.json({ error: "not_configured" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const { coin, label, dir, tf } = body || {};
  if (!coin || !label) return Response.json({ error: "missing_fields" }, { status: 400 });

  const verb = dir === "bull" ? "Buy" : "Sell";
  const payload = JSON.stringify({
    title: `${verb} ${label}`,
    body: `${coin} · ${tf}, just fired on your dashboard.`,
    url: "/",
    tag: `${coin}-${label}-${dir}`,
  });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        subscription JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const rows = await sql`SELECT endpoint, subscription FROM push_subscriptions WHERE email = ${session.user.email.toLowerCase()}`;
    if (!rows.length) return Response.json({ ok: true, sent: 0 });

    let sent = 0;
    const deadEndpoints = [];
    await Promise.all(
      rows.map(async (r) => {
        try {
          await webpush.sendNotification(r.subscription, payload);
          sent++;
        } catch (e) {
          // A real, expired or revoked subscription returns 404/410, that
          // device unsubscribed or the browser dropped it, clean it up
          // rather than let dead rows accumulate and keep failing forever.
          if (e.statusCode === 404 || e.statusCode === 410) deadEndpoints.push(r.endpoint);
        }
      })
    );
    if (deadEndpoints.length) {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ANY(${deadEndpoints})`;
    }
    return Response.json({ ok: true, sent });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
