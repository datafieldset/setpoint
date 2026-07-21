// app/api/backtest/download/route.js
// Serves the backtest report as a downloadable .md file
// Regenerates the report each time (same logic as /api/backtest but returns file instead of HTML)

import { computeSignals, DEFAULT_TH, windowPct, marketBias, reversalRisk } from "../../../../lib/signals.js";
import { TF, barMs } from "../../../../lib/timeframes.js";

export const dynamic = "force-dynamic";

const COINS = ["BTC", "SOL", "XLM"];
const FOLLOW_BARS = 40;
const WARMUP = 30;
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

function jointWalkForward(candlesByCoin, tfKey) {
  const out = [];
  const turns = [];
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
          if (hitTarget && hitStop) { outcome = "loss"; break; }
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
          bias: bias.dir, biasStretch: bias.avgPct, risk: risk.level,
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
    const tierLabel = r.tier === "proven" ? "Proven" : r.tier === "weak" ? "Weak" : "Testing";
    
    // Group 1: By signal type + timeframe + direction only (baseline)
    const baselineKey = `${r.label} · ${TF[r.tf]?.label || r.tf} · ${r.dir === "bull" ? "Long" : "Short"}`;
    
    // Group 2: By signal + timeframe + direction + bias condition (aligned vs against market)
    const biasCondition = r.biasTag === "with" ? "Aligned-w-bias" : r.biasTag === "against" ? "Against-bias" : "No-bias";
    const biasKey = `${baselineKey} · ${biasCondition}`;
    
    // Group 3: By signal + timeframe + direction + volume confirmation
    const volKey = `${baselineKey} · Vol:${r.volTag === "confirmed" ? "Confirmed" : r.volTag === "rising" ? "Rising" : r.volTag === "light" ? "Light" : "No-data"}`;
    
    // Group 4: By signal + timeframe + direction + trend condition
    const trendKey = `${baselineKey} · Trend:${r.trendTag === "with" ? "With-trend" : r.trendTag === "against" ? "Against-trend" : "No-trend"}`;
    
    for (const key of [baselineKey, biasKey, volKey, trendKey]) {
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
  const mainBuckets = buckets.filter((b) => !b.key.includes(" · Vol:") && !b.key.includes(" · Trend:") && !b.key.includes(" · Aligned") && !b.key.includes(" · Against"));
  const winners = mainBuckets.filter((b) => b.sampleOk && b.winRate >= 0.58).sort((a, b) => b.winRate - a.winRate);
  const losers = mainBuckets.filter((b) => b.sampleOk && b.winRate < 0.58).sort((a, b) => a.winRate - b.winRate);
  
  const biasAnalysis = buckets.filter((b) => (b.key.includes(" · Aligned") || b.key.includes(" · Against")) && b.sampleOk);
  const volumeAnalysis = buckets.filter((b) => b.key.includes(" · Vol:") && b.sampleOk);
  const trendAnalysis = buckets.filter((b) => b.key.includes(" · Trend:") && b.sampleOk);

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
  lines.push(`## Below 58% (reference only)`);
  lines.push(``);
  lines.push(`Not worth pursuing yet unless patterns show promise.`);
  lines.push(``);
  lines.push(`| Setup | Fired | Won | Lost | Win rate |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const b of losers.slice(0, 15)) {
    lines.push(`| ${b.key}${b.fired < 5 ? " (low sample)" : ""} | ${b.fired} | ${b.wins} | ${b.losses} | ${pct(b.winRate)} |`);
  }

  return lines.join("\n");
}

export async function GET() {
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
      const { rows } = jointWalkForward(candlesByCoin, tfKey);
      allRows.push(...rows);
    }

    const buckets = summarize(allRows);
    const markdown = renderMarkdown({ buckets });

    const filename = `setpoint-backtest-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    
    return new Response(markdown, {
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
