// app/api/scoreboard/route.js
//
// The rolling scoreboard. Visit this like /api/backtest, in a browser, any
// time. Two things happen on every visit:
//
// 1. Resolve: any signal logged in signal_track that's still "open" gets
//    checked against real, fresh Coinbase candles since it fired, same
//    target-or-stop-first logic the backtest uses, not a coarse "where's
//    the price now" shortcut.
// 2. Report: a rolling win rate per (label, timeframe, direction) bucket,
//    built from the most recent real outcomes, not a replay of history.
//
// This is deliberately a measurement surface, not a scoring input yet. The
// live app does not read from signal_track to adjust strength. Once this
// has run long enough to trust, wiring it into scoring is the natural next
// step, the same phased, measure-first pattern used for trend, bias, and
// candle shape throughout this build.
//
// Resolution only happens when this page is visited, there is no scheduled
// job running it automatically yet (that's the same cron question already
// deferred elsewhere in this project). Visiting periodically is what keeps
// this current.

import { TF, barMs } from "../../../lib/timeframes.js";

export const dynamic = "force-dynamic";

const HEADERS = { "User-Agent": "setpoint/1.0 (+https://setpoint.app)" };
const ROLLING_N = 20; // how many recent resolved outcomes count per bucket

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

async function fetchCoinbaseCandles(sym, tfKey) {
  const meta = TF[tfKey] || TF["15m"];
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
  return meta.aggFactor > 1 ? aggregate(candles, meta.gran, meta.aggFactor) : candles;
}

async function resolveOpenEntries(sql) {
  const open = await sql`SELECT id, coin, tf, dir, fired_at, entry, stop, target FROM signal_track WHERE outcome = 'open'`;
  if (!open.length) return { checked: 0, resolved: 0, errors: [] };

  const groups = new Map(); // "coin:tf" -> rows
  for (const row of open) {
    const key = `${row.coin}:${row.tf}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let resolved = 0;
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
      if (startIdx === -1) continue; // fired before the available candle window, can't resolve yet

      let outcome = null;
      for (let j = startIdx; j < candles.length; j++) {
        const c = candles[j];
        const entry = parseFloat(row.entry), stop = parseFloat(row.stop), target = parseFloat(row.target);
        const hitTarget = row.dir === "bull" ? c.high >= target : c.low <= target;
        const hitStop = row.dir === "bull" ? c.low <= stop : c.high >= stop;
        if (hitTarget && hitStop) { outcome = "loss"; break; }
        if (hitTarget) { outcome = "win"; break; }
        if (hitStop) { outcome = "loss"; break; }
      }
      if (outcome) {
        await sql`UPDATE signal_track SET outcome = ${outcome}, resolved_at = now() WHERE id = ${row.id}`;
        resolved++;
      }
    }
  }
  return { checked: open.length, resolved, errors };
}

function pct(x) {
  return x == null ? "—" : (x * 100).toFixed(0) + "%";
}

function renderHtml({ buckets, resolveInfo, totalTracked, totalOpen }) {
  const rows = buckets.map((b) => {
    return `<tr><td>${b.key}</td><td>${b.n}</td><td>${b.wins}</td><td>${b.losses}</td><td>${pct(b.winRate)}</td></tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Setpoint scoreboard</title>
  <style>
    body{background:#0A0F0D;color:#EAF2EE;font-family:-apple-system,Inter,system-ui,sans-serif;max-width:820px;margin:0 auto;padding:32px 20px 80px}
    h1{font-size:24px;margin-bottom:4px}
    .sub{color:#93A69D;font-size:13px;margin-bottom:24px}
    table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
    th{text-align:left;color:#5E7168;font-weight:600;padding:8px 10px;border-bottom:1px solid #223029;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em}
    td{padding:8px 10px;border-bottom:1px solid #151E1A;font-family:monospace}
    td:first-child{font-family:-apple-system,Inter,sans-serif}
    .err{color:#F5B851;font-size:12px}
    .note{color:#5E7168;font-size:12px;line-height:1.6;margin-top:28px;padding-top:16px;border-top:1px solid #223029}
  </style></head><body>
  <h1>Setpoint scoreboard</h1>
  <div class="sub">${totalTracked} signals logged total · ${totalOpen} still open · resolved ${resolveInfo.resolved} of ${resolveInfo.checked} pending on this visit</div>
  ${resolveInfo.errors.length ? `<div class="err">${resolveInfo.errors.join("<br>")}</div>` : ""}
  ${buckets.length ? `<table><thead><tr><th>Bucket</th><th>Last N</th><th>Won</th><th>Lost</th><th>Win rate</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="sub">No resolved outcomes yet. This fills in as signals fire live and later resolve, revisit after some real time has passed.</div>`}
  <div class="note">
    Rolling window: each bucket shows the most recent ${ROLLING_N} resolved outcomes for that exact label, timeframe, and direction, not all-time history, so it reflects how a setup has been performing lately, not years ago. This is live, real signals only, not a historical replay like /api/backtest. Resolution happens on each visit to this page, there is no background job running it automatically yet. This report is measurement only, it does not feed back into live scoring.
  </div>
  </body></html>`;
}

export async function GET() {
  const noCache = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" };
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return new Response("DATABASE_URL not set, scoreboard needs Neon.", { status: 500, headers: { "content-type": "text/plain", ...noCache } });
  }

  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    await sql`
      CREATE TABLE IF NOT EXISTS signal_track (
        id SERIAL PRIMARY KEY,
        coin TEXT NOT NULL,
        tf TEXT NOT NULL,
        label TEXT NOT NULL,
        dir TEXT NOT NULL,
        fired_at TIMESTAMPTZ NOT NULL,
        entry NUMERIC NOT NULL,
        stop NUMERIC NOT NULL,
        target NUMERIC NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'open',
        resolved_at TIMESTAMPTZ
      )
    `;

    const resolveInfo = await resolveOpenEntries(sql);

    const totalTrackedRows = await sql`SELECT COUNT(*)::int AS n FROM signal_track`;
    const totalOpenRows = await sql`SELECT COUNT(*)::int AS n FROM signal_track WHERE outcome = 'open'`;

    const resolvedRows = await sql`
      SELECT label, tf, dir, outcome
      FROM (
        SELECT label, tf, dir, outcome,
               ROW_NUMBER() OVER (PARTITION BY label, tf, dir ORDER BY resolved_at DESC) AS rn
        FROM signal_track
        WHERE outcome IN ('win', 'loss')
      ) t
      WHERE rn <= ${ROLLING_N}
    `;

    const bucketMap = new Map();
    for (const r of resolvedRows) {
      const key = `${r.label} · ${TF[r.tf]?.label || r.tf} · ${r.dir}`;
      const b = bucketMap.get(key) || { key, n: 0, wins: 0, losses: 0 };
      b.n++;
      if (r.outcome === "win") b.wins++; else b.losses++;
      bucketMap.set(key, b);
    }
    const buckets = [...bucketMap.values()]
      .map((b) => ({ ...b, winRate: b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : null }))
      .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

    const html = renderHtml({
      buckets,
      resolveInfo,
      totalTracked: totalTrackedRows[0]?.n || 0,
      totalOpen: totalOpenRows[0]?.n || 0,
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", ...noCache } });
  } catch (e) {
    return new Response(`Scoreboard error: ${String(e.message || e).slice(0, 300)}`, { status: 500, headers: { "content-type": "text/plain", ...noCache } });
  }
}
