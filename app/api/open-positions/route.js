// app/api/open-positions/route.js
//
// Returns signals that fired and are still open (haven't hit target or
// stop yet), read from signal_track. The live dashboard's Opportunities
// feed only shows conditions that are true RIGHT NOW, the moment a
// signal's trigger condition stops being true, it disappears from that
// feed even though the trade itself is still live and unresolved.
// Paying members watching a paper trade need to see it stay visible until
// it actually resolves, that's what this route and the Open positions
// panel on the dashboard are for.
//
// This route resolves trades itself before returning them. It used to
// only ever read whatever was already in the table, resolution only ran
// when someone visited the password-protected backtest research page.
// That meant a position could blow straight through its stop and just
// sit there marked "open" for hours or days until someone happened to
// visit that internal page. This is the page paying members are actually
// watching, it needs to keep itself current on every poll.
//
// signal_track never stored tier/win-rate at fire time, only the raw
// trade (coin, tf, label, dir, entry, stop, target). That's fine, tier is
// a pure lookup by label+timeframe+direction against the current
// SIGNAL_RATES table, so it's looked up fresh here instead, which also
// means it reflects the latest table data, not a stale snapshot from
// whenever the alert originally fired.
import { provenContext } from "../../../lib/signals.js";
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
// just that bar to see which was actually touched first, instead of
// assuming the worse outcome.
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

async function resolveOpenPositions(sql) {
  const open = await sql`SELECT id, coin, tf, dir, fired_at, entry, stop, target FROM signal_track WHERE outcome = 'open'`;
  const groups = new Map();
  for (const row of open) {
    const key = `${row.coin}:${row.tf}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const minuteCache = new Map();
  for (const [key, rows] of groups) {
    const [coin, tf] = key.split(":");
    let candles;
    try { candles = await fetchCoinbaseCandles(coin, tf); } catch { continue; }
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
      if (outcome) await sql`UPDATE signal_track SET outcome = ${outcome}, resolved_at = now() WHERE id = ${row.id}`;
    }
  }
}

export async function GET() {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ positions: [] }, { headers: noCache });
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    await resolveOpenPositions(sql);
    const rows = await sql`
      SELECT coin, tf, label, dir, fired_at, entry, stop, target
      FROM signal_track
      WHERE outcome = 'open'
      ORDER BY fired_at DESC
      LIMIT 100
    `;
    const positions = rows.map((r) => {
      const pc = provenContext(r.label, r.tf, r.dir);
      return {
        coin: r.coin,
        tf: r.tf,
        label: r.label,
        dir: r.dir,
        firedAt: new Date(r.fired_at).getTime(),
        entry: parseFloat(r.entry),
        stop: parseFloat(r.stop),
        target: parseFloat(r.target),
        tier: pc.tag,
        tierRate: pc.rate,
      };
    });
    return Response.json({ positions }, { headers: noCache });
  } catch (e) {
    return Response.json({ positions: [], error: String(e.message || e).slice(0, 150) }, { headers: noCache });
  }
}
