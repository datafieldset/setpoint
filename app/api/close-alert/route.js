// app/api/close-alert/route.js
//
// Checks every open signal against real price and closes (resolves) any
// that have actually hit target or stop. This used to be a side effect
// buried inside /api/open-positions, meaning a position only got checked
// whenever someone happened to load that specific panel. Pulled out into
// its own endpoint so it can be called on its own schedule, tied to the
// main dashboard refresh (which runs on a timer regardless of whether any
// new alert is firing), not to how often new alerts happen to trigger.
// No Vercel cron needed, this rides on traffic the app already generates
// every time the dashboard is open.
import { TF, barMs } from "../../../lib/timeframes.js";

export const dynamic = "force-dynamic";

const HEADERS = { "User-Agent": "setpoint/1.0 (+https://setpoint.app)" };

async function fetchCoinbaseCandles(sym, tfKey) {
  const meta = TF[tfKey] || TF["15m"];
  const url = `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${meta.gran}`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 404 ? "not on Coinbase" : `feed ${r.status}`);
  const raw = await r.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("no data");
  return raw.slice().reverse().map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4] })).filter((c) => c.close > 0);
}

// Same fix as everywhere else this ambiguity comes up: when a candle's high
// and low both touch target and stop, drill into real 1-minute candles for
// just that bar to see which was actually touched first.
async function fetchMinuteCandles(coin, barStartMs, barEndMs, cache) {
  const key = `${coin}:${barStartMs}`;
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const url = `https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=60&start=${new Date(barStartMs).toISOString()}&end=${new Date(barEndMs).toISOString()}`;
    const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (r.ok) {
      const raw = await r.json();
      if (Array.isArray(raw) && raw.length) result = raw.slice().reverse().map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2] }));
    }
  } catch { /* result stays null, caller falls back */ }
  cache.set(key, result);
  return result;
}

function resolveFromMinuteCandles(minuteCandles, dir, target, stop) {
  if (!minuteCandles) return null;
  for (const c of minuteCandles) {
    const hitTarget = dir === "bull" ? c.high >= target : c.low <= target;
    const hitStop = dir === "bull" ? c.low <= stop : c.high >= stop;
    if (hitTarget && hitStop) continue;
    if (hitTarget) return "win";
    if (hitStop) return "loss";
  }
  return null;
}

export async function GET() {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ checked: 0, resolved: 0 }, { headers: noCache });
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    const open = await sql`SELECT id, coin, tf, dir, fired_at, entry, stop, target FROM signal_track WHERE outcome = 'open'`;
    const groups = new Map();
    for (const row of open) {
      const key = `${row.coin}:${row.tf}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const minuteCache = new Map();
    let resolvedCount = 0;
    const errors = [];
    for (const [key, rows] of groups) {
      const [coin, tf] = key.split(":");
      let candles;
      try {
        candles = await fetchCoinbaseCandles(coin, tf);
      } catch (e) {
        errors.push(`${key}: ${String(e.message || e).slice(0, 100)}`);
        continue;
      }
      for (const row of rows) {
        const firedMs = new Date(row.fired_at).getTime();
        const startIdx = candles.findIndex((c) => c.time >= firedMs);
        if (startIdx === -1) continue;
        let outcome = null;
        for (let j = startIdx; j < candles.length; j++) {
          const c = candles[j];
          const target = parseFloat(row.target), stop = parseFloat(row.stop);
          const hitTarget = row.dir === "bull" ? c.high >= target : c.low <= target;
          const hitStop = row.dir === "bull" ? c.low <= stop : c.high >= stop;
          if (hitTarget && hitStop) {
            const minuteCandles = await fetchMinuteCandles(coin, c.time, c.time + barMs(tf), minuteCache);
            outcome = resolveFromMinuteCandles(minuteCandles, row.dir, target, stop) || "loss";
            break;
          }
          if (hitTarget) { outcome = "win"; break; }
          if (hitStop) { outcome = "loss"; break; }
        }
        if (outcome) {
          await sql`UPDATE signal_track SET outcome = ${outcome}, resolved_at = now() WHERE id = ${row.id}`;
          resolvedCount++;
        }
      }
    }
    return Response.json({ checked: open.length, resolved: resolvedCount, errors }, { headers: noCache });
  } catch (e) {
    return Response.json({ checked: 0, resolved: 0, error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
