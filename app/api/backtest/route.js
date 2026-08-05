// app/api/backtest/route.js
//
// TEMPORARY RESEARCH TOOL — not a Setpoint product feature.
// Password-protected: this page shows win rates, live trade history, and
// signal internals not meant for public eyes. Browser will prompt for a
// username (anything) and password on first visit, or pass ?key=... the
// same way the machine-facing routes do. See lib/access.js.

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
// Also reports on: a proven/weak backtest-tier breakdown (validates the
// hand-curated table in lib/signals.js against fresh data), a strength-tier
// breakdown (tests whether the strength score itself predicts outcome), a
// candle-shape breakdown per timeframe (measurement only, flags spike-and-
// snap-back candles, not wired into live scoring yet), and a bias breakdown
// (tests the market-wide bias layer: replays all three coins for a
// timeframe together, one shared historical step at a time, so bias is
// computed from what the whole watchlist was doing at that same moment, not
// one coin replayed in isolation).
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

import { computeSignals, DEFAULT_TH, windowPct, marketBias, reversalRisk } from "../../../lib/signals.js";
import { TF, barMs } from "../../../lib/timeframes.js";
import { logNewEvents, resolveCheckpoints, aggregateWhaleDirection } from "../whale-track/route.js";
import { fetchCoinbaseCandles, fetchMinuteCandles, resolveFromMinuteCandles, walkForwardOutcome } from "../../../lib/resolve.js";
import { checkAuth } from "../../../lib/access.js";

export const dynamic = "force-dynamic";

