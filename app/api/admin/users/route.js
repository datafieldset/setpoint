// app/api/admin/users/route.js
//
// Lists everyone who's registered, admin-only. Only ever returns what's
// actually collected at signup, which today is just email, plan, and
// signup date, name and phone don't exist anywhere in this system, they
// were never asked for. Supports ?csv=1 for a direct file download.
import { auth } from "../../../../auth.js";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

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
