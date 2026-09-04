// lib/marketContext.js
//
// The real market-context fetchers, extracted from market/route.js
// (Aug 22) specifically so the new server-side signal detector
// (app/api/cron/check-signals/route.js) could reuse the exact same
// logic instead of a second, separate copy. This is the same anti-drift
// discipline already applied to getLiveVerifiedGate and pricing, two
// copies of the same real logic drifting apart has been the single most
// common real bug on this project.
import { TF } from "./timeframes.js";
import { marketBias } from "./signals.js";
import { aggregate } from "./resolve.js";

export const HEADERS = { "User-Agent": "setpoint/1.0 (+https://setpoint.app)" };

// Shared, in-memory cache, module scope, survives across requests on the
// same warm serverless instance. If five users are all watching BTC at
// the same moment (or the cron and a real user overlap), one real
// Coinbase request instead of several redundant ones.
const CANDLE_CACHE = new Map();
const CACHE_TTL_MS = 25000;

function getCached(key) {
  const hit = CANDLE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { CANDLE_CACHE.delete(key); return null; }
  return hit.data;
}

export async function fetchCandles(sym, tf) {
  const meta = TF[tf] || TF["15m"];
  const cacheKey = `${sym}:${tf}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${meta.gran}`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 404 ? "not on Coinbase" : `feed ${r.status}`);
  const raw = await r.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("no data");
  const candles = raw
    .slice()
    .reverse()
    .map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4], volumeto: x[5] }))
    .filter((c) => c.close > 0);
  const result = meta.aggFactor > 1 ? aggregate(candles, meta.gran, meta.aggFactor) : candles;
  CANDLE_CACHE.set(cacheKey, { data: result, at: Date.now() });
  return result;
}

const MA_CACHE_HOURS = 1;
const WEEKS_NEEDED = 210;

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
    if (chunks.length > 8) break;
  }
  return chunks.flat().sort((a, b) => a.time - b.time).filter((c) => c.close > 0);
}

function toWeeklyCloses(dailyCandles) {
  const weekMs = 7 * 86400 * 1000;
  const map = new Map();
  for (const c of dailyCandles) {
    const bucket = Math.floor(c.time / weekMs) * weekMs;
    map.set(bucket, c.close);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([time, close]) => ({ time, close }));
}

async function computeWeekly200MA() {
  const daily = await fetchDailyCandlesPaged("BTC", WEEKS_NEEDED * 7);
  const weeklyCloses = toWeeklyCloses(daily);
  if (weeklyCloses.length < 50) return null;
  const window = weeklyCloses.slice(-200).map((w) => w.close);
  const sma = window.reduce((a, b) => a + b, 0) / window.length;
  const k = 2 / (window.length + 1);
  let ema = window[0];
  for (let i = 1; i < window.length; i++) ema = window[i] * k + ema * (1 - k);

  // Real, recent price history, ~75 real weeks (roughly a year and a
  // half), so a real chart can show how price has actually approached
  // and moved away from the 200-week line over time, not just a single,
  // static "here's where things stand right now" reading. Real
  // timestamps kept alongside each close now, for real date labels.
  const priceSeries = weeklyCloses.slice(-75);

  // Real, direct daily 50/200 SMA pair, the classic golden-cross /
  // death-cross basis, a genuinely different, faster basis than the
  // weekly line above, kept as its own, separate real read rather than
  // folded into it. Computed from the exact same real daily candles
  // already fetched for the weekly line, no second, separate request.
  const dailyCloses = daily.map((c) => c.close);
  let daily50 = null, daily200 = null;
  if (dailyCloses.length >= 50) {
    const w50 = dailyCloses.slice(-50);
    daily50 = w50.reduce((a, b) => a + b, 0) / w50.length;
  }
  if (dailyCloses.length >= 200) {
    const w200 = dailyCloses.slice(-200);
    daily200 = w200.reduce((a, b) => a + b, 0) / w200.length;
  }

  // Real, rolling series for the last 120 real days, both lines
  // computed at every single day in that window, not just the current
  // snapshot, so the actual moment they crossed (or didn't) is
  // something that can be drawn as a real chart. Same real daily
  // candles already fetched above, no second request.
  const SERIES_DAYS = 120;
  const dailySeries = [];
  if (dailyCloses.length >= 200 + SERIES_DAYS) {
    for (let i = dailyCloses.length - SERIES_DAYS; i < dailyCloses.length; i++) {
      const w50i = dailyCloses.slice(i - 49, i + 1);
      const w200i = dailyCloses.slice(i - 199, i + 1);
      const sma50 = w50i.reduce((a, b) => a + b, 0) / w50i.length;
      const sma200 = w200i.reduce((a, b) => a + b, 0) / w200i.length;
      dailySeries.push({ time: daily[i].time, sma50, sma200 });
    }
  }

  return { sma, ema, weeksUsed: window.length, daily50, daily200, dailySeries, priceSeries, computedAt: Date.now() };
}

export async function getWeekly200MA() {
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
    const fresh = rows.length && rows[0].value?.daily50 != null && rows[0].value?.dailySeries?.length > 0 && rows[0].value?.priceSeries?.[0]?.time != null && (Date.now() - new Date(rows[0].updated_at).getTime()) < MA_CACHE_HOURS * 3600 * 1000;
    if (fresh) return rows[0].value;

    const computed = await computeWeekly200MA();
    if (!computed) return rows.length ? rows[0].value : null;
    await sql`
      INSERT INTO macro_cache (key, value, updated_at) VALUES ('weekly_200ma', ${JSON.stringify(computed)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(computed)}::jsonb, updated_at = now()
    `;
    return computed;
  } catch {
    try { return await computeWeekly200MA(); } catch { return null; }
  }
}

export async function fetchFng() {
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1", { cache: "no-store" });
    const j = await r.json();
    const d = j.data && j.data[0];
    return d ? { value: parseInt(d.value, 10), label: d.value_classification } : null;
  } catch {
    return null;
  }
}

export async function fetchBroadMarketBias() {
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

const WHALE_OUTFLOW_WINDOW_MS = 4 * 60 * 60 * 1000;

export async function getRecentWhaleOutflow() {
  try {
    const r = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60", { headers: HEADERS, cache: "no-store" });
    if (!r.ok) return false;
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length < 30) return false;
    const candles = raw.slice().reverse().map((x) => ({ time: x[0] * 1000, open: x[3], close: x[4], volume: x[5] }));
    const cutoff = Date.now() - WHALE_OUTFLOW_WINDOW_MS;
    for (let i = 20; i < candles.length; i++) {
      const c = candles[i];
      if (c.time < cutoff) continue;
      const window = candles.slice(Math.max(0, i - 20), i);
      const avgVol = window.reduce((s, x) => s + x.volume, 0) / window.length;
      if (avgVol <= 0 || c.volume < avgVol * 4) continue;
      if (c.close >= c.open) return true;
    }
    return false;
  } catch {
    return false;
  }
}
