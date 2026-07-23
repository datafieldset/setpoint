// app/api/whale-track/route.js
//
// Whale flow price-impact tracker. Visit this like /api/scoreboard, any
// time. Two things happen on every visit:
//
// 1. Log: every whale transfer Whale Alert has posted (via the same free
//    Telegram feed /api/news already reads) gets logged once, deduped by
//    its Telegram link so repeated visits don't double-count the same
//    transfer.
// 2. Resolve: any logged transfer that's old enough gets checked against
//    real BTC candles at 15m, 30m, 1h, 4h, and 12h after it fired, filling
//    in whatever checkpoints have had enough time pass.
//
// Why BTC specifically, regardless of which asset the whale actually
// moved: the open question here isn't "does an ETH whale move affect ETH
// price," it's whether large exchange flow in general is a useful market
// read, and BTC is the cleanest, most liquid bellwether for that. Same
// reasoning the existing pooled net-flow panel in Market Context already
// uses, just extended to check price outcome instead of stopping at "here
// was the flow."
//
// This is deliberately a measurement surface, not a scoring input. Nothing
// live reads from whale_track to adjust anything yet. Same phased,
// measure-first pattern as signal_track/scoreboard.
//
// Resolution only happens when this page is visited, no scheduled job
// running it automatically (same cron question already deferred elsewhere
// in this project).

import { getTelegram } from "../news/route.js";

export const dynamic = "force-dynamic";

const HEADERS = { "User-Agent": "setpoint/1.0 (+https://setpoint.app)" };
const CHECKPOINTS = [
  { key: "15m", ms: 15 * 60 * 1000, bars: 1 },
  { key: "30m", ms: 30 * 60 * 1000, bars: 2 },
  { key: "1h", ms: 60 * 60 * 1000, bars: 4 },
  { key: "4h", ms: 4 * 60 * 60 * 1000, bars: 16 },
  { key: "12h", ms: 12 * 60 * 60 * 1000, bars: 48 },
];
const EXCHANGES = ["binance", "coinbase", "kraken", "okx", "bybit", "huobi", "htx", "bitfinex", "gate.io", "gate", "kucoin", "upbit", "bitstamp", "gemini", "crypto.com", "mexc", "bithumb", "bitget"];

