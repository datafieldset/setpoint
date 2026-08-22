// app/api/admin/analytics/route.js
//
// Real, simple numbers, not a dashboard full of vanity metrics. Signups
// over time (from the users table's own real timestamps, no separate
// tracking needed), the current plan breakdown, and real page views for
// the public pages, so there's an actual, honest read on whether traffic
// is growing and whether it's converting, not a guess.
import { auth } from "../../../../auth.js";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) return Response.json({ error: "not_admin" }, { status: 403 });

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });

    const [signupsByDay, planBreakdown, viewsByDay, totals] = await Promise.all([
      sql`
        SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS n
        FROM users
        WHERE created_at > now() - interval '30 days'
        GROUP BY day ORDER BY day
      `,
      sql`SELECT plan, COUNT(*)::int AS n FROM users GROUP BY plan ORDER BY n DESC`,
      sql`
        SELECT date_trunc('day', at) AS day, COUNT(*)::int AS n
        FROM page_views
        WHERE at > now() - interval '30 days'
        GROUP BY day ORDER BY day
      `.catch(() => []), // table may not exist yet if nobody's visited a tracked page
      sql`SELECT COUNT(*)::int AS total_users, COUNT(*) FILTER (WHERE plan NOT IN ('watch')) ::int AS total_paid FROM users`,
    ]);

    return Response.json({
      signupsByDay: signupsByDay.map((r) => ({ day: r.day, n: r.n })),
      planBreakdown: planBreakdown.map((r) => ({ plan: r.plan, n: r.n })),
      viewsByDay: viewsByDay.map((r) => ({ day: r.day, n: r.n })),
      totalUsers: totals[0]?.total_users || 0,
      totalPaid: totals[0]?.total_paid || 0,
    });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
