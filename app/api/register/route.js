// app/api/register/route.js
// Auth.js handles sign-in, but Credentials-based sign-up is on us. This
// creates the account; the client then calls signIn() right after.

import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

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
  const plan = ["watch", "trader", "desk"].includes(body.plan) ? body.plan : "watch";

  if (!validEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "weak_password" }, { status: 400 });

  try {
    const sql = neon(conn);
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'watch',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length) return Response.json({ error: "email_taken" }, { status: 409 });

    const hash = await bcrypt.hash(password, 10);
    await sql`INSERT INTO users (email, password_hash, plan) VALUES (${email}, ${hash}, ${plan})`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e).slice(0, 200) }, { status: 500 });
  }
}
