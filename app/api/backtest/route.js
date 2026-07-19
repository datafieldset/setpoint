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
function jointWalkForward(candlesByCoin, tfKey) {
  const out = [];
  const turns = []; // exact moments bias.dir flipped, the thing we couldn't see before
  const bar = barMs(tfKey);
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
          if (hitTarget && hitStop) { outcome = "loss"; break; } // ambiguous same-bar case: assume the worse outcome
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
    const sql = neon(conn);
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

function renderHtml({ buckets, runAt, dbInfo, errors, totalFired, turns, consistency }) {
  const withSample = buckets.filter((b) => b.fired >= 5 && b.winRate != null && !b.key.includes(" · Trend:") && !b.key.includes(" · Bias:"));
  const worst = withSample.slice().sort((a, b) => a.winRate - b.winRate).slice(0, 4);
  const best = withSample.slice().sort((a, b) => b.winRate - a.winRate).slice(0, 4);

  const consistencyRows = (consistency?.ranked || []).map((c) => {
    return `<tr><td>${c.bucket}</td><td>${c.nRuns}</td><td>${pct(c.avgRate)}</td><td>${(c.range * 100).toFixed(0)}pt</td><td>${c.totalFired}</td></tr>`;
  }).join("");

  // Same setups, split by what the market condition actually was when each
  // one fired, not blended into one average. This is what finds a real
  // regime-dependent pattern that an averaged number can hide completely.
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
    return `<tr><td>${new Date(t.time).toUTCString()}</td><td>${TF[t.tf]?.label || t.tf}</td><td class="${t.to}">${flip}</td><td>${t.avgPct != null ? t.avgPct.toFixed(2) + "%" : "—"}</td><td>${t.pctUp != null ? Math.round(t.pctUp * 100) + "%" : "—"}</td></tr>`;
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
    td.bull{color:#00D179;font-weight:600}
    td.bear{color:#FF5C6C;font-weight:600}
  </style></head><body>
  <h1>Setpoint research backtest</h1>
  <div class="sub">Run at ${new Date(runAt).toUTCString()} · ${totalFired} signals evaluated across BTC, SOL, XLM · 5m/15m/30m/1h · this page and route are temporary</div>

  ${errors.length ? `<div class="err">${errors.join("<br>")}</div>` : ""}

  <h2>Most consistent, across the last ${CONSISTENCY_RUNS} runs</h2>
  <div class="sub" style="margin-bottom:12px">This is the trustworthy read, not one lucky run. Scored as average win rate minus how much it swung, a high number that bounces around loses to a steady one that doesn't move.</div>
  ${consistencyRows ? `<table><thead><tr><th>Bucket</th><th>Runs</th><th>Avg win rate</th><th>Swing</th><th>Total fired</th></tr></thead><tbody>${consistencyRows}</tbody></table>`
    : `<div class="sub">${consistency?.reason ? `Not available this run (${consistency.reason}).` : `Not enough saved runs yet, need at least ${CONSISTENCY_MIN_RUNS} to rank anything.`}</div>`}

  <h2>Worth a look, underperforming</h2>
  ${worst.length ? worst.map((b) => callout(b, "bad")).join("") : "<div class='sub'>Not enough fired signals yet to call out a weak spot.</div>"}

  <h2>Worth a look, outperforming</h2>
  ${best.length ? best.map((b) => callout(b, "good")).join("") : "<div class='sub'>Not enough fired signals yet to call out a strong spot.</div>"}

  <h2>By market condition</h2>
  <div class="sub" style="margin-bottom:12px">Same setups, split by what trend and bias actually looked like the moment each one fired, not blended into one average. An overall number near 50% can be hiding a real pattern underneath, this is where that shows up.</div>
  ${regimeRows ? `<table><thead><tr><th>Setup · condition</th><th>Fired</th><th>Won</th><th>Lost</th><th>Win rate</th></tr></thead><tbody>${regimeRows}</tbody></table>`
    : `<div class="sub">Not enough fired signals with a clear trend or bias reading yet to split this out.</div>`}

  <h2>Market turning points</h2>
  <div class="sub" style="margin-bottom:12px">Every point in this replay where the shared bias flipped from bullish to bearish or back, most recent first. This is the thing we could only infer sideways before, comparing whole runs days apart. Now you can point at the exact hour it happened and go look at what the data was doing right before it.</div>
  ${turnRows ? `<table><thead><tr><th>When</th><th>Timeframe</th><th>Flip</th><th>Weighted move</th><th>% of watchlist agreeing</th></tr></thead><tbody>${turnRows}</tbody></table>` : `<div class="sub">No clean bullish/bearish flips in this replay window.</div>`}

  <h2>Full breakdown</h2>
  <table><thead><tr><th>Bucket</th><th>Fired</th><th>Won</th><th>Lost</th><th>Open</th><th>Win rate</th><th>Vs last run</th></tr></thead>
  <tbody>${rows}</tbody></table>

  <div class="note">
    Methodology: replays real Coinbase historical candles bar by bar through the live signal engine (lib/signals.js), the same source and 30m aggregation the live dashboard uses, only ever using data available up to that point. A signal "wins" if price reaches its target before its stop within the next ${FOLLOW_BARS} bars, "loses" if stop comes first, "open" if neither happened yet. The early-pace volume signal is excluded, it needs a live forming candle that closed history can't simulate. If target and stop were both touched in the same bar, that's scored as a loss, the conservative read, since candle data alone can't say which came first. Coinbase returns up to 300 bars per call, so 1h has less history than 5m or 15m in wall-clock terms.
    Also reports on: a "Backtest tier" breakdown (validates the proven/weak combination table against fresh data), a "Strength" breakdown (tests whether the strength score itself predicts outcome), a "Candle shape" breakdown per timeframe (measurement only, flags spike-and-snap-back candles, not wired into live scoring), and a "Bias" breakdown testing the market-wide bias layer: at every historical step, all three coins' own recent moves are pooled into the same shared bias reading the live dashboard uses, computed from only the data available at that point, then each coin's signals are checked against it. This assumes each coin's candle series lines up in time with the others, true in practice since all three are fetched with the same granularity from the same exchange.
    New this run: "Reversal watch" is a distinct signal, not a scoring tweak, that only fires when the market's lean looks visibly stretched, testing a specific idea, that fading a stretched extreme is a real, separate opportunity from fading in general. Compare its own "Reversal watch" rows below against the existing "Bias: against" row to see whether stretched-only fades actually beat fading whenever direction merely disagrees. One honest gap: there's no cheap historical Fear & Greed series to replay, so this backtest can only ever register the "elevated" stretch tier, never "high" (which live also requires a sentiment extreme), so the strongest version of this idea isn't fully testable here yet, only live.
    ${dbInfo?.saved ? `Summary saved to Neon for comparison on the next run.` : `Not saved to Neon this run (${dbInfo?.reason || "unknown reason"}), results below are still accurate, just not persisted.`}
  </div>
  </body></html>`;
}

export async function GET() {
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
    const { rows, turns } = jointWalkForward(candlesByCoin, tfKey);
    allRows.push(...rows);
    allTurns.push(...turns);
  }

  const buckets = summarize(allRows);
  const dbInfo = await saveToNeon(runAt, buckets);
  const consistency = await getConsistencyRanking();

  const html = renderHtml({ buckets, runAt, dbInfo, errors, totalFired: allRows.length, turns: allTurns, consistency });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
