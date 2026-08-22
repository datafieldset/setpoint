// app/api/cancel-subscription/route.js
//
// Real, self-service cancellation. Cancels at the end of the period
// already paid for, never immediately, a customer should never lose
// access to time they already paid Stripe for. The actual plan
// downgrade happens automatically later, through the existing webhook
// (customer.subscription.deleted), the same real, single place every
// other plan change already goes through — this route never touches the
// users table directly.
import { auth } from "../../../auth.js";
import { neon } from "@neondatabase/serverless";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const conn = process.env.DATABASE_URL;
  if (!secretKey || !conn) return Response.json({ error: "not_configured" }, { status: 500 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`SELECT stripe_subscription_id FROM users WHERE email = ${session.user.email.toLowerCase()}`;
    const subId = rows[0]?.stripe_subscription_id;
    if (!subId) return Response.json({ error: "no_subscription" }, { status: 400 });

    const stripe = new Stripe(secretKey);
    const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });

    return Response.json({ ok: true, endsAt: sub.current_period_end * 1000 });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
