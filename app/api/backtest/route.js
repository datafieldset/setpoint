// app/api/backtest/route.js
//
// TEMPORARY RESEARCH TOOL — not a Setpoint product feature.
// Delete this file (and the @neondatabase/serverless dependency, if unused
// elsewhere) once the research is done. Visit it in a browser, read the
// report, no setup or files to run.
//
// What it does: pulls real historical candles from Coinbase's free public API
// (no key needed, the same source and fetch logic as app/api/market/route.js),
// and walks through that history one bar at a time calling the EXACT same
// computeSignals() used by the live dashboard, recording whether each signal
// it would have fired went on to hit its target or its stop first.
// Only the short summary (never the raw per-alert detail) gets written to
// Neon, so a future run can be compared against this one.
//
// Note: Binance was tried first, but Binance blocks US-based servers
// (HTTP 451), and Vercel's functions run from US regions by default, so every
// request was rejected outright. Coinbase is what the live dashboard already
// uses successfully from this exact deployment, so it's the reliable choice
// here too, and the 30m aggregation below is the identical logic the live
// market route uses, so this backtest's 30m now matches live exactly rather
// than approximating it from a different exchange.
//
// Honest limitations, on purpose, not hidden:
// - The early-pace volume signal needs a live, still-forming candle. Closed
//   historical bars can't fairly simulate that, so "pace" is excluded here.
// - If a single bar's high/low would have hit both the target and the stop,
//   there's no way to know which happened first from candle data alone. This
//   counts that as a loss, the conservative assumption, not the generous one.
// - Coinbase's public candle endpoint returns up to 300 bars per call, so
//   sample size is naturally smaller on slower timeframes (1h ≈ 12 days of
//   history, 5m ≈ 25 hours). Read low-sample buckets accordingly.

import { computeSignals, DEFAULT_TH } from "../../../lib/signals.js";
import { TF, barMs } from "../../../lib/timeframes.js";

export const dynamic = "force-dynamic";

const COINS = ["BTC", "SOL", "XLM"];
const FOLLOW_BARS = 40; // how many bars forward to look for a target/stop hit
const WARMUP = 30;      // matches computeSignals' own minimum history requirement
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