const COINS = ["BTC", "SOL", "XLM"];
const FOLLOW_BARS = 40; // how many bars forward to look for a target/stop hit
const WARMUP = 30;      // matches computeSignals' own minimum history requirement
// Bias needs to know what the WHOLE watchlist was doing at the same
// historical instant, not just one coin in isolation, so this replays all
// coins for a timeframe together, one shared step at a time, rather than
// each coin independently. At step i, every coin's windowPct is computed
// using only that coin's own data up to and including bar i, no lookahead,
// pooled into the same marketBias() the live dashboard uses, then each
// coin's own signals are computed against that shared historical bias.
// Assumes candle arrays across coins are index-aligned in time, true in
// practice since all three are fetched with the same granularity from the
// same exchange at the same moment, both long-established Coinbase pairs.
async function jointWalkForward(candlesByCoin, tfKey) {
  const out = [];
  const turns = []; // exact moments bias.dir flipped, the thing we couldn't see before
  const bar = barMs(tfKey);
  const minuteCache = new Map();
  const coins = Object.keys(candlesByCoin).filter((c) => candlesByCoin[c] && candlesByCoin[c].length > WARMUP + 5);
  if (!coins.length) return { rows: out, turns };
  const minLen = Math.min(...coins.map((c) => candlesByCoin[c].length));
  let prevDir = null;

  for (let i = WARMUP; i < minLen - 1; i++) {
    const simNow = candlesByCoin[coins[0]][i].time + bar;

    const readings = coins.map((coin) => ({
      sym: coin,
      pct: windowPct(candlesByCoin[coin].slice(0, i + 1), 8),
      isBTC: coin === "BTC",
    }));
    const bias = marketBias(readings);
    // No historical Fear & Greed series available cheaply, so this can only
    // ever register "elevated" or "low" here, never "high" (which needs a
    // sentiment extreme too). That's an honest gap, not a bug: it still lets
    // this run test the core question, does fading a stretched bias beat
    // fading in general, just without the extra sentiment-extreme tier.
    const risk = reversalRisk(bias, null);

    // Only "bull" or "bear" count as a real lean; a flip through "none"
    // (no clear lean) isn't itself the interesting moment, the flip between
    // two opposite, clear leans is.
    if (bias.dir && bias.dir !== prevDir && (prevDir === "bull" || prevDir === "bear")) {
      turns.push({ tf: tfKey, time: simNow, from: prevDir, to: bias.dir, avgPct: bias.avgPct, pctUp: bias.pctUp });
    }
    if (bias.dir) prevDir = bias.dir;

    for (const coin of coins) {
      const candles = candlesByCoin[coin];
      const slice = candles.slice(0, i + 1);
      let signals;
      try {
        ({ signals } = computeSignals(slice, tfKey, DEFAULT_TH, { now: simNow, marketBias: bias, reversalRisk: risk }));
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
          if (hitTarget && hitStop) {
            // Real ambiguous case: drill into 1-minute candles for this
            // exact bar to see which level was actually touched first,
            // instead of assuming the worse outcome.
            const minuteCandles = await fetchMinuteCandles(coin, c.time, c.time + bar, minuteCache);
            outcome = resolveFromMinuteCandles(minuteCandles, s.dir, s.target, s.stop) || "loss"; // only falls back to loss if even 1-minute data couldn't settle it
            break;
          }
          if (hitTarget) { outcome = "win"; break; }
          if (hitStop) { outcome = "loss"; break; }
        }

        // Candle shape on the bar the signal fired on: a big high/low range with a
        // small open/close body is a spike-and-snap-back shape, the pattern the
        // Stanford settlement-manipulation study flagged on fast windows. This is
        // measurement only in this release, not wired into live scoring, until a
        // run shows it actually predicts anything.
        const sigCandle = candles[i];
        const body = Math.abs(sigCandle.close - sigCandle.open);
        const range = sigCandle.high - sigCandle.low;
        const wickRatio = range > 0 ? 1 - body / range : 0;
        const candleShape = wickRatio >= 0.5 ? "spiky" : "clean";

        const strengthTier = s.strength >= 0.5 ? "high" : s.strength >= 0.2 ? "mid" : "low";

        out.push({
          coin, tfKey, type: s.type, label: s.label, dir: s.dir,
          volTag: s.volTag || "none", trendTag: s.trendTag || "none", biasTag: s.biasTag || "none", tier: s.tier || "none",
          strengthTier, candleShape, outcome,
        });
      }
    }
  }
  return { rows: out, turns };
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
    const setupKey = `${r.label} · ${TF[r.tfKey]?.label || r.tfKey} · ${r.dir}`;
    bump(setupKey, r.outcome);
    bump(`Volume: ${r.volTag}`, r.outcome);
    bump(`Trend: ${r.trendTag}`, r.outcome);
    bump(`Bias: ${r.biasTag}`, r.outcome);
    bump(`Backtest tier: ${r.tier}`, r.outcome);
    bump(`Strength: ${r.strengthTier}`, r.outcome);
    bump(`Candle shape: ${r.candleShape} · ${TF[r.tfKey]?.label || r.tfKey}`, r.outcome);
    // The regime question: does THIS specific setup do better under some
    // market condition than others, not just what it averages to overall.
    // Same rows, same data, just split by what trend/bias looked like at
    // the exact moment it fired, instead of blended into one number.
    bump(`${setupKey} · Trend:${r.trendTag}`, r.outcome);
    bump(`${setupKey} · Bias:${r.biasTag}`, r.outcome);
  }
  const list = [...buckets.values()].map((b) => ({
    ...b,
    winRate: b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : null,
  }));
  list.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
  return list;
}

// The real test of "worth trusting": does the win rate hold up across
// several runs, not just look good once. Pulls the last CONSISTENCY_RUNS
// saved runs from Neon (the same table saveToNeon already writes), and for
// every bucket that showed up with real data in most of them, scores it as
// average win rate minus how much it swung. A high number that bounces
// around loses to a merely-decent number that doesn't move.
export const CONSISTENCY_RUNS = 6;
export const CONSISTENCY_MIN_RUNS = 3; // bucket must appear with real data in at least this many

export async function getConsistencyRanking() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return { ranked: [], reason: "DATABASE_URL not set" };
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    const rows = await sql`
      WITH recent_runs AS (
        SELECT DISTINCT run_at FROM backtest_results ORDER BY run_at DESC LIMIT ${CONSISTENCY_RUNS}
      )
      SELECT bucket,
             COUNT(*)::int AS n_runs,
             AVG(win_rate) AS avg_rate,
             (MAX(win_rate) - MIN(win_rate)) AS range,
             SUM(fired)::int AS total_fired
      FROM backtest_results
      WHERE run_at IN (SELECT run_at FROM recent_runs) AND win_rate IS NOT NULL AND fired >= 5
      GROUP BY bucket
      HAVING COUNT(*) >= ${CONSISTENCY_MIN_RUNS}
      ORDER BY (AVG(win_rate) - (MAX(win_rate) - MIN(win_rate))) DESC
    `;
    const ranked = rows.map((r) => ({
      bucket: r.bucket,
      nRuns: r.n_runs,
      avgRate: parseFloat(r.avg_rate),
      range: parseFloat(r.range),
      totalFired: r.total_fired,
      score: parseFloat(r.avg_rate) - parseFloat(r.range),
    }));
    return { ranked, reason: null };
  } catch (e) {
    return { ranked: [], reason: String(e).slice(0, 200) };
  }
}

