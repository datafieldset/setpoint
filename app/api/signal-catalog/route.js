// app/api/signal-catalog/route.js
//
// Real, complete picture of every signal this app has ever built, the
// direct answer to "how many do we have, what are they doing, and
// what are they actually good at." Built Sep 21, after it became clear
// the real answer to all three questions only ever lived in scattered
// chat history and code comments, nowhere the person running this app
// could actually look.
//
// Combines two real, existing sources rather than computing anything
// fresh and slow: getLiveVerifiedGate() for each signal's real,
// current percentage (fast, already used everywhere else), and the
// most recently saved /api/backtest run for the real, condition-
// specific breakdown (trend, bias) — that route already computes and
// saves this on every real run, so this just reads the latest one
// rather than re-running a genuinely slow, full simulation on every
// page load.
import { auth } from "../../../auth.js";
import { neon } from "@neondatabase/serverless";
import { ALL_SIGNALS, SIGNAL_RATES, PROVEN_THRESHOLD, TESTING_SIGNALS, getLiveVerifiedGate } from "../../../lib/signals.js";
import { TF } from "../../../lib/timeframes.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) return Response.json({ error: "not_admin" }, { status: 403 });

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const [totalsRows, latestRunRow, liveGateResult] = await Promise.all([
      sql`SELECT label, COUNT(*)::int AS n FROM signal_track GROUP BY label`,
      sql`SELECT MAX(run_at) AS run_at FROM backtest_results`,
      getLiveVerifiedGate(),
    ]);
    const { gate: liveGate, regimeGate } = liveGateResult;
    const latestRunAt = latestRunRow[0]?.run_at || null;
    const bucketRows = latestRunAt
      ? await sql`SELECT bucket, fired, wins, losses, win_rate FROM backtest_results WHERE run_at = ${latestRunAt}`
      : [];

    const totalsByLabel = Object.fromEntries(totalsRows.map((r) => [r.label, r.n]));
    const tfLabels = Object.values(TF).map((t) => t.label);
    const dirs = ["bull", "bear"];

    const signals = ALL_SIGNALS.map(({ name, what }) => {
      // Every real (tf, dir) combination this signal has ever fired,
      // with its real, current status — static table, live gate,
      // regime gate, all three checked the same, honest way real
      // customers see it.
      const combos = [];
      for (const tf of tfLabels) {
        for (const dir of dirs) {
          const key = `${name}|${tf}|${dir}`;
          const staticEntry = SIGNAL_RATES[key];
          const gate = liveGate[key];
          const hasAnyData = !!staticEntry || !!gate;
          if (!hasAnyData) continue;
          const staticProven = !!staticEntry && staticEntry.rate != null && staticEntry.rate >= PROVEN_THRESHOLD;
          const rate = gate && gate.n >= 5 ? gate.rate : (staticEntry?.rate ?? null);
          const isLive = !!(gate && gate.n >= 5);
          combos.push({
            tf, dir,
            rate,
            n: gate?.n ?? null,
            isLive,
            staticRate: staticEntry?.rate ?? null,
            currentlyPromoted: staticProven && rate != null && rate >= PROVEN_THRESHOLD,
          });
        }
      }
      // The real, honest, condition-specific breakdown, straight from
      // the most recently saved backtest run — trend and bias splits
      // for this exact signal, whatever timeframe or direction each
      // one fired under.
      const conditions = bucketRows
        .filter((b) => b.bucket.startsWith(`${name} ·`) && (b.bucket.includes("Trend:") || b.bucket.includes("Bias:")))
        .map((b) => ({ key: b.bucket, fired: b.fired, wins: b.wins, losses: b.losses, winRate: b.win_rate != null ? parseFloat(b.win_rate) : null }))
        .filter((c) => c.wins + c.losses >= 5) // too thin a real sample to show as a real pattern
        .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

      const isTesting = TESTING_SIGNALS.includes(name);
      const anyPromoted = combos.some((c) => c.currentlyPromoted);
      const status = anyPromoted ? "promoted" : isTesting ? "testing" : "collecting";

      return {
        name, what, status,
        totalFired: totalsByLabel[name] || 0,
        combos: combos.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)),
        conditions,
      };
    });

    return Response.json({ signals, latestBacktestRunAt: latestRunAt }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String(e.message || e).slice(0, 200) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