// Same parse logic as /api/news, kept local so a change to the news route's
// own parsing can't silently break how whale transfers are read here.
function parseWhale(text, when, link) {
  const matches = [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*[#$]?([A-Za-z]{2,6})\b/g)];
  const pick = matches.find((m) => m[2].toUpperCase() !== "USD");
  if (!pick) return null;
  const asset = pick[2].toUpperCase();
  const usdM = text.match(/\(?\$?\s*([\d,]+(?:\.\d+)?)\s*USD/i);
  const usd = usdM ? parseFloat(usdM[1].replace(/,/g, "")) : null;
  const low = text.toLowerCase();
  const ft = low.match(/from\s+(.+?)\s+to\s+(.+)$/);
  let dir = "other";
  if (ft) {
    const fromEx = EXCHANGES.some((e) => ft[1].includes(e));
    const toEx = EXCHANGES.some((e) => ft[2].includes(e));
    if (toEx && !fromEx) dir = "to_exchange";
    else if (fromEx && !toEx) dir = "from_exchange";
    else if (fromEx && toEx) dir = "exchange_move";
  }
  return { asset, usd, dir, when, link };
}

async function getWhaleTransfers() {
  const tg = await getTelegram(["whale_alert_io"]);
  return tg.map((x) => parseWhale(x.title, x.when, x.link)).filter(Boolean);
}

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
      cur.close = c.close;
      cur.volumeto += c.volumeto;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function fetchBtc15m() {
  const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900`;
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`feed ${r.status}`);
  const raw = await r.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("no data");
  return raw
    .slice()
    .reverse()
    .map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4], volumeto: x[5] }))
    .filter((c) => c.close > 0);
}

export async function logNewEvents(sql) {
  const parsed = (await getWhaleTransfers()).filter((w) => w.usd != null && (w.dir === "to_exchange" || w.dir === "from_exchange"));
  if (!parsed.length) return { found: 0, inserted: 0 };

  let candles;
  try {
    candles = await fetchBtc15m();
  } catch {
    return { found: parsed.length, inserted: 0, error: "could not fetch BTC price to log against" };
  }
  const btcNow = candles[candles.length - 1]?.close;
  if (!btcNow) return { found: parsed.length, inserted: 0, error: "no current BTC price" };

  let inserted = 0;
  for (const w of parsed) {
    const result = await sql`
      INSERT INTO whale_track (link, asset, usd_amount, direction, fired_at, btc_price_at_fire)
      VALUES (${w.link}, ${w.asset}, ${w.usd}, ${w.dir}, ${new Date(w.when)}, ${btcNow})
      ON CONFLICT (link) DO NOTHING
      RETURNING id
    `;
    if (result.length) inserted++;
  }
  return { found: parsed.length, inserted };
}

export async function resolveCheckpoints(sql) {
  const pending = await sql`
    SELECT id, fired_at FROM whale_track
    WHERE resolved_12h = FALSE
  `;
  if (!pending.length) return { checked: 0, resolved: 0 };

  let candles;
  try {
    candles = await fetchBtc15m();
  } catch {
    return { checked: pending.length, resolved: 0, error: "could not fetch BTC price to resolve" };
  }

  let resolved = 0;
  for (const row of pending) {
    const firedMs = new Date(row.fired_at).getTime();
    const startIdx = candles.findIndex((c) => c.time >= firedMs);
    if (startIdx === -1) continue; // fired before the available candle window

    const updates = {};
    let anyResolved = false;
    for (const cp of CHECKPOINTS) {
      const elapsed = Date.now() - firedMs;
      if (elapsed < cp.ms) continue; // not enough time has passed yet
      const idx = startIdx + cp.bars;
      if (idx >= candles.length) continue; // don't have that far forward yet
      updates[cp.key] = candles[idx].close;
      anyResolved = true;
    }
    if (!anyResolved) continue;

    await sql`
      UPDATE whale_track SET
        price_15m = COALESCE(${updates["15m"] ?? null}, price_15m),
        price_30m = COALESCE(${updates["30m"] ?? null}, price_30m),
        price_1h = COALESCE(${updates["1h"] ?? null}, price_1h),
        price_4h = COALESCE(${updates["4h"] ?? null}, price_4h),
        price_12h = COALESCE(${updates["12h"] ?? null}, price_12h),
        resolved_15m = resolved_15m OR ${updates["15m"] != null},
        resolved_30m = resolved_30m OR ${updates["30m"] != null},
        resolved_1h = resolved_1h OR ${updates["1h"] != null},
        resolved_4h = resolved_4h OR ${updates["4h"] != null},
        resolved_12h = resolved_12h OR ${updates["12h"] != null}
      WHERE id = ${row.id}
    `;
    resolved++;
  }
  return { checked: pending.length, resolved };
}

function pct(x) {
  return x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
}

// Aggregates whale_track by direction: does exchange inflow/outflow actually
// predict which way BTC moves next, checked at each real checkpoint. This is
// the actual test of Na's real observation (offboard → bearish, onboard →
// bullish), which runs opposite to the standard on-chain convention, real
// data settles it either way instead of going by memory of a couple events.
export function aggregateWhaleDirection(rows) {
  const dirs = { to_exchange: { label: "Onto exchange (inflow)", cps: {} }, from_exchange: { label: "Off exchange (outflow)", cps: {} } };
  const CP_KEYS = ["15m", "30m", "1h", "4h", "12h"];
  for (const d of Object.values(dirs)) for (const k of CP_KEYS) d.cps[k] = { n: 0, up: 0, down: 0, flat: 0 };

  for (const r of rows) {
    const bucket = dirs[r.direction];
    if (!bucket) continue;
    for (const k of CP_KEYS) {
      const priceKey = `price_${k}`;
      const cp = r[priceKey];
      if (cp == null) continue;
      const change = (cp - r.btc_price_at_fire) / r.btc_price_at_fire;
      bucket.cps[k].n++;
      if (change > 0.001) bucket.cps[k].up++;
      else if (change < -0.001) bucket.cps[k].down++;
      else bucket.cps[k].flat++;
    }
  }
  return dirs;
}


function renderHtml({ rows, logInfo, resolveInfo, totalLogged }) {
  const tableRows = rows.map((r) => {
    const change = (checkpointPrice) => checkpointPrice == null ? null : (checkpointPrice - r.btc_price_at_fire) / r.btc_price_at_fire;
    return `<tr>
      <td>${new Date(r.fired_at).toUTCString().slice(0, 22)}</td>
      <td>${r.asset}</td>
      <td>$${Number(r.usd_amount).toLocaleString()}</td>
      <td>${r.direction === "to_exchange" ? "onto exchange" : "off exchange"}</td>
      <td class="mono">${pct(change(r.price_15m))}</td>
      <td class="mono">${pct(change(r.price_30m))}</td>
      <td class="mono">${pct(change(r.price_1h))}</td>
      <td class="mono">${pct(change(r.price_4h))}</td>
      <td class="mono">${pct(change(r.price_12h))}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Setpoint whale tracker</title>
  <style>
    body{background:#0A0F0D;color:#EAF2EE;font-family:-apple-system,Inter,system-ui,sans-serif;max-width:1000px;margin:0 auto;padding:32px 20px 80px}
    h1{font-size:24px;margin-bottom:4px}
    .sub{color:#93A69D;font-size:13px;margin-bottom:24px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    th{text-align:left;color:#5E7168;font-weight:600;padding:8px 10px;border-bottom:1px solid #223029;text-transform:uppercase;font-size:10px;letter-spacing:.04em}
    td{padding:8px 10px;border-bottom:1px solid #151E1A}
    .mono{font-family:monospace}
    .err{color:#F5B851;font-size:12px}
    .note{color:#5E7168;font-size:12px;line-height:1.6;margin-top:28px;padding-top:16px;border-top:1px solid #223029}
  </style></head><body>
  <h1>Setpoint whale tracker</h1>
  <div class="sub">${totalLogged} whale transfers logged total · found ${logInfo.found} on this visit (${logInfo.inserted} new) · resolved checkpoints on ${resolveInfo.resolved} of ${resolveInfo.checked} pending</div>
  ${logInfo.error ? `<div class="err">Log: ${logInfo.error}</div>` : ""}
  ${resolveInfo.error ? `<div class="err">Resolve: ${resolveInfo.error}</div>` : ""}
  ${rows.length ? `<table><thead><tr><th>Fired</th><th>Asset</th><th>Amount</th><th>Direction</th><th>+15m</th><th>+30m</th><th>+1h</th><th>+4h</th><th>+12h</th></tr></thead><tbody>${tableRows}</tbody></table>`
    : `<div class="sub">No whale transfers logged yet. This fills in as Whale Alert posts large transfers and gets visited periodically.</div>`}
  <div class="note">
    BTC price change is shown at each checkpoint, regardless of which asset the whale actually moved, since the question being tested is whether large exchange flow in general predicts BTC direction, the market's bellwether. A blank cell means that checkpoint hasn't had enough time pass yet. This is live, real transfers only, resolution happens on each visit to this page, no background job runs it automatically. Measurement only, does not feed back into live scoring.
  </div>
  </body></html>`;
}

export async function GET() {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return new Response("DATABASE_URL not set, whale tracker needs Neon.", { status: 500, headers: { "content-type": "text/plain", ...noCache } });
  }

  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    await sql`
      CREATE TABLE IF NOT EXISTS whale_track (
        id SERIAL PRIMARY KEY,
        link TEXT UNIQUE NOT NULL,
        asset TEXT NOT NULL,
        usd_amount NUMERIC NOT NULL,
        direction TEXT NOT NULL,
        fired_at TIMESTAMPTZ NOT NULL,
        btc_price_at_fire NUMERIC NOT NULL,
        price_15m NUMERIC,
        price_30m NUMERIC,
        price_1h NUMERIC,
        price_4h NUMERIC,
        price_12h NUMERIC,
        resolved_15m BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_30m BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_1h BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_4h BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_12h BOOLEAN NOT NULL DEFAULT FALSE
      )
    `;

    const logInfo = await logNewEvents(sql);
    const resolveInfo = await resolveCheckpoints(sql);

    const totalRows = await sql`SELECT COUNT(*)::int AS n FROM whale_track`;
    const rows = await sql`SELECT * FROM whale_track ORDER BY fired_at DESC LIMIT 100`;

    const html = renderHtml({ rows, logInfo, resolveInfo, totalLogged: totalRows[0]?.n || 0 });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", ...noCache } });
  } catch (e) {
    return new Response(`Whale tracker error: ${String(e.message || e).slice(0, 300)}`, { status: 500, headers: { "content-type": "text/plain", ...noCache } });
  }
}
