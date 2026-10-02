// app/api/signal-catalog/route.js
//
// Real, complete picture of every signal this app has ever built, the
// direct answer to "how many do we have, what are they doing, and
// what are they actually good at." Built Sep 21, after it became clear
// the real answer to all three questions only ever lived in scattered
// chat history and code comments, nowhere the person running this app
// could actually look.
//
// Real, direct rebuild (Oct 2): the original version only ever showed
// a combo once it had enough real data to clear a formal threshold —
// 5 trades for an overall live read, 10 for a regime-specific one.
// Anything thinner was completely invisible, even to admin, even
// though the real, honest data existed. The real problem this caused:
// genuinely working signals sat unnoticed because nobody could see
// them building a real track record in real time, only after they'd
// already cleared a bar that itself only gets checked when someone
// happens to think to look. Now uses confidenceTier() for every real
// combo, so anything with even a single real, resolved trade shows up,
// honestly labeled established / emerging / early read / no data —
// never hidden, never dressed up as more than the real sample
// actually supports.
import { auth } from "../../../auth.js";
import { neon } from "@neondatabase/serverless";
import { ALL_SIGNALS, TESTING_SIGNALS, getLiveVerifiedGate, getFullSignalGate, confidenceTier, CONFIDENCE_TIERS } from "../../../lib/signals.js";
import { TF } from "../../../lib/timeframes.js";
import { brandName } from "../../../lib/brand.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) return Response.json({ error: "not_admin" }, { status: 403 });

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const [totalsRows, latestRunRow, liveGateResult, fullGateResult] = await Promise.all([
      sql`SELECT label, COUNT(*)::int AS n FROM signal_track GROUP BY label`,
      sql`SELECT MAX(run_at) AS run_at FROM backtest_results`,
      getLiveVerifiedGate(),
      getFullSignalGate(),
    ]);
    const { gate: liveGate, regimeGate } = liveGateResult;
    const { gate: fullGate, regimeGate: fullRegimeGate } = fullGateResult;
    const latestRunAt = latestRunRow[0]?.run_at || null;
    const bucketRows = latestRunAt
      ? await sql`SELECT bucket, fired, wins, losses, win_rate FROM backtest_results WHERE run_at = ${latestRunAt}`
      : [];

    const totalsByLabel = Object.fromEntries(totalsRows.map((r) => [r.label, r.n]));
    const tfLabels = Object.values(TF).map((t) => t.label);
    const dirs = ["bull", "bear"];

    const signals = ALL_SIGNALS.map(({ name, what }) => {
      // Every real (tf, dir) combination, always, the moment any real
      // data exists at all — the real, honest point of this rebuild.
      const combos = [];
      for (const tf of tfLabels) {
        for (const dir of dirs) {
          const ct = confidenceTier(name, tf, dir, liveGate, null, regimeGate, fullGate, fullRegimeGate);
          if (ct.tier === "none") continue;
          combos.push({ tf, dir, ...ct });
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
      const bestTierOrder = combos.reduce((max, c) => Math.max(max, CONFIDENCE_TIERS[c.tier].order), 0);
      const bestTier = Object.entries(CONFIDENCE_TIERS).find(([, v]) => v.order === bestTierOrder)?.[0] || "none";

      return {
        name, brandedName: brandName(name), what,
        isTesting, bestTier,
        totalFired: totalsByLabel[name] || 0,
        combos: combos.sort((a, b) => CONFIDENCE_TIERS[b.tier].order - CONFIDENCE_TIERS[a.tier].order || (b.rate ?? -1) - (a.rate ?? -1)),
        conditions,
      };
    });

    return Response.json({ signals, latestBacktestRunAt: latestRunAt, tiers: CONFIDENCE_TIERS }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String(e.message || e).slice(0, 200) }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
