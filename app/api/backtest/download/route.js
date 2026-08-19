// app/api/backtest/download/route.js
// Serves the backtest report as a downloadable .md file
// Regenerates the report each time (same logic as /api/backtest but returns file instead of HTML)
// Password-protected same as /api/backtest, this exposes the same data as a file.

import { computeSignals, DEFAULT_TH, windowPct, marketBias, reversalRisk } from "../../../../lib/signals.js";
import { TF, barMs } from "../../../../lib/timeframes.js";
import { logNewEvents, resolveCheckpoints } from "../../whale-track/route.js";
import { fetchCoinbaseCandles, fetchMinuteCandles, resolveFromMinuteCandles, walkForwardOutcome } from "../../../../lib/resolve.js";
import { checkAuth } from "../../../../lib/access.js";

export const dynamic = "force-dynamic";

const COINS = ["BTC", "SOL", "XLM"];
const FOLLOW_BARS = 40;
const WARMUP = 30;

async function jointWalkForward(candlesByCoin, tfKey) {
  const out = [];
  const turns = [];
  const minuteCache = new Map();
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
    const risk = reversalRisk(bias, null);

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
        if (s.type === "pace") continue;

        let outcome = "open";
        const end = Math.min(candles.length, i + 1 + FOLLOW_BARS);
        for (let j = i + 1; j < end; j++) {
          const c = candles[j];
          const hitTarget = s.dir === "bull" ? c.high >= s.target : c.low <= s.target;
          const hitStop = s.dir === "bull" ? c.low <= s.stop : c.high >= s.stop;
          if (hitTarget && hitStop) {
            const minuteCandles = await fetchMinuteCandles(coin, c.time, c.time + bar, minuteCache);
            outcome = resolveFromMinuteCandles(minuteCandles, s.dir, s.target, s.stop) || "loss";
            break;
          }
          if (hitTarget) { outcome = "win"; break; }
          if (hitStop) { outcome = "loss"; break; }
        }

        const shapeClose = candles[i].close;
        const shapeOpen = candles[i].open;
        const shapeHigh = candles[i].high;
        const shapeLow = candles[i].low;
        const bodyTop = Math.max(shapeOpen, shapeClose);
        const bodyBot = Math.min(shapeOpen, shapeClose);
        const bodyPct = (bodyTop - bodyBot) / (shapeHigh - shapeLow || 1);
        const shape = bodyPct < 0.2 ? "spike" : "normal";

        out.push({ 
          coin, tf: tfKey, type: s.type, outcome, shape, tier: s.tier, strength: s.strength, 
          bias: bias.dir, biasStretch: bias.avgPct, risk: risk.level, confirmTier: s.confirmTier || null,
          volTag: s.volTag, trendTag: s.trendTag, biasTag: s.biasTag,
          label: s.label, dir: s.dir
        });
      }
    }
  }
  return { rows: out, turns };
}

function summarize(rows) {
  const buckets = {};
  
  for (const r of rows) {
    const tierLabel = r.tier === "proven" ? "Verified" : r.tier === "weak" ? "Weak" : "Testing";
    
    // Group 1: By signal type + timeframe + direction only (baseline)
    const baselineKey = `${r.label} · ${TF[r.tf]?.label || r.tf} · ${r.dir === "bull" ? "Long" : "Short"}`;
    
    // Group 2: By signal + timeframe + direction + bias condition (aligned vs against market)
    const biasCondition = r.biasTag === "with" ? "Aligned-w-bias" : r.biasTag === "against" ? "Against-bias" : "No-bias";
    const biasKey = `${baselineKey} · ${biasCondition}`;
    
    // Group 3: By signal + timeframe + direction + volume confirmation
    const volKey = `${baselineKey} · Vol:${r.volTag === "confirmed" ? "Confirmed" : r.volTag === "rising" ? "Rising" : r.volTag === "light" ? "Light" : "No-data"}`;
    
    // Group 4: By signal + timeframe + direction + trend condition
    const trendKey = `${baselineKey} · Trend:${r.trendTag === "with" ? "With-trend" : r.trendTag === "against" ? "Against-trend" : "No-trend"}`;
    
    const keys = [baselineKey, biasKey, volKey, trendKey];
    // Group 5: Reversal watch only, split by how many confirmations fired
    // (elevated = 1 real confirmation, high = 2+, or Fear & Greed stacked
    // on top of one). This is the group that actually tells us whether the
    // confirmation-gated rebuild is working, not just whether the signal
    // fires at all.
    if (r.type === "reversal" && r.confirmTier) {
      keys.push(`${baselineKey} · Confirm:${r.confirmTier === "high" ? "High" : "Elevated"}`);
    }
    
    for (const key of keys) {
      if (!buckets[key]) buckets[key] = { fired: 0, wins: 0, losses: 0, open: 0, key };
      buckets[key].fired++;
      if (r.outcome === "win") buckets[key].wins++;
      else if (r.outcome === "loss") buckets[key].losses++;
      else buckets[key].open++;
    }
  }
  
  return Object.values(buckets).map((b) => ({ 
    ...b, 
    winRate: b.fired >= 5 ? b.wins / (b.wins + b.losses) : null,
    sampleOk: b.fired >= 5
  }));
}

