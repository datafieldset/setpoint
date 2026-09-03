// app/api/market/route.js
// Server-side market data for Setpoint. Runs on your Next.js server, so there is
// no browser sandbox and no CORS. Coinbase public market-data endpoints, no key.
// GET /api/market?symbols=BTC,SOL,XLM&tf=15m

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { TF, isValidTf } from "../../../lib/timeframes.js";
import { marketBias, reversalRisk, getLiveVerifiedGate } from "../../../lib/signals.js";
import { fetchCandles, getWeekly200MA, fetchFng, fetchBroadMarketBias, getRecentWhaleOutflow, HEADERS } from "../../../lib/marketContext.js";

// Kept local, market/route.js-specific: 24h stats display and the
// signal-drift bias panel aren't needed by the server-side signal
// detector, so they stay here rather than in the shared module.
const STATS_CACHE = new Map();
const CACHE_TTL_MS = 25000;

function getCached(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.data;
}

async function fetchStats(sym) {
  const cached = getCached(STATS_CACHE, sym);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/stats`, { headers: HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    const s = await r.json();
    const open = parseFloat(s.open), last = parseFloat(s.last), vol = parseFloat(s.volume);
    const result = { change24: open > 0 ? ((last - open) / open) * 100 : null, volUsd: vol * last, last };
    STATS_CACHE.set(sym, { data: result, at: Date.now() });
    return result;
  } catch {
    return null;
  }
}

// The 200-week moving average: Bitcoin's long-run structural floor. Every
// bear market since 2015 bottomed at or near this line. It's a genuinely
// different kind of read from everything else in this app, weeks instead
// of minutes, a macro backdrop, not a trading signal, so it's built and
// cached completely differently too.
//
// Needs ~200 weeks (~1400 days) of daily history, which Coinbase only
// returns up to 300 candles per call, so this pages backward through
// several calls. That's expensive and this number barely moves day to day,
// so the result is cached in Neon and only recomputed once it's a day old,
// not on every dashboard refresh like everything else here.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Setpoint's own read: which direction is actually winning right now,
// across every resolved trade the engine has made, not just the 7
// verified setups. Fear & Greed reads the crowd's mood. This reads
// what's actually working, real outcomes, not sentiment. Deliberately
// pulls from the full pool (verified and testing both), a verified-only
// read would have nothing at all on the short side right now, most of
// the real short-side edge is still in testing, this is exactly where a
// real regime shift shows up first, before anything's proven enough to
// get a name. Same signed -50/+50 scale as the volatility meter, for a
// consistent visual language across the app, 50 = neutral, no real lean
// with too few resolved trades on either side to trust.
const BIAS_WINDOW = 30;
const BIAS_MIN_SAMPLE = 5;

async function getSignalBias() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return null;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`
      SELECT dir, outcome
      FROM signal_track
      WHERE outcome IN ('win', 'loss')
      ORDER BY resolved_at DESC
      LIMIT 400
    `;
    const bull = rows.filter((r) => r.dir === "bull").slice(0, BIAS_WINDOW);
    const bear = rows.filter((r) => r.dir === "bear").slice(0, BIAS_WINDOW);
    if (bull.length < BIAS_MIN_SAMPLE || bear.length < BIAS_MIN_SAMPLE) {
      return { score: 50, label: "Not enough data yet", bullN: bull.length, bearN: bear.length };
    }
    const bullRate = bull.filter((r) => r.outcome === "win").length / bull.length;
    const bearRate = bear.filter((r) => r.outcome === "win").length / bear.length;
    const score = Math.round(Math.max(0, Math.min(100, 50 + (bullRate - bearRate) * 50)));
    // A close gap between two weak numbers (30% vs 33%, neither side working)
    // reads almost identically to a close gap between two strong ones (65%
    // vs 68%) if all you look at is the gap. Those are opposite situations,
    // this flags the real one: both sides genuinely struggling at once.
    const bothWeak = bullRate < 0.45 && bearRate < 0.45;
    // The label used to only look at the relative score, so "Longs winning
    // more" could show up even when longs were only relatively better, not
    // actually good, real, current example: 43% vs 13%, neither side
    // winning, longs just less bad. Checked first, before the normal
    // relative labels, so it never gets papered over by a wide gap alone.
    const label = bothWeak
      ? (score >= 55 ? "Both weak, longs relatively better" : score <= 45 ? "Both weak, shorts relatively better" : "Both sides struggling")
      : score >= 60 ? "Longs winning more" : score >= 55 ? "Leaning long" : score <= 40 ? "Shorts winning more" : score <= 45 ? "Leaning short" : "Roughly even";
    return { score, label, bullRate, bearRate, bullN: bull.length, bearN: bear.length, bothWeak };
  } catch {
    return null;
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get("symbols") || "BTC,SOL,XLM")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 6);
  const tfParam = searchParams.get("tf");
  const tf = isValidTf(tfParam) ? tfParam : "15m";

  const [coins, fng, bias, weekly200, signalBias, liveGateResult, recentWhaleOutflow] = await Promise.all([
    Promise.all(
      symbols.map(async (sym) => {
        try {
          const [candles, stats] = await Promise.all([fetchCandles(sym, tf), fetchStats(sym)]);
          return { sym, candles, stats, error: null };
        } catch (e) {
          return { sym, candles: [], stats: null, error: e.message || "failed" };
        }
      })
    ),
    fetchFng(),
    fetchBroadMarketBias(),
    // Cached almost always, but guard the rare cold-cache case anyway, this
    // is background context, it should never be why the dashboard feels slow.
    withTimeout(getWeekly200MA().catch(() => null), 8000, null),
    getSignalBias(),
    getLiveVerifiedGate(),
    getRecentWhaleOutflow(),
  ]);
  const { gate: liveGate, regimeGate } = liveGateResult;

  const risk = reversalRisk(bias, fng?.value);
  return Response.json(
    { coins, fng, bias, risk, weekly200, signalBias, liveGate, regimeGate, recentWhaleOutflow, tf, at: Date.now() },
    { headers: { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
