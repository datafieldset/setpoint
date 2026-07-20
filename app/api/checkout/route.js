// app/api/checkout/route.js
//
// Starts a real Stripe subscription checkout for the CURRENTLY LOGGED IN
// user. This route never grants paid access on its own, on purpose. It only
// creates the Checkout Session and hands back the URL to redirect to. The
// only place a user's plan actually gets upgraded is the webhook, once
// Stripe confirms the payment really went through. That way an abandoned or
// failed checkout just leaves someone on the free Watch tier, exactly
// right, never a half-granted paid state.

import { auth } from "../../../auth.js";
import { neon } from "@neondatabase/serverless";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

const PRICE_IDS = {
  trader: process.env.STRIPE_PRICE_TRADER,
  desk: process.env.STRIPE_PRICE_PRO, // internal id stays "desk", the product is displayed and sold as "Setpoint Pro"
};

export async function POST(req) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "not_signed_in" }, { status: 401 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const conn = process.env.DATABASE_URL;
  if (!secretKey) return Response.json({ error: "stripe_not_configured" }, { status: 500 });
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const plan = body.plan;
  const priceId = PRICE_IDS[plan];
  if (!priceId) return Response.json({ error: "unknown_plan" }, { status: 400 });

  try {
    const stripe = new Stripe(secretKey);
    const sql = neon(conn);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive'`;

    const rows = await sql`SELECT id, stripe_customer_id FROM users WHERE email = ${session.user.email.toLowerCase()}`;
    const user = rows[0];
    if (!user) return Response.json({ error: "user_not_found" }, { status: 404 });

    // Reuse the same Stripe customer across upgrades/renewals instead of
    // creating a new one every checkout, so billing history stays in one place.
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: session.user.email });
      customerId = customer.id;
      await sql`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${user.id}`;
    }

    const origin = req.headers.get("origin") || "https://setpointalerts.com";
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: String(user.id),
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: { userId: String(user.id), plan },
    });

    return Response.json({ url: checkoutSession.url });
  } catch (e) {
    return Response.json({ error: "checkout_failed", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