function pct(x) {
  return x == null ? "—" : (x * 100).toFixed(0) + "%";
}

function renderMarkdown({ buckets }) {
  const mainBuckets = buckets.filter((b) => !b.key.includes(" · Vol:") && !b.key.includes(" · Trend:") && !b.key.includes(" · Aligned") && !b.key.includes(" · Against") && !b.key.includes(" · Confirm:"));
  const winners = mainBuckets.filter((b) => b.sampleOk && b.winRate >= 0.58).sort((a, b) => b.winRate - a.winRate);
  // 48-57%: consistently close but not quite proven. This is where the
  // next real improvement usually comes from, not from what's already
  // failing outright (RSI oversold's trend gate started right here).
  const watch = mainBuckets.filter((b) => b.sampleOk && b.winRate >= 0.48 && b.winRate < 0.58).sort((a, b) => b.winRate - a.winRate);
  const losers = mainBuckets.filter((b) => b.sampleOk && b.winRate < 0.48).sort((a, b) => a.winRate - b.winRate);
  
  const biasAnalysis = buckets.filter((b) => (b.key.includes(" · Aligned") || b.key.includes(" · Against")) && b.sampleOk);
  const volumeAnalysis = buckets.filter((b) => b.key.includes(" · Vol:") && b.sampleOk);
  const trendAnalysis = buckets.filter((b) => b.key.includes(" · Trend:") && b.sampleOk);
  const reversalConfirm = buckets.filter((b) => b.key.includes(" · Confirm:")).sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

  const lines = [];
  lines.push(`# Setpoint research backtest`);
  lines.push(``);
  lines.push(`Generated ${new Date().toUTCString()}`);
  lines.push(``);

  // Winners only (58%+)
  lines.push(`## Signals that clear 58%`);
  lines.push(``);
  if (winners.length) {
    lines.push(`These are the ones worth attention. Everything below is below threshold.`);
    lines.push(``);
    for (const b of winners) {
      lines.push(`- **${b.key}**: ${b.wins}W / ${b.losses}L = ${pct(b.winRate)} (fired ${b.fired}x)`);
    }
  } else {
    lines.push(`No signals hit 58%+ in this run.`);
  }
  lines.push(``);

  // Worth improving (48-57%)
  lines.push(`## Worth improving — 48-57%`);
  lines.push(``);
  if (watch.length) {
    lines.push(`Consistently close but not quite verified, this is where the next real improvement is most likely hiding.`);
    lines.push(``);
    for (const b of watch) {
      lines.push(`- **${b.key}**: ${b.wins}W / ${b.losses}L = ${pct(b.winRate)} (fired ${b.fired}x)`);
    }
  } else {
    lines.push(`Nothing sitting in the 48-57% range this run.`);
  }
  lines.push(``);

  // A brand new signal with real, resolved trades but under 5 of them
  // used to just be silently absent from every table above, no different
  // from something that never fired at all. That's indistinguishable
  // from broken, and it's exactly what happened with Whale Flow (Aug 19).
  // Named here instead, plainly, real and resolving, just not enough yet
  // to trust a percentage on.
  const stillBuilding = mainBuckets.filter((b) => !b.sampleOk && b.fired > 0);
  if (stillBuilding.length) {
    lines.push(`## Still building a sample`);
    lines.push(``);
    lines.push(`Real, resolved trades, just not 5 of them yet, too early to trust a percentage on. Not missing, not broken, just new.`);
    lines.push(``);
    for (const b of stillBuilding) {
      lines.push(`- **${b.key}**: ${b.wins}W / ${b.losses}L (${b.fired} resolved so far)`);
    }
    lines.push(``);
  }

  // Reversal watch: always shown regardless of whether it clears 58% yet,
  // since this is the signal actively being rebuilt and tracked run to run.
  if (reversalConfirm.length) {
    lines.push(`## Reversal watch — confirmation tier breakdown`);
    lines.push(``);
    lines.push(`Rebuilt to require at least one real confirmation (volume climax, momentum deceleration, RSI divergence, or a candle streak) before firing, instead of stretch alone. Elevated = one confirmation, High = two or more. Shown regardless of whether it clears 58% yet, since this is what tells us if the rebuild is working.`);
    lines.push(``);
    lines.push(`| Setup · Tier | Fired | Won | Lost | Win rate |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const b of reversalConfirm) {
      lines.push(`| ${b.key}${b.fired < 5 ? " (low sample)" : ""} | ${b.fired} | ${b.wins} | ${b.losses} | ${pct(b.winRate)} |`);
    }
  } else {
    lines.push(`## Reversal watch`);
    lines.push(``);
    lines.push(`Didn't fire this run — no stretched market condition with a real confirmation behind it.`);
  }
  lines.push(``);

  // Bias condition breakdown for winners
  if (winners.length && biasAnalysis.length) {
    lines.push(`## How winners perform by market condition`);
    lines.push(``);
    lines.push(`Comparing aligned vs against market bias. This shows whether the signal's real edge comes from riding the market lean or fading it.`);
    lines.push(``);
    lines.push(`| Setup · Condition | Fired | Won | Lost | Win rate |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    const relevantBias = biasAnalysis.filter((b) => winners.some((w) => b.key.includes(w.key.split(" · ")[0])));
    for (const b of relevantBias.sort((a, c) => c.winRate - a.winRate)) {
      lines.push(`| ${b.key} | ${b.fired} | ${b.wins} | ${b.losses} | ${pct(b.winRate)} |`);
    }
  }
  lines.push(``);

  // Volume condition breakdown for winners
  if (winners.length && volumeAnalysis.length) {
    lines.push(`## Volume confirmation on winners`);
    lines.push(``);
    lines.push(`Does volume back the signal? Whether it matters for the winners.`);
    lines.push(``);
    lines.push(`| Setup · Volume | Fired | Won | Lost | Win rate |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    const relevantVol = volumeAnalysis.filter((b) => winners.some((w) => b.key.includes(w.key.split(" · ")[0])));
    for (const b of relevantVol.sort((a, c) => c.winRate - a.winRate)) {
      lines.push(`| ${b.key} | ${b.fired} | ${b.wins} | ${b.losses} | ${pct(b.winRate)} |`);
    }
  }
  lines.push(``);

  // Trend condition breakdown for winners
  if (winners.length && trendAnalysis.length) {
    lines.push(`## Trend condition on winners`);
    lines.push(``);
    lines.push(`Does the signal work better with or against the trend? Shows whether edge is contrarian or trend-following.`);
    lines.push(``);
    lines.push(`| Setup · Trend | Fired | Won | Lost | Win rate |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    const relevantTrend = trendAnalysis.filter((b) => winners.some((w) => b.key.includes(w.key.split(" · ")[0])));
    for (const b of relevantTrend.sort((a, c) => c.winRate - a.winRate)) {
      lines.push(`| ${b.key} | ${b.fired} | ${b.wins} | ${b.losses} | ${pct(b.winRate)} |`);
    }
  }
  lines.push(``);

  // Everything else (below 58%) for reference
  lines.push(`## Below 48% (reference only)`);
  lines.push(``);
  lines.push(`Not worth pursuing yet unless patterns show promise.`);
  lines.push(``);
  lines.push(`| Setup | Fired | Won | Lost | Win rate |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const b of losers) {
    lines.push(`| ${b.key}${b.fired < 5 ? " (low sample)" : ""} | ${b.fired} | ${b.wins} | ${b.losses} | ${pct(b.winRate)} |`);
  }

  return lines.join("\n");
}

// Live scoreboard: real signals that fired on the live dashboard, checked
// against real price since. Ported here so the download carries both real
// and replayed data in one file, same distinction the /api/backtest page
// itself now makes.
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
        id SERIAL PRIMARY KEY, coin TEXT NOT NULL, tf TEXT NOT NULL, label TEXT NOT NULL, dir TEXT NOT NULL,
        fired_at TIMESTAMPTZ NOT NULL, entry NUMERIC NOT NULL, stop NUMERIC NOT NULL, target NUMERIC NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'open', resolved_at TIMESTAMPTZ
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
      try { candles = await fetchCoinbaseCandles(coin, tf); } catch (e) { resolveInfo.errors.push(`${key}: ${String(e.message || e).slice(0, 100)}`); continue; }
      for (const row of rows) {
        const firedMs = new Date(row.fired_at).getTime();
        const target = parseFloat(row.target), stop = parseFloat(row.stop);
        const outcome = await walkForwardOutcome(candles, firedMs, row.dir, target, stop, coin, tf, minuteCache);
        if (outcome) { await sql`UPDATE signal_track SET outcome = ${outcome}, resolved_at = now() WHERE id = ${row.id}`; resolveInfo.resolved++; }
      }
    }
    const totalTrackedRows = await sql`SELECT COUNT(*)::int AS n FROM signal_track`;
    const totalOpenRows = await sql`SELECT COUNT(*)::int AS n FROM signal_track WHERE outcome = 'open'`;
    const resolvedRows = await sql`
      SELECT label, tf, dir, outcome FROM (
        SELECT label, tf, dir, outcome, ROW_NUMBER() OVER (PARTITION BY label, tf, dir ORDER BY resolved_at DESC) AS rn
        FROM signal_track WHERE outcome IN ('win', 'loss')
      ) t WHERE rn <= ${ROLLING_N}
    `;
    const bucketMap = new Map();
    for (const r of resolvedRows) {
      const key = `${r.label} · ${TF[r.tf]?.label || r.tf} · ${r.dir}`;
      const b = bucketMap.get(key) || { key, n: 0, wins: 0, losses: 0 };
      b.n++;
      if (r.outcome === "win") b.wins++; else b.losses++;
      bucketMap.set(key, b);
    }
    const buckets = [...bucketMap.values()].map((b) => ({ ...b, winRate: b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : null })).sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
    return { buckets, totalTracked: totalTrackedRows[0]?.n || 0, totalOpen: totalOpenRows[0]?.n || 0, resolveInfo };
  } catch (e) {
    return { buckets: [], totalTracked: 0, totalOpen: 0, resolveInfo: { checked: 0, resolved: 0, errors: [String(e.message || e).slice(0, 200)] } };
  }
}

function renderLiveSection(live) {
  const lines = [];
  lines.push(`## Live scoreboard`);
  lines.push(``);
  lines.push(`Real signals that fired on the live dashboard, checked against real price since. Not a replay, this is what actually happened. ${live.totalTracked} signals logged total, ${live.totalOpen} still open, resolved ${live.resolveInfo.resolved} of ${live.resolveInfo.checked} pending on this visit. Rolling window of the most recent ${ROLLING_N} outcomes per bucket.`);
  lines.push(``);
  const withSample = live.buckets.filter((b) => b.n >= 5);
  const tooFewYet = live.buckets.filter((b) => b.n < 5);
  if (withSample.length) {
    lines.push(`| Setup | Last N | Won | Lost | Win rate |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const b of withSample) lines.push(`| ${b.key} | ${b.n} | ${b.wins} | ${b.losses} | ${pct(b.winRate)} |`);
  } else {
    lines.push(`No live setup has 5+ resolved outcomes yet.`);
  }
  // A signal with real, resolved trades but under 5 of them used to just
  // vanish from this report entirely, no different from one that never
  // fired at all. That's indistinguishable from broken. Named here
  // instead, plainly, still building toward a trustworthy sample.
  if (tooFewYet.length) {
    lines.push(``);
    lines.push(`**Still building a sample (under 5 resolved, real but not enough yet):**`);
    for (const b of tooFewYet) lines.push(`- ${b.key}: ${b.wins}W / ${b.losses}L (${b.n} resolved so far)`);
  }
  return lines.join("\n") + "\n";
}

async function fetchWhaleSection() {
  const conn = process.env.DATABASE_URL;
  if (!conn) return "## Whale flow price impact\n\nDATABASE_URL not set, skipped.\n";
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    // The table and its logging/resolving logic previously only ran when
    // someone visited /api/whale-track directly, which nobody had, so the
    // table was never created and this section always failed. Running the
    // same setup here means the download alone is enough to get it working,
    // no separate page to remember to visit.
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
      // already in the table, fall through to the query below either way.
    }
    const rows = await sql`SELECT * FROM whale_track ORDER BY fired_at DESC LIMIT 200`;
    if (!rows.length) {
      return "## Whale flow price impact\n\nTable is set up now, but no whale transfers logged yet. This fills in as this file gets downloaded over time (each download also logs and resolves, same as visiting /api/whale-track directly).\n";
    }

    const pct = (fire, checkpoint) => checkpoint == null ? null : (checkpoint - fire) / fire;
    const lines = [];
    lines.push("## Whale flow price impact");
    lines.push("");
    lines.push("BTC price change at each checkpoint after a large ($500k+) individual trade on Coinbase. `to_exchange` = a large sell, `from_exchange` = a large buy. Does real buy/sell pressure actually predict what BTC does next, that's the open question this table is meant to answer.");
    lines.push("");
    const lastAt = new Date(rows[0].fired_at).getTime();
    const hoursSince = Math.floor((Date.now() - lastAt) / 3600000);
    if (hoursSince > 48) {
      lines.push(`⚠ **Stale: nothing new logged in ${hoursSince} hours.**`);
      lines.push("");
    }

    // Aggregate win rate per direction per checkpoint: does price move the
    // "expected" way (down after inflow, up after outflow) more than half
    // the time, using the same 58% bar as every other signal in this report.
    const CPS = ["15m", "30m", "1h", "4h", "12h"];
    const buckets = {};
    for (const r of rows) {
      for (const cp of CPS) {
        const checkpointPrice = r[`price_${cp}`];
        if (checkpointPrice == null) continue;
        const change = pct(parseFloat(r.btc_price_at_fire), parseFloat(checkpointPrice));
        const key = `${r.direction === "to_exchange" ? "Inflow" : "Outflow"} · ${cp}`;
        if (!buckets[key]) buckets[key] = { fired: 0, matched: 0 };
        buckets[key].fired++;
        // "Matched" = moved the traditionally-expected direction: inflow+down, outflow+up
        const expectedDown = r.direction === "to_exchange";
        if ((expectedDown && change < 0) || (!expectedDown && change > 0)) buckets[key].matched++;
      }
    }
    const bucketRows = Object.entries(buckets).filter(([, b]) => b.fired >= 5);
    if (bucketRows.length) {
      lines.push("**Does price move the traditionally-expected direction?** (inflow → down, outflow → up). 58%+ would support the current code's assumption, well under would suggest flipping it.");
      lines.push("");
      lines.push("| Direction · Checkpoint | Fired | Matched expectation | Rate |");
      lines.push("| --- | --- | --- | --- |");
      for (const [key, b] of bucketRows.sort((a, c) => (c[1].matched / c[1].fired) - (a[1].matched / a[1].fired))) {
        lines.push(`| ${key} | ${b.fired} | ${b.matched} | ${Math.round((b.matched / b.fired) * 100)}% |`);
      }
      lines.push("");
    } else {
      lines.push("Not enough resolved checkpoints yet (need 5+ per bucket) to show a rate. Individual events below.");
      lines.push("");
    }

    lines.push("| Fired | Asset | Amount | Direction | +15m | +30m | +1h | +4h | +12h |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rows.slice(0, 40)) {
      const fmt = (v) => v == null ? "—" : `${pct(parseFloat(r.btc_price_at_fire), parseFloat(v)) >= 0 ? "+" : ""}${(pct(parseFloat(r.btc_price_at_fire), parseFloat(v)) * 100).toFixed(2)}%`;
      lines.push(`| ${new Date(r.fired_at).toISOString().slice(0, 16).replace("T", " ")} | ${r.asset} | $${Math.round(r.usd_amount).toLocaleString()} | ${r.direction === "to_exchange" ? "onto" : "off"} | ${fmt(r.price_15m)} | ${fmt(r.price_30m)} | ${fmt(r.price_1h)} | ${fmt(r.price_4h)} | ${fmt(r.price_12h)} |`);
    }
    return lines.join("\n") + "\n";
  } catch (e) {
    return `## Whale flow price impact\n\nCould not load: ${String(e.message || e).slice(0, 150)}\n`;
  }
}

export async function GET(req) {
  const authFail = checkAuth(req);
  if (authFail) return authFail;

  try {
    const errors = [];
    const allRows = [];

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
      const { rows } = await jointWalkForward(candlesByCoin, tfKey);
      allRows.push(...rows);
    }

    const buckets = summarize(allRows);
    const markdown = renderMarkdown({ buckets });
    const live = await getLiveScoreboard();
    const liveSection = renderLiveSection(live);
    const whaleSection = await fetchWhaleSection();
    const fullMarkdown = markdown + "\n" + liveSection + "\n" + whaleSection;

    const filename = `setpoint-backtest-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    
    return new Response(fullMarkdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        "pragma": "no-cache",
      },
    });
  } catch (e) {
    return new Response(`Error generating backtest: ${e.message}`, { status: 500 });
  }
}