async function saveToNeon(runAt, buckets) {
  const conn = process.env.DATABASE_URL;
  if (!conn) return { saved: false, reason: "DATABASE_URL not set" };
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
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

// Same whale_track data /api/whale-track logs and resolves, aggregated by
// direction here so the actual question, does inflow/outflow predict BTC's
// next move, gets a real answer instead of going by memory of a couple
// events. Logging/resolving is triggered from the download route (and from
// visiting /api/whale-track directly), this just reads what's there.
async function getWhaleDirectionStats() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return { dirs: null, totalLogged: 0 };
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    // This table and its logging/resolving previously only ran from the
    // download route, so visiting this page directly hit a table that was
    // never created. Same setup here now, so either path alone is enough.
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
    try {
      await logNewEvents(sql);
      await resolveCheckpoints(sql);
    } catch (e) {
      // Logging/resolving failing shouldn't block showing whatever's
      // already in the table.
    }
    const rows = await sql`SELECT * FROM whale_track ORDER BY fired_at DESC LIMIT 300`;
    return { dirs: aggregateWhaleDirection(rows), totalLogged: rows.length, lastAt: rows[0]?.fired_at || null };
  } catch (e) {
    return { dirs: null, totalLogged: 0, error: String(e.message || e).slice(0, 150) };
  }
}