async function fetchCoinbaseCandles(sym, tfKey) {
  const meta = TF[tfKey] || TF["15m"];
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

function walkForward(candles, tfKey, coin) {
  const out = [];
  const bar = barMs(tfKey);
  for (let i = WARMUP; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const simNow = candles[i].time + bar; // treat bar i as freshly closed, not forming
    let signals;
    try {
      ({ signals } = computeSignals(slice, tfKey, DEFAULT_TH, { now: simNow }));
    } catch {
      continue;
    }
    for (const s of signals) {
      if (s.type === "pace") continue; // can't be fairly tested on closed history

      let outcome = "open";
      const end = Math.min(candles.length, i + 1 + FOLLOW_BARS);
      for (let j = i + 1; j < end; j++) {
        const c = candles[j];
        const hitTarget = s.dir === "bull" ? c.high >= s.target : c.low <= s.target;
        const hitStop = s.dir === "bull" ? c.low <= s.stop : c.high >= s.stop;
        if (hitTarget && hitStop) { outcome = "loss"; break; } // ambiguous same-bar case: assume the worse outcome
        if (hitTarget) { outcome = "win"; break; }
        if (hitStop) { outcome = "loss"; break; }
      }
      out.push({ coin, tfKey, type: s.type, label: s.label, dir: s.dir, volTag: s.volTag || "none", outcome });
    }
  }
  return out;
}

function summarize(rows) {
  const buckets = new Map();
  const bump = (key, outcome) => {
    const b = buckets.get(key) || { key, fired: 0, wins: 0, losses: 0, open: 0 };
    b.fired++;
    if (outcome === "win") b.wins++;
    else if (outcome === "loss") b.losses++;
    else b.open++;
    buckets.set(key, b);
  };
  for (const r of rows) {
    bump(`${r.label} · ${TF[r.tfKey]?.label || r.tfKey} · ${r.dir}`, r.outcome);
    bump(`Volume: ${r.volTag}`, r.outcome);
  }
  const list = [...buckets.values()].map((b) => ({
    ...b,
    winRate: b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : null,
  }));
  list.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
  return list;
}

async function saveToNeon(runAt, buckets) {
  const conn = process.env.DATABASE_URL;
  if (!conn) return { saved: false, reason: "DATABASE_URL not set" };
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn);
    await sql`
      CREATE TABLE IF NOT EXISTS backtest_results (
        id SERIAL PRIMARY KEY,
        run_at TIMESTAMPTZ NOT NULL,
        bucket TEXT NOT NULL,
        fired INT NOT NULL,
        wins INT NOT NULL,
        losses INT NOT NULL,
        open INT NOT NULL,
        win_rate NUMERIC
      )
    `;
    for (const b of buckets) {
      await sql`
        INSERT INTO backtest_results (run_at, bucket, fired, wins, losses, open, win_rate)
        VALUES (${runAt}, ${b.key}, ${b.fired}, ${b.wins}, ${b.losses}, ${b.open}, ${b.winRate})
      `;
    }
    const prevRow = await sql`
      SELECT DISTINCT run_at FROM backtest_results
      WHERE run_at < ${runAt}
      ORDER BY run_at DESC LIMIT 1
    `;
    let prevMap = null;
    if (prevRow.length) {
      const prevRows = await sql`
        SELECT bucket, win_rate FROM backtest_results WHERE run_at = ${prevRow[0].run_at}
      `;
      prevMap = new Map(prevRows.map((r) => [r.bucket, r.win_rate == null ? null : parseFloat(r.win_rate)]));
    }
    return { saved: true, prevMap, prevRunAt: prevRow.length ? prevRow[0].run_at : null };
  } catch (e) {
    return { saved: false, reason: String(e).slice(0, 200) };
  }
}

function pct(x) {
  return x == null ? "—" : (x * 100).toFixed(0) + "%";
}

