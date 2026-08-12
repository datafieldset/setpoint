// app/api/market/route.js
// Server-side market data for Setpoint. Runs on your Next.js server, so there is
// no browser sandbox and no CORS. Coinbase public market-data endpoints, no key.
// GET /api/market?symbols=BTC,SOL,XLM&tf=15m

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { TF, isValidTf } from "../../../lib/timeframes.js";
import { marketBias, reversalRisk } from "../../../lib/signals.js";
import { aggregate } from "../../../lib/resolve.js";

const HEADERS = { "User-Agent": "setpoint/1.0 (+https://setpoint.app)" };

async function fetchCandles(sym, tf) {
  const meta = TF[tf] || TF["15m"];
  const url = `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${meta.gran}`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 404 ? "not on Coinbase" : `feed ${r.status}`);
  const raw = await r.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("no data");
  // Coinbase rows: [time, low, high, open, close, volume], newest first
  const candles = raw
    .slice()
    .reverse()
    .map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4], volumeto: x[5] }))
    .filter((c) => c.close > 0);
  return meta.aggFactor > 1 ? aggregate(candles, meta.gran, meta.aggFactor) : candles;
}

async function fetchStats(sym) {
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/stats`, { headers: HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    const s = await r.json();
    const open = parseFloat(s.open), last = parseFloat(s.last), vol = parseFloat(s.volume);
    return { change24: open > 0 ? ((last - open) / open) * 100 : null, volUsd: vol * last, last };
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
const MA_CACHE_HOURS = 24;
const WEEKS_NEEDED = 210; // small buffer over 200 for a clean weekly close

async function fetchDailyCandlesPaged(sym, totalDays) {
  const dayMs = 86400 * 1000;
  const chunks = [];
  let end = new Date();
  while (chunks.flat().length < totalDays) {
    const start = new Date(end.getTime() - 299 * dayMs);
    const url = `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=86400&start=${start.toISOString()}&end=${end.toISOString()}`;
    const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!r.ok) break;
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    chunks.push(raw.map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4], volumeto: x[5] })));
    end = new Date(start.getTime() - dayMs);
    if (chunks.length > 8) break; // hard cap so a bad response can't loop forever
  }
  return chunks.flat().sort((a, b) => a.time - b.time).filter((c) => c.close > 0);
}

function toWeeklyCloses(dailyCandles) {
  const weekMs = 7 * 86400 * 1000;
  const map = new Map();
  for (const c of dailyCandles) {
    const bucket = Math.floor(c.time / weekMs) * weekMs;
    map.set(bucket, c.close); // ascending input, so the last write per week is that week's close
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, close]) => close);
}

async function computeWeekly200MA() {
  const daily = await fetchDailyCandlesPaged("BTC", WEEKS_NEEDED * 7);
  const weeklyCloses = toWeeklyCloses(daily);
  if (weeklyCloses.length < 50) return null; // not enough real history to trust this yet
  const window = weeklyCloses.slice(-200);
  const sma = window.reduce((a, b) => a + b, 0) / window.length;
  const k = 2 / (window.length + 1);
  let ema = window[0];
  for (let i = 1; i < window.length; i++) ema = window[i] * k + ema * (1 - k);
  return { sma, ema, weeksUsed: window.length, computedAt: Date.now() };
}

async function getWeekly200MA() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    try { return await computeWeekly200MA(); } catch { return null; }
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await sql`
      CREATE TABLE IF NOT EXISTS macro_cache (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const rows = await sql`SELECT value, updated_at FROM macro_cache WHERE key = 'weekly_200ma'`;
    const fresh = rows.length && (Date.now() - new Date(rows[0].updated_at).getTime()) < MA_CACHE_HOURS * 3600 * 1000;
    if (fresh) return rows[0].value;

    const computed = await computeWeekly200MA();
    if (!computed) return rows.length ? rows[0].value : null; // fetch failed, fall back to stale cache over nothing
    await sql`
      INSERT INTO macro_cache (key, value, updated_at) VALUES ('weekly_200ma', ${JSON.stringify(computed)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(computed)}::jsonb, updated_at = now()
    `;
    return computed;
  } catch {
    try { return await computeWeekly200MA(); } catch { return null; }
  }
}

async function fetchFng() {
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1", { cache: "no-store" });
    const j = await r.json();
    const d = j.data && j.data[0];
    return d ? { value: parseInt(d.value, 10), label: d.value_classification } : null;
  } catch {
    return null;
  }
}

// Market-wide bias, computed from an independent top-100 basket via
// CoinGecko's free, keyless public API, not from whatever the user happens
// to be watching. That independence matters: a bias built only from a
// 3-6 coin watchlist can be partly shaped by one of those same coins' own
// move, a mild circularity. A broad, external basket removes that, and is
// closer to an honest "how is the crypto market doing" read. Requests a
// fast 1h change per coin; falls back to 24h if that field isn't present,
// so a CoinGecko response-shape change degrades gracefully instead of
// silently returning nothing. No key, no signup, ~30 req/min is far more
// than this needs at one call per dashboard refresh.
async function fetchBroadMarketBias() {
  try {
    const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=1h&sparkline=false";
    const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const readings = raw
      .map((c) => {
        const pct = c.price_change_percentage_1h_in_currency ?? c.price_change_percentage_24h ?? null;
        const sym = (c.symbol || "").toUpperCase();
        return { sym, pct, isBTC: sym === "BTC" };
      })
      .filter((c) => c.pct != null && c.sym);
    if (!readings.length) return null;
    return marketBias(readings);
  } catch {
    return null;
  }
}

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
    const label = score >= 60 ? "Longs winning more" : score >= 55 ? "Leaning long" : score <= 40 ? "Shorts winning more" : score <= 45 ? "Leaning short" : "Roughly even";
    return { score, label, bullRate, bearRate, bullN: bull.length, bearN: bear.length };
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

  const [coins, fng, bias, weekly200, signalBias] = await Promise.all([
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
  ]);

  const risk = reversalRisk(bias, fng?.value);
  return Response.json(
    { coins, fng, bias, risk, weekly200, signalBias, tf, at: Date.now() },
    { headers: { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