// Ported from the old standalone /api/scoreboard page, which is retired as
// of this version. Two things happen on every visit here now, same as that
// page used to do on its own: resolve any signal still marked "open"
// against real, fresh Coinbase candles since it fired (the exact same
// target-or-stop-first logic the backtest above uses, not a coarse
// "where's the price now" shortcut), then report a rolling win rate per
// (label, timeframe, direction) bucket built from the most recent REAL
// outcomes. This is measurement only, real trades that actually fired
// live, not a replay of history like the rest of this page. The two are
// kept clearly labeled apart everywhere they're shown, since confusing a
// real outcome for a simulated one would be a real mistake to make.
const ROLLING_N = 20;
async function getLiveScoreboard() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return { buckets: [], totalTracked: 0, totalOpen: 0, resolveInfo: { checked: 0, resolved: 0, errors: [] } };
  const minuteCache = new Map();
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
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

    const open = await sql`SELECT id, coin, tf, dir, fired_at, entry, stop, target FROM signal_track WHERE outcome = 'open'`;
    const resolveInfo = { checked: open.length, resolved: 0, errors: [] };
    const groups = new Map();
    for (const row of open) {
      const key = `${row.coin}:${row.tf}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const [key, rows] of groups) {
      const [coin, tf] = key.split(":");
      let candles;
      try {
        candles = await fetchCoinbaseCandles(coin, tf);
      } catch (e) {
        resolveInfo.errors.push(`${key}: ${String(e.message || e).slice(0, 100)}`);
        continue;
      }
      for (const row of rows) {
        const firedMs = new Date(row.fired_at).getTime();
        const target = parseFloat(row.target), stop = parseFloat(row.stop);
        const outcome = await walkForwardOutcome(candles, firedMs, row.dir, target, stop, row.coin, tf, minuteCache);
        if (outcome) {
          await sql`UPDATE signal_track SET outcome = ${outcome}, resolved_at = now() WHERE id = ${row.id}`;
          resolveInfo.resolved++;
        }
      }
    }

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

    return { buckets, totalTracked: totalTrackedRows[0]?.n || 0, totalOpen: totalOpenRows[0]?.n || 0, resolveInfo };
  } catch (e) {
    return { buckets: [], totalTracked: 0, totalOpen: 0, resolveInfo: { checked: 0, resolved: 0, errors: [String(e.message || e).slice(0, 200)] } };
  }
}

function renderHtml({ buckets, runAt, dbInfo, errors, totalFired, turns, consistency, live, whale }) {
  const withSample = buckets.filter((b) => b.fired >= 5 && b.winRate != null && !b.key.includes(" · Trend:") && !b.key.includes(" · Bias:"));
  // Three tiers, not just winners/losers: 58%+ is the real proven bar.
  // 48-57% is a real middle zone worth attention, consistently close but
  // not quite there is exactly where an improvement (like the RSI
  // oversold trend gate) comes from, not from the ones already failing
  // outright. Under 48% collapses by default, it's not where the next
  // improvement is likely hiding.
  const proven = withSample.filter((b) => b.winRate >= 0.58).sort((a, b) => b.winRate - a.winRate);
  const watch = withSample.filter((b) => b.winRate >= 0.48 && b.winRate < 0.58).sort((a, b) => b.winRate - a.winRate);
  const collapsed = withSample.filter((b) => b.winRate < 0.48).sort((a, b) => b.winRate - a.winRate);

  const consistencyRows = (consistency?.ranked || []).map((c) => {
    return `<tr><td>${c.bucket}</td><td>${c.nRuns}</td><td>${pct(c.avgRate)}</td><td>${(c.range * 100).toFixed(0)}pt</td><td>${c.totalFired}</td></tr>`;
  }).join("");

  const regimeBuckets = buckets.filter((b) => (b.key.includes(" · Trend:") || b.key.includes(" · Bias:")) && b.fired >= 5 && b.winRate != null);
  const regimeRows = regimeBuckets
    .slice()
    .sort((a, b) => b.winRate - a.winRate)
    .map((b) => `<tr><td>${b.key}</td><td>${b.fired}</td><td>${b.wins}</td><td>${b.losses}</td><td>${pct(b.winRate)}</td></tr>`)
    .join("");

  const callout = (b, tag) => {
    const delta = dbInfo?.prevMap && dbInfo.prevMap.has(b.key) && dbInfo.prevMap.get(b.key) != null
      ? ` (${b.winRate > dbInfo.prevMap.get(b.key) ? "+" : ""}${Math.round((b.winRate - dbInfo.prevMap.get(b.key)) * 100)}pt vs last run)`
      : "";
    return `<div class="callout ${tag}"><span class="cb">${b.key}</span><span class="cn">${b.wins}W / ${b.losses}L (${pct(b.winRate)})${delta}</span></div>`;
  };

  const rows = buckets.filter((b) => !b.key.includes(" · Trend:") && !b.key.includes(" · Bias:")).map((b) => {
    const delta = dbInfo?.prevMap && dbInfo.prevMap.has(b.key) && dbInfo.prevMap.get(b.key) != null && b.winRate != null
      ? `<span class="${b.winRate >= dbInfo.prevMap.get(b.key) ? 'up' : 'down'}">${b.winRate >= dbInfo.prevMap.get(b.key) ? "+" : ""}${Math.round((b.winRate - dbInfo.prevMap.get(b.key)) * 100)}pt</span>`
      : "—";
    return `<tr><td>${b.key}${b.fired < 5 ? ' <span class="low">low sample</span>' : ""}</td><td>${b.fired}</td><td>${b.wins}</td><td>${b.losses}</td><td>${b.open}</td><td>${pct(b.winRate)}</td><td>${delta}</td></tr>`;
  }).join("");

  const sortedTurns = (turns || []).slice().sort((a, b) => b.time - a.time).slice(0, 40);
  const turnRows = sortedTurns.map((t) => {
    const flip = t.to === "bull" ? "→ bullish" : "→ bearish";
    const agreePct = t.to === "bull" ? t.pctUp : (t.pctUp != null ? 1 - t.pctUp : null);
    return `<tr><td>${new Date(t.time).toUTCString()}</td><td>${TF[t.tf]?.label || t.tf}</td><td class="${t.to}">${flip}</td><td>${t.avgPct != null ? t.avgPct.toFixed(2) + "%" : "—"}</td><td>${agreePct != null ? Math.round(agreePct * 100) + "%" : "—"}</td></tr>`;
  }).join("");

  const liveBuckets5 = (live?.buckets || []).filter((b) => b.n >= 5);
  const liveBucketsSmall = (live?.buckets || []).filter((b) => b.n < 5);
  const liveRows = (bs) => bs.map((b) => `<tr><td>${b.key}</td><td>${b.n}</td><td>${b.wins}</td><td>${b.losses}</td><td>${pct(b.winRate)}</td></tr>`).join("");
  const liveWinner = liveBuckets5.slice().sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1))[0];

  // Whale direction: does exchange inflow/outflow predict BTC's next move?
  // Real transfers, real checkpoints, testing the actual open question
  // rather than trusting either the textbook convention or a couple of
  // remembered events.
  const CP_ORDER = ["15m", "30m", "1h", "4h", "12h"];
  const whaleRows = whale?.dirs ? Object.values(whale.dirs).map((d) => {
    const cells = CP_ORDER.map((k) => {
      const c = d.cps[k];
      if (c.n < 3) return `<td class="low">n=${c.n}</td>`;
      const upRate = Math.round((c.up / c.n) * 100);
      return `<td>${upRate}% up <span class="low">(n=${c.n})</span></td>`;
    }).join("");
    return `<tr><td>${d.label}</td>${cells}</tr>`;
  }).join("") : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Setpoint research</title>
  <style>
    :root{
      --bg:#0A0F0D; --card:#0F1712; --card-2:#0D1310; --text:#EAF2EE; --muted:#93A69D; --dim:#5E7168;
      --border:#223029; --border-dim:#151E1A; --green:#00D179; --green-soft:#5EE9AE; --red:#FF5C6C; --amber:#F5B851;
    }
    *{box-sizing:border-box}
    body{background:var(--bg);color:var(--text);font-family:-apple-system,Inter,system-ui,sans-serif;max-width:960px;margin:0 auto;padding:28px 18px 90px}
    h1{font-size:22px;margin:0;letter-spacing:-.01em}
    h2{font-size:14px;margin:0 0 4px;color:var(--text);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
    .top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap}
    .sub{color:var(--muted);font-size:12.5px;margin-bottom:22px}
    .dl{background:var(--card);border:1px solid var(--border);color:var(--green-soft);font-size:12.5px;padding:9px 16px;border-radius:9px;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;gap:6px}

    .pulse{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;box-shadow:0 0 0 0 rgba(0,209,121,.6);animation:pulse 2s infinite}
    @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(0,209,121,.5)}70%{box-shadow:0 0 0 6px rgba(0,209,121,0)}100%{box-shadow:0 0 0 0 rgba(0,209,121,0)}}
    .tag{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:5px;display:inline-flex;align-items:center;gap:5px}
    .tag.live{color:var(--green-soft);background:rgba(0,209,121,.12);border:1px solid rgba(0,209,121,.3)}
    .tag.replay{color:var(--dim);background:rgba(94,113,104,.12);border:1px solid var(--border)}

    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
    .stat{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:14px 16px}
    .stat .v{font-family:monospace;font-size:22px;font-weight:600}
    .stat .l{color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
    @media (max-width:600px){.stats{grid-template-columns:repeat(2,1fr)}}

    /* Tabs: plain radio-button CSS, no JS needed. Inputs are hidden, labels
       act as clickable tab buttons, each content block only shows when its
       matching radio is checked. */
    .tabs input{display:none}
    .tabbar{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:18px;overflow-x:auto}
    .tabbar label{padding:10px 16px;font-size:12.5px;font-weight:600;color:var(--dim);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;user-select:none}
    .tab-content{display:none}
    #tab-live:checked ~ .tabbar label[for="tab-live"],
    #tab-signals:checked ~ .tabbar label[for="tab-signals"],
    #tab-market:checked ~ .tabbar label[for="tab-market"]{color:var(--green-soft);border-bottom-color:var(--green)}
    #tab-live:checked ~ #content-live,
    #tab-signals:checked ~ #content-signals,
    #tab-market:checked ~ #content-market{display:block}

    .panel{background:var(--card-2);border:1px solid var(--border);border-radius:12px;padding:18px 18px 16px;margin-bottom:16px}
    .panel.live-edge{border-left:3px solid var(--green)}
    .panel.replay-edge{border-left:3px solid var(--dim)}
    .panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:4px;flex-wrap:wrap}
    .desc{color:var(--muted);font-size:12.5px;margin-bottom:12px;line-height:1.5}

    .callout{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border-radius:9px;margin-bottom:8px;font-size:13.5px}
    .callout.bad{background:rgba(255,92,108,.1);border:1px solid rgba(255,92,108,.3)}
    .callout.good{background:rgba(0,209,121,.1);border:1px solid rgba(0,209,121,.3)}
    .callout.watch{background:rgba(245,184,81,.1);border:1px solid rgba(245,184,81,.3)}
    .callout.watch .cb{color:var(--amber)}
    details.collapse-panel{margin-top:4px}
    details.collapse-panel summary{cursor:pointer;color:var(--dim);font-size:12.5px;padding:6px 0;list-style:none}
    details.collapse-panel summary::-webkit-details-marker{display:none}
    details.collapse-panel summary::before{content:"▸ ";color:var(--dim)}
    details.collapse-panel[open] summary::before{content:"▾ "}
    .cn{font-family:monospace;color:var(--muted);white-space:nowrap}
    table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}
    th{text-align:left;color:var(--dim);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--border);text-transform:uppercase;font-size:10px;letter-spacing:.04em}
    td{padding:8px 10px;border-bottom:1px solid var(--border-dim);font-family:monospace}
    td:first-child{font-family:-apple-system,Inter,sans-serif}
    .low{color:var(--dim);font-size:10px;font-family:-apple-system,sans-serif}
    .up{color:var(--green)}.down{color:var(--red)}
    .note{color:var(--dim);font-size:12px;line-height:1.6;margin-top:26px;padding-top:16px;border-top:1px solid var(--border)}
    .err{color:var(--amber);font-size:12px;margin-bottom:14px}
    td.bull{color:var(--green);font-weight:600}
    td.bear{color:var(--red);font-weight:600}
    .empty{color:var(--dim);font-size:12.5px}
  </style></head><body class="tabs">
  <div class="top">
    <h1>Setpoint research</h1>
    <a class="dl" href="/api/backtest/download">↓ Download .md</a>
  </div>
  <div class="sub">Run at ${new Date(runAt).toUTCString()} · ${totalFired} replayed signals across BTC, SOL, XLM · 5m/15m/30m/1h</div>

  ${errors.length ? `<div class="err">${errors.join("<br>")}</div>` : ""}

  <div class="stats">
    <div class="stat"><div class="v">${totalFired}</div><div class="l">Replayed this run</div></div>
    <div class="stat"><div class="v">${live?.totalTracked || 0}</div><div class="l">Live signals logged</div></div>
    <div class="stat"><div class="v">${live?.totalOpen || 0}</div><div class="l">Still open live</div></div>
    <div class="stat"><div class="v" style="color:${liveWinner ? 'var(--green)' : 'var(--dim)'}">${liveWinner ? pct(liveWinner.winRate) : "—"}</div><div class="l">${liveWinner ? liveWinner.key.split(" · ")[0] : "Top live signal"}</div></div>
  </div>

  <input type="radio" name="t" id="tab-live" checked>
  <input type="radio" name="t" id="tab-signals">
  <input type="radio" name="t" id="tab-market">
  <div class="tabbar">
    <label for="tab-live">Scoreboard</label>
    <label for="tab-signals">Verified</label>
    <label for="tab-market">Market</label>
  </div>

  <div class="tab-content" id="content-live">
    <div class="panel live-edge">
      <div class="panel-head"><h2>Live scoreboard</h2><span class="tag live"><span class="pulse"></span>Real trades</span></div>
      <div class="desc">Signals that actually fired on the live dashboard, checked against real price action since. Not a replay, this is what really happened. Resolved on every visit to this page: ${live?.resolveInfo?.resolved || 0} of ${live?.resolveInfo?.checked || 0} pending outcomes resolved just now. Rolling window of the most recent ${ROLLING_N} outcomes per bucket.</div>
      ${live?.resolveInfo?.errors?.length ? `<div class="err">${live.resolveInfo.errors.join("<br>")}</div>` : ""}
      ${liveBuckets5.length
        ? `<table><thead><tr><th>Setup</th><th>Last N</th><th>Won</th><th>Lost</th><th>Win rate</th></tr></thead><tbody>${liveRows(liveBuckets5)}</tbody></table>`
        : `<div class="empty">No live setup has 5+ resolved outcomes yet. This fills in as signals fire and resolve over real time.</div>`}
      ${liveBucketsSmall.length ? `<details style="margin-top:10px"><summary style="color:var(--dim);font-size:11.5px;cursor:pointer">${liveBucketsSmall.length} more with under 5 resolved outcomes (low sample)</summary><table style="margin-top:8px"><thead><tr><th>Setup</th><th>Last N</th><th>Won</th><th>Lost</th><th>Win rate</th></tr></thead><tbody>${liveRows(liveBucketsSmall)}</tbody></table></details>` : ""}
    </div>

    <div class="panel live-edge">
      <div class="panel-head"><h2>Whale flow direction</h2><span class="tag live"><span class="pulse"></span>Real transfers</span></div>
      <div class="desc">Does exchange inflow or outflow actually predict BTC's next move? ${whale?.totalLogged || 0} transfers logged${whale?.lastAt ? `, most recent ${new Date(whale.lastAt).toUTCString()}` : ""}. "% up" is the share of resolved checkpoints where BTC was higher than it was the moment the transfer fired, not the traditional-convention test, the raw direction, so you can read it either way.</div>
      ${whale?.lastAt && (Date.now() - new Date(whale.lastAt).getTime()) > 48 * 3600000
        ? `<div class="err">⚠ Stale: nothing new logged in ${Math.floor((Date.now() - new Date(whale.lastAt).getTime()) / 3600000)} hours. The source this reads from (a Telegram scrape, no official API) may have broken again.</div>`
        : ""}
      ${whale?.error ? `<div class="err">${whale.error}</div>` : ""}
      ${whaleRows
        ? `<table><thead><tr><th>Direction</th><th>+15m</th><th>+30m</th><th>+1h</th><th>+4h</th><th>+12h</th></tr></thead><tbody>${whaleRows}</tbody></table>`
        : `<div class="empty">Not enough logged transfers yet. Fills in as Whale Alert posts large transfers and this page (or the download) gets visited.</div>`}
    </div>
  </div>

  <div class="tab-content" id="content-signals">
    <div class="panel replay-edge">
      <div class="panel-head"><h2>Most consistent</h2><span class="tag replay">Replay · last ${CONSISTENCY_RUNS} runs</span></div>
      <div class="desc">The trustworthy read, not one lucky run. Scored as average win rate minus how much it swung, a high number that bounces around loses to a steady one that doesn't move.</div>
      ${consistencyRows ? `<table><thead><tr><th>Bucket</th><th>Runs</th><th>Avg win rate</th><th>Swing</th><th>Total fired</th></tr></thead><tbody>${consistencyRows}</tbody></table>`
        : `<div class="empty">${consistency?.reason ? `Not available this run (${consistency.reason}).` : `Not enough saved runs yet, need at least ${CONSISTENCY_MIN_RUNS} to rank anything.`}</div>`}
    </div>

    <div class="panel replay-edge">
      <div class="panel-head"><h2>Verified — 58%+</h2><span class="tag replay">Replay</span></div>
      ${proven.length ? proven.map((b) => callout(b, "good")).join("") : "<div class='empty'>Nothing clearing 58% this run.</div>"}
    </div>

    <div class="panel replay-edge">
      <div class="panel-head"><h2>Worth improving — 48-57%</h2><span class="tag replay">Replay</span></div>
      <div class="desc">Consistently close but not quite verified, this is where the next real improvement usually comes from, not from what's already failing outright. RSI oversold's trend gate started exactly here.</div>
      ${watch.length ? watch.map((b) => callout(b, "watch")).join("") : "<div class='empty'>Nothing sitting in the 48-57% range this run.</div>"}
    </div>

    <div class="panel replay-edge">
      <div class="panel-head"><h2>Everything else</h2><span class="tag replay">Replay</span></div>
      <div class="desc">Under 48%, or too small a sample to score, collapsed by default so it doesn't crowd out what actually matters at a glance. Still all here for reference, or in the full download.</div>
      <details class="collapse-panel">
        <summary>Show full breakdown (${rows.split("</tr>").length - 1} buckets)</summary>
        <table><thead><tr><th>Bucket</th><th>Fired</th><th>Won</th><th>Lost</th><th>Open</th><th>Win rate</th><th>Vs last run</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </details>
    </div>
  </div>

  <div class="tab-content" id="content-market">
    <div class="panel replay-edge">
      <div class="panel-head"><h2>By market condition</h2><span class="tag replay">Replay</span></div>
      <div class="desc">Same setups, split by what trend and bias actually looked like the moment each one fired, not blended into one average. An overall number near 50% can be hiding a real pattern underneath, this is where that shows up.</div>
      ${regimeRows ? `<table><thead><tr><th>Setup · condition</th><th>Fired</th><th>Won</th><th>Lost</th><th>Win rate</th></tr></thead><tbody>${regimeRows}</tbody></table>`
        : `<div class="empty">Not enough fired signals with a clear trend or bias reading yet to split this out.</div>`}
    </div>

    <div class="panel replay-edge">
      <div class="panel-head"><h2>Market turning points</h2><span class="tag replay">Replay</span></div>
      <div class="desc">Every point in this replay where the shared bias flipped from bullish to bearish or back, most recent first.</div>
      ${turnRows ? `<table><thead><tr><th>When</th><th>Timeframe</th><th>Flip</th><th>Weighted move</th><th>% of watchlist agreeing</th></tr></thead><tbody>${turnRows}</tbody></table>` : `<div class="empty">No clean bullish/bearish flips in this replay window.</div>`}
    </div>
  </div>

  <div class="note">
    Methodology: the Live tab tracks signals and whale transfers that actually happened, checked against real Coinbase price action since. Signals and Market tabs replay historical candles bar by bar through the live signal engine (lib/signals.js), simulating what would have fired, only ever using data available up to that point. A replayed signal "wins" if price reaches its target before its stop within the next ${FOLLOW_BARS} bars, "loses" if stop comes first. The early-pace volume signal ("Volume building early") is excluded from the replay for the same reason it needs a live forming candle that closed history can't simulate, its real track record lives in the Live tab instead. If target and stop were both touched in the same replayed bar, that's scored as a loss, the conservative read. Coinbase returns up to 300 bars per call, so 1h has less history than 5m or 15m in wall-clock terms.
    "Reversal watch" only fires when the market's lean looks visibly stretched and at least one real confirmation (volume climax, momentum deceleration, RSI divergence, or a candle streak) backs it up. There's no cheap historical Fear & Greed series to replay, so the replay can't fully exercise every path this signal can take live.
    ${dbInfo?.saved ? `Summary saved to Neon for comparison on the next run.` : `Not saved to Neon this run (${dbInfo?.reason || "unknown reason"}), results above are still accurate, just not persisted.`}
  </div>
  </body></html>`;
}

