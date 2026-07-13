// app/api/market/route.js
// Server-side market data for Setpoint. Runs on your Next.js server, so there is
// no browser sandbox and no CORS. Coinbase public market-data endpoints, no key.
// GET /api/market?symbols=BTC,SOL,XLM&tf=15m

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { TF, isValidTf } from "../../../lib/timeframes.js";

const HEADERS = { "User-Agent": "setpoint/1.0 (+https://setpoint.app)" };

function aggregate(candles, gran, factor) {
  if (factor <= 1) return candles;
  const bucketMs = gran * factor * 1000;
  const map = new Map();
  for (const c of candles) {
    const b = Math.floor(c.time / bucketMs) * bucketMs;
    const cur = map.get(b);
    if (!cur) map.set(b, { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volumeto: c.volumeto });
    else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close; // candles are ascending, so last write is the latest close
      cur.volumeto += c.volumeto;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

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

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get("symbols") || "BTC,SOL,XLM")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 6);
  const tfParam = searchParams.get("tf");
  const tf = isValidTf(tfParam) ? tfParam : "15m";

  const coins = await Promise.all(
    symbols.map(async (sym) => {
      try {
        const [candles, stats] = await Promise.all([fetchCandles(sym, tf), fetchStats(sym)]);
        return { sym, candles, stats, error: null };
      } catch (e) {
        return { sym, candles: [], stats: null, error: e.message || "failed" };
      }
    })
  );

  const fng = await fetchFng();
  return Response.json({ coins, fng, tf, at: Date.now() });
}
