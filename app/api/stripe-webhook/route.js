// app/api/stripe-webhook/route.js
//
// Stripe calls this the moment something real happens: a payment succeeds,
// a subscription renews, lapses, or gets canceled. This is the ONLY place
// in the app that actually grants or removes paid access, on purpose,
// checkout.route.js never does it directly. That way a browser closing
// mid-checkout, a flaky network, or someone hitting the checkout endpoint
// directly without ever paying can never grant free access to a paid plan.
//
// Needs the raw, unparsed request body to verify Stripe's signature, so this
// reads req.text(), not req.json(). Verifying the signature is what proves a
// request genuinely came from Stripe and not someone just posting fake JSON
// at this URL to grant themselves a free subscription.

import { neon } from "@neondatabase/serverless";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

async function ensureColumns(sql) {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive'`;
}

export async function POST(req) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const conn = process.env.DATABASE_URL;
  if (!secretKey || !webhookSecret || !conn) {
    return Response.json({ error: "not_configured" }, { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e) {
    // A bad signature means this request did not genuinely come from
    // Stripe. Reject it outright, never process it.
    return Response.json({ error: "bad_signature" }, { status: 400 });
  }

  const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
  await ensureColumns(sql);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        if (userId && plan) {
          await sql`
            UPDATE users
            SET plan = ${plan}, subscription_status = 'active', stripe_subscription_id = ${session.subscription || null}
            WHERE id = ${parseInt(userId, 10)}
          `;
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        // active or trialing means genuinely paying right now; anything
        // else (past_due, unpaid, canceled, incomplete_expired) is not.
        const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status;
        await sql`
          UPDATE users SET subscription_status = ${status}
          WHERE stripe_customer_id = ${sub.customer}
        `;
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        // Subscription genuinely ended, not just lapsed. Drop back to the
        // free tier rather than leaving someone flagged as a paid plan
        // they're no longer paying for.
        await sql`
          UPDATE users SET subscription_status = 'canceled', plan = 'watch'
          WHERE stripe_customer_id = ${sub.customer}
        `;
        break;
      }
      default:
        break; // other event types are ignored, not an error
    }
    return Response.json({ received: true });
  } catch (e) {
    return Response.json({ error: "handler_failed", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