function renderHtml({ buckets, runAt, dbInfo, errors, totalFired }) {
  const withSample = buckets.filter((b) => b.fired >= 5 && b.winRate != null);
  const worst = withSample.slice().sort((a, b) => a.winRate - b.winRate).slice(0, 4);
  const best = withSample.slice().sort((a, b) => b.winRate - a.winRate).slice(0, 4);

  const callout = (b, tag) => {
    const delta = dbInfo?.prevMap && dbInfo.prevMap.has(b.key) && dbInfo.prevMap.get(b.key) != null
      ? ` (${b.winRate > dbInfo.prevMap.get(b.key) ? "+" : ""}${Math.round((b.winRate - dbInfo.prevMap.get(b.key)) * 100)}pt vs last run)`
      : "";
    return `<div class="callout ${tag}"><span class="cb">${b.key}</span><span class="cn">${b.wins}W / ${b.losses}L (${pct(b.winRate)})${delta}</span></div>`;
  };

  const rows = buckets.map((b) => {
    const delta = dbInfo?.prevMap && dbInfo.prevMap.has(b.key) && dbInfo.prevMap.get(b.key) != null && b.winRate != null
      ? `<span class="${b.winRate >= dbInfo.prevMap.get(b.key) ? 'up' : 'down'}">${b.winRate >= dbInfo.prevMap.get(b.key) ? "+" : ""}${Math.round((b.winRate - dbInfo.prevMap.get(b.key)) * 100)}pt</span>`
      : "—";
    return `<tr><td>${b.key}${b.fired < 5 ? ' <span class="low">low sample</span>' : ""}</td><td>${b.fired}</td><td>${b.wins}</td><td>${b.losses}</td><td>${b.open}</td><td>${pct(b.winRate)}</td><td>${delta}</td></tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Setpoint research backtest</title>
  <style>
    body{background:#0A0F0D;color:#EAF2EE;font-family:-apple-system,Inter,system-ui,sans-serif;max-width:880px;margin:0 auto;padding:32px 20px 80px}
    h1{font-size:24px;margin-bottom:4px}
    .sub{color:#93A69D;font-size:13px;margin-bottom:28px}
    h2{font-size:16px;margin:32px 0 12px;color:#5EE9AE}
    .callout{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border-radius:9px;margin-bottom:8px;font-size:13.5px}
    .callout.bad{background:rgba(255,92,108,.1);border:1px solid rgba(255,92,108,.3)}
    .callout.good{background:rgba(0,209,121,.1);border:1px solid rgba(0,209,121,.3)}
    .cn{font-family:monospace;color:#93A69D;white-space:nowrap}
    table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
    th{text-align:left;color:#5E7168;font-weight:600;padding:8px 10px;border-bottom:1px solid #223029;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em}
    td{padding:8px 10px;border-bottom:1px solid #151E1A;font-family:monospace}
    td:first-child{font-family:-apple-system,Inter,sans-serif}
    .low{color:#5E7168;font-size:10px;font-family:-apple-system,sans-serif}
    .up{color:#00D179}.down{color:#FF5C6C}
    .note{color:#5E7168;font-size:12px;line-height:1.6;margin-top:28px;padding-top:16px;border-top:1px solid #223029}
    .err{color:#F5B851;font-size:12px}
  </style></head><body>
  <h1>Setpoint research backtest</h1>
  <div class="sub">Run at ${new Date(runAt).toUTCString()} · ${totalFired} signals evaluated across BTC, SOL, XLM · 5m/15m/30m/1h · this page and route are temporary</div>

  ${errors.length ? `<div class="err">${errors.join("<br>")}</div>` : ""}

  <h2>Worth a look, underperforming</h2>
  ${worst.length ? worst.map((b) => callout(b, "bad")).join("") : "<div class='sub'>Not enough fired signals yet to call out a weak spot.</div>"}

  <h2>Worth a look, outperforming</h2>
  ${best.length ? best.map((b) => callout(b, "good")).join("") : "<div class='sub'>Not enough fired signals yet to call out a strong spot.</div>"}

  <h2>Full breakdown</h2>
  <table><thead><tr><th>Bucket</th><th>Fired</th><th>Won</th><th>Lost</th><th>Open</th><th>Win rate</th><th>Vs last run</th></tr></thead>
  <tbody>${rows}</tbody></table>

  <div class="note">
    Methodology: replays real Coinbase historical candles bar by bar through the live signal engine (lib/signals.js), the same source and 30m aggregation the live dashboard uses, only ever using data available up to that point. A signal "wins" if price reaches its target before its stop within the next ${FOLLOW_BARS} bars, "loses" if stop comes first, "open" if neither happened yet. The early-pace volume signal is excluded, it needs a live forming candle that closed history can't simulate. If target and stop were both touched in the same bar, that's scored as a loss, the conservative read, since candle data alone can't say which came first. Coinbase returns up to 300 bars per call, so 1h has less history than 5m or 15m in wall-clock terms.
    ${dbInfo?.saved ? `Summary saved to Neon for comparison on the next run.` : `Not saved to Neon this run (${dbInfo?.reason || "unknown reason"}), results below are still accurate, just not persisted.`}
  </div>
  </body></html>`;
}

export async function GET() {
  const runAt = new Date();
  const errors = [];
  const allRows = [];

  for (const coin of COINS) {
    for (const tfKey of Object.keys(TF)) {
      try {
        const candles = await fetchCoinbaseCandles(coin, tfKey);
        allRows.push(...walkForward(candles, tfKey, coin));
      } catch (e) {
        errors.push(`${coin} ${tfKey}: ${String(e.message || e).slice(0, 120)}`);
      }
    }
  }

  const buckets = summarize(allRows);
  const dbInfo = await saveToNeon(runAt, buckets);

  const html = renderHtml({ buckets, runAt, dbInfo, errors, totalFired: allRows.length });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
