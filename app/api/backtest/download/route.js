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

        out.push({ coin, tf: tfKey, type: s.type, outcome, shape, proven: s.proven, strength: s.strength, bias: bias.dir, risk: risk?.tier });
      }
    }
  }
  return { rows: out, turns };
}

function summarize(rows) {
  const buckets = {};
  for (const r of rows) {
    const key = `${r.coin} · ${TF[r.tf]?.label || r.tf} · ${r.type}${r.proven ? " · Proven" : " · Weak"}${r.bias ? ` · Bias: ${r.bias === "bull" ? "with" : "against"}` : ""}${r.risk ? ` · Bias: ${r.risk}` : ""}`;
    if (!buckets[key]) buckets[key] = { fired: 0, wins: 0, losses: 0, open: 0, key };
    buckets[key].fired++;
    if (r.outcome === "win") buckets[key].wins++;
    else if (r.outcome === "loss") buckets[key].losses++;
    else buckets[key].open++;
  }
  return Object.values(buckets).map((b) => ({ ...b, winRate: b.fired >= 5 ? b.wins / (b.wins + b.losses) : null }));
}

function pct(x) {
  return x == null ? "—" : (x * 100).toFixed(0) + "%";
}

function renderMarkdown({ buckets }) {
  const withSample = buckets.filter((b) => b.fired >= 5 && b.winRate != null && !b.key.includes(" · Trend:") && !b.key.includes(" · Bias:"));
  const worst = withSample.slice().sort((a, b) => a.winRate - b.winRate).slice(0, 4);
  const best = withSample.slice().sort((a, b) => b.winRate - a.winRate).slice(0, 4);
  const mainRows = buckets.filter((b) => !b.key.includes(" · Trend:") && !b.key.includes(" · Bias:"));

  const lines = [];
  lines.push(`# Setpoint research backtest`);
  lines.push(``);
  lines.push(`Generated ${new Date().toUTCString()}`);
  lines.push(``);

  lines.push(`## Worth a look, underperforming`);
  lines.push(``);
  lines.push(worst.length ? worst.map((b) => `- ${b.key}: ${b.wins}W / ${b.losses}L (${pct(b.winRate)})`).join("\n") : `Not enough fired signals yet.`);
  lines.push(``);

  lines.push(`## Worth a look, outperforming`);
  lines.push(``);
  lines.push(best.length ? best.map((b) => `- ${b.key}: ${b.wins}W / ${b.losses}L (${pct(b.winRate)})`).join("\n") : `Not enough fired signals yet.`);
  lines.push(``);

  lines.push(`## Full breakdown`);
  lines.push(``);
  lines.push(`| Bucket | Fired | Won | Lost | Open | Win rate |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const b of mainRows) {
    lines.push(`| ${b.key}${b.fired < 5 ? " (low sample)" : ""} | ${b.fired} | ${b.wins} | ${b.losses} | ${b.open} | ${pct(b.winRate)} |`);
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
