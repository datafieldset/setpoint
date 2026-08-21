// app/api/admin/users/route.js
//
// Lists everyone who's registered, admin-only. Only ever returns what's
// actually collected at signup, which today is just email, plan, and
// signup date, name and phone don't exist anywhere in this system, they
// were never asked for. Supports ?csv=1 for a direct file download.
import { auth } from "../../../../auth.js";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function DELETE(req) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return Response.json({ error: "not_admin" }, { status: 403 });
  }
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const email = (body.email || "").trim().toLowerCase();
  if (!email) return Response.json({ error: "missing_email" }, { status: 400 });
  // Never allow deleting your own admin account this way, a lockout with
  // no other admin UI to fix it from would be a real mess to recover from.
  if (email === session.user.email.toLowerCase()) {
    return Response.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const result = await sql`DELETE FROM users WHERE email = ${email} RETURNING id`;
    if (!result.length) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}

const VALID_PLANS = ["starter", "trader", "desk", "watch"];

export async function PATCH(req) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return Response.json({ error: "not_admin" }, { status: 403 });
  }
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const email = (body.email || "").trim().toLowerCase();
  const plan = (body.plan || "").trim();
  if (!email) return Response.json({ error: "missing_email" }, { status: 400 });
  // Real, exact allowlist, not just "any non-empty string" — a typo here
  // would silently corrupt a real account's plan, worth being strict.
  if (!VALID_PLANS.includes(plan)) return Response.json({ error: "invalid_plan" }, { status: 400 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    // Manual grant, no real Stripe subscription behind it, matches the
    // exact same fields the real checkout webhook sets, so an account
    // upgraded this way looks and works identically either way. Never
    // touches stripe_subscription_id, there genuinely isn't one.
    const result = await sql`UPDATE users SET plan = ${plan}, subscription_status = 'active' WHERE email = ${email} RETURNING id`;
    if (!result.length) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, plan });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function GET(req) {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return Response.json({ error: "not_admin" }, { status: 403 });
  }

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`SELECT email, plan, is_admin, created_at FROM users ORDER BY created_at DESC`;
    const users = rows.map((r) => ({
      email: r.email,
      plan: r.plan,
      isAdmin: r.is_admin,
      createdAt: r.created_at,
    }));

    const { searchParams } = new URL(req.url);
    if (searchParams.get("csv") === "1") {
      const header = "email,plan,is_admin,created_at";
      const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const lines = users.map((u) => [u.email, u.plan, u.isAdmin, new Date(u.createdAt).toISOString()].map(escape).join(","));
      const csv = [header, ...lines].join("\n");
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="setpoint-users-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const now = Date.now();
    const newLast24h = users.filter((u) => now - new Date(u.createdAt).getTime() < 86400000).length;
    return Response.json({ users, total: users.length, newLast24h }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