export async function GET(req) {
  const authFail = checkAuth(req);
  if (authFail) return authFail;

  const runAt = new Date();
  const errors = [];
  const allRows = [];
  const allTurns = [];

  for (const tfKey of Object.keys(TF)) {
    const candlesByCoin = {};
    for (const coin of COINS) {
      try {
        candlesByCoin[coin] = await fetchCoinbaseCandles(coin, tfKey);
      } catch (e) {
        candlesByCoin[coin] = null;
        errors.push(`${coin} ${tfKey}: ${String(e.message || e).slice(0, 120)}`);
      }
    }
    const { rows, turns } = await jointWalkForward(candlesByCoin, tfKey);
    allRows.push(...rows);
    allTurns.push(...turns);
  }

  const buckets = summarize(allRows);
  const dbInfo = await saveToNeon(runAt, buckets);
  const consistency = await getConsistencyRanking();
  const live = await getLiveScoreboard();
  const whale = await getWhaleDirectionStats();

  const html = renderHtml({ buckets, runAt, dbInfo, errors, totalFired: allRows.length, turns: allTurns, consistency, live, whale });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // force-dynamic stops Next.js itself from pre-rendering this route,
      // but says nothing to anything downstream, Vercel's edge network, a
      // proxy, a fetch tool. Without an explicit no-store here, a plain 200
      // response can still get cached somewhere in between, which is
      // exactly why three fetches in a row came back identical, timestamped
      // to the same second, instead of three fresh replays.
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
    },
  });
}
