// app/api/register/route.js
// Auth.js handles sign-in, but Credentials-based sign-up is on us. This
// creates the account; the client then calls signIn() right after.

import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { sendEmail, welcomeEmailHtml } from "../../../lib/email.js";

export const dynamic = "force-dynamic";

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

export async function POST(req) {
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  // New accounts always start on the free tier, regardless of which plan
  // someone picked on the pricing page. The plan they actually wanted is
  // handled separately, by redirecting to real Stripe checkout right after
  // this. Only the webhook, once Stripe confirms a real payment, ever
  // upgrades a plan. Saving the paid plan here directly would mean typing
  // an email and hitting "Get Pro" grants Pro access with no payment at all.

  if (!validEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "weak_password" }, { status: 400 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'watch',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`;
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length) return Response.json({ error: "email_taken" }, { status: 409 });

    const hash = await bcrypt.hash(password, 10);
    await sql`INSERT INTO users (email, password_hash, plan) VALUES (${email}, ${hash}, 'watch')`;
    // Fire-and-forget: registration itself already succeeded above, a
    // failed or slow email send (e.g. domain not verified with Resend
    // yet) should never turn a real account creation into an error.
    sendEmail({ to: email, subject: "Welcome to Setpoint", html: welcomeEmailHtml(email) }).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e).slice(0, 200) }, { status: 500 });
  }
}
