// app/api/watchlist/route.js
//
// The backtest report has everything. This page has just the answer to one
// question: what's actually worth watching right now. Visit it any time,
// same as /api/backtest, it reads the same consistency data, just filtered
// down to a plain yes/no/not-yet.
//
// "Trustworthy" here means two things at once, not one: a real average AND
// low run-to-run swing. A high average alone isn't enough, that's exactly
// the trap RSI oversold 5m bull exposed, 70% average, but a 26-point swing
// means it could just as easily read 44% or 96% next time.

import { getConsistencyRanking, CONSISTENCY_RUNS } from "../backtest/route.js";
import { PROVEN_COMBOS, WEAK_COMBOS } from "../../../lib/signals.js";

export const dynamic = "force-dynamic";

const TRUST_MIN_AVG = 0.60;
const TRUST_MAX_SWING = 0.15; // 15 points; above this, a high average isn't trustworthy yet

function pct(x) {
  return x == null ? "—" : (x * 100).toFixed(0) + "%";
}

function renderHtml({ liveNow, trustworthy, promising, reason }) {
  const row = (r) => `<tr><td>${r.bucket}</td><td>${pct(r.avgRate)}</td><td>${(r.range * 100).toFixed(0)}pt</td><td>${r.totalFired}</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Setpoint watchlist</title>
  <style>
    body{background:#0A0F0D;color:#EAF2EE;font-family:-apple-system,Inter,system-ui,sans-serif;max-width:760px;margin:0 auto;padding:32px 20px 80px}
    h1{font-size:24px;margin-bottom:4px}
    .sub{color:#93A69D;font-size:13px;margin-bottom:24px;line-height:1.6}
    h2{font-size:16px;margin:28px 0 10px;color:#5EE9AE}
    table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}
    th{text-align:left;color:#5E7168;font-weight:600;padding:8px 10px;border-bottom:1px solid #223029;text-transform:uppercase;font-size:10px;letter-spacing:.04em}
    td{padding:8px 10px;border-bottom:1px solid #151E1A;font-family:monospace}
    td:first-child{font-family:-apple-system,Inter,sans-serif}
    .empty{color:#5E7168;font-size:12.5px;line-height:1.6;padding:14px;border:1px dashed #223029;border-radius:8px}
    .note{color:#5E7168;font-size:12px;line-height:1.6;margin-top:28px;padding-top:16px;border-top:1px solid #223029}
    .badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:5px;margin-left:8px;vertical-align:middle}
    .badge.live{color:#03110B;background:#00D179}
  </style></head><body>
  <h1>Setpoint watchlist</h1>
  <div class="sub">What's actually worth watching right now, based on the last ${CONSISTENCY_RUNS} backtest runs. Not a trading signal in itself, just the honest current answer to "what do I trust."</div>

  ${reason ? `<div class="empty">Consistency data not available right now (${reason}). Run /api/backtest a few times first, this needs at least a few saved runs to say anything.</div>` : `

  <h2>Live in the app right now <span class="badge live">what's actually showing</span></h2>
  ${liveNow.length ? `<table><thead><tr><th>Bucket</th><th>Avg win rate</th><th>Swing</th><th>Total fired</th></tr></thead><tbody>${liveNow.map(row).join("")}</tbody></table>`
    : `<div class="empty">Nothing currently proven in the app, or no recent backtest data for what is.</div>`}

  <h2>Clears 60%, and it holds up</h2>
  <div class="sub" style="margin:0 0 8px">Real average, real consistency, both at once. This is the actual bar, not just a big number.</div>
  ${trustworthy.length ? `<table><thead><tr><th>Bucket</th><th>Avg win rate</th><th>Swing</th><th>Total fired</th></tr></thead><tbody>${trustworthy.map(row).join("")}</tbody></table>`
    : `<div class="empty">Nothing clears both bars yet. Honestly, that's not unusual, at a 2:1 payout the real breakeven is around 33%, so a stable 45-50% is already a real edge. 60% and stable together is a high bar, worth keeping, not lowering.</div>`}

  <h2>High average, not stable yet</h2>
  <div class="sub" style="margin:0 0 8px">These clear 60% on average, but swing too much run to run to trust yet. Watch, don't lean on.</div>
  ${promising.length ? `<table><thead><tr><th>Bucket</th><th>Avg win rate</th><th>Swing</th><th>Total fired</th></tr></thead><tbody>${promising.map(row).join("")}</tbody></table>`
    : `<div class="empty">Nothing in this category right now.</div>`}
  `}

  <div class="note">"Live in the app" reflects the hand-curated table in lib/signals.js, updated by hand after reviewing real backtest runs, not automatically. The other two sections are computed fresh from Neon every time you load this page. These two can drift, that's expected, it's exactly why this page exists, to see both at once.</div>
  </body></html>`;
}

export async function GET() {
  const { ranked, reason } = await getConsistencyRanking();

  const liveNow = ranked.filter((r) => {
    const parts = r.bucket.split(" · ");
    if (parts.length < 3) return false;
    const key = `${parts[0]}|${parts[1]}|${parts[2]}`;
    return PROVEN_COMBOS.has(key);
  });

  const trustworthy = ranked.filter((r) => r.avgRate >= TRUST_MIN_AVG && r.range <= TRUST_MAX_SWING);
  const promising = ranked.filter((r) => r.avgRate >= TRUST_MIN_AVG && r.range > TRUST_MAX_SWING);

  const html = renderHtml({ liveNow, trustworthy, promising, reason: ranked.length ? null : reason });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
