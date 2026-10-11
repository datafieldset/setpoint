// scripts/recheck-killed.mjs
//
// Monthly re-test of every retired ("killed") signal combo, on BTC only
// (standing rule), using the live rules (thresholdsFor). A combo that
// was killed on one stretch of market can come back, so this looks
// again, on fresh history, and reports anything that now looks alive.
//
// It never changes code or un-kills anything. It prints a report and,
// when run by the workflow, the workflow opens a GitHub issue if there
// are candidates. Un-killing stays a deliberate decision.
//
// Usage: node scripts/recheck-killed.mjs [--out report.md]
// Skips 1m combos (a year of 1m candles is ~1,750 requests).
import fs from "fs";
import { computeSignals, thresholdsFor, windowPct, marketBias, reversalRisk, KILLED_COMBOS, DEFAULT_TH } from "../lib/signals.js";
import { aggregate } from "../lib/resolve.js";
import { barMs } from "../lib/timeframes.js";

const killed = [...KILLED_COMBOS].map((k) => k.split("|")).filter(([, tf]) => tf !== "1m");
KILLED_COMBOS.length = 0; // let the detectors fire so we can measure them

const SRC = { "5m": ["5m", 300, 1, 120], "15m": ["15m", 900, 1, 365], "30m": ["15m", 900, 2, 365], "1h": ["1h", 3600, 1, 365], "4h": ["1h", 3600, 4, 365] };
const HEAD = { "User-Agent": "setpoint-recheck/1.0" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRange(gran, days) {
  const end = Date.now(), start = end - days * 86400000, step = gran * 300 * 1000;
  const out = [];
  for (let t = start; t < end; t += step) {
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${gran}&start=${new Date(t).toISOString()}&end=${new Date(Math.min(t + step, end)).toISOString()}`;
    let raw;
    for (let a = 0; a < 4; a++) {
      const r = await fetch(url, { headers: HEAD });
      if (r.ok) { raw = await r.json(); break; }
      await sleep(1000 * (a + 1));
    }
    if (!Array.isArray(raw)) throw new Error("candle fetch failed");
    for (const x of raw) out.push({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4], volumeto: x[5] });
    await sleep(250);
  }
  const seen = new Set();
  return out.filter((c) => c.close > 0 && !seen.has(c.time) && seen.add(c.time)).sort((a, b) => a.time - b.time);
}

const tfs = [...new Set(killed.map(([, tf]) => tf))].filter((tf) => SRC[tf]);
const wanted = new Set(killed.map((k) => k.join("|")));
const stats = {}; // combo -> { rows: [{t,win}] }
const cache = {};
const FOLLOW = 40, WIN = 300;

for (const tf of tfs) {
  const [file, gran, factor, days] = SRC[tf];
  const key = `${file}:${days}`;
  cache[key] ||= await fetchRange(gran, days);
  let c = cache[key];
  if (factor > 1) c = aggregate(c, gran, factor);
  const bar = barMs(tf), busy = {};
  console.error(`replaying BTC ${tf}: ${c.length} bars`);
  for (let i = WIN; i < c.length - 1; i++) {
    const slice = c.slice(i - WIN + 1, i + 1);
    const bias = marketBias([{ sym: "BTC", pct: windowPct(slice, 8), isBTC: true }]);
    let out;
    try { out = computeSignals(slice, tf, thresholdsFor(tf, DEFAULT_TH), { now: c[i].time + bar, marketBias: bias, reversalRisk: reversalRisk(bias, null) }); } catch { continue; }
    for (const s of out.signals) {
      const combo = `${s.label}|${tf}|${s.dir}`;
      if (!wanted.has(combo) || !s.target || !s.stop) continue;
      if (busy[combo] !== undefined && i < busy[combo]) continue;
      let win = null, end = i;
      for (let j = i + 1; j < Math.min(c.length, i + 1 + FOLLOW); j++) {
        const k = c[j];
        const ht = s.dir === "bull" ? k.high >= s.target : k.low <= s.target;
        const hs = s.dir === "bull" ? k.low <= s.stop : k.high >= s.stop;
        end = j;
        if (hs) { win = false; break; }
        if (ht) { win = true; break; }
      }
      busy[combo] = end + 1;
      if (win === null) continue;
      (stats[combo] ||= []).push({ t: c[i].time, win });
    }
  }
}

const pct = (a) => (a.length ? a.filter((x) => x.win).length / a.length : 0);
const rows = killed.map((k) => k.join("|")).map((combo) => {
  const a = (stats[combo] || []).sort((x, y) => x.t - y.t);
  const half = Math.floor(a.length / 2);
  return { combo, n: a.length, rate: pct(a), early: pct(a.slice(0, half)), late: pct(a.slice(half)) };
});
// Candidate: clears the product bar (58%) on a real sample, OR clears the
// 2:1 payoff break-even with room (40%+) on 100+ fires and holds in BOTH halves.
const cands = rows.filter((r) => (r.n >= 30 && r.rate >= 0.58) || (r.n >= 100 && r.rate >= 0.40 && r.early >= 0.38 && r.late >= 0.38));
const line = (r) => `| ${r.combo} | ${r.n} | ${(r.rate * 100).toFixed(0)}% | ${(r.early * 100).toFixed(0)}% | ${(r.late * 100).toFixed(0)}% |`;
let md = `# Killed-signal recheck, ${new Date().toISOString().slice(0, 10)}\n\nBTC only, live rules. Break-even at the 2:1 payoff is a 34% win rate.\n\n`;
md += cands.length ? `## Candidates worth a look\n\n| Combo | Fires | Win rate | First half | Second half |\n|---|---|---|---|---|\n${cands.map(line).join("\n")}\n\n` : `## No candidates\n\nNothing killed has come back to life.\n\n`;
md += `## Everything rechecked\n\n| Combo | Fires | Win rate | First half | Second half |\n|---|---|---|---|---|\n${rows.map(line).join("\n")}\n\n1m combos are skipped (too much history to fetch).\n`;
console.log(md);
const o = process.argv.indexOf("--out");
if (o > 0) fs.writeFileSync(process.argv[o + 1], md);
fs.writeFileSync("recheck-candidates.flag", cands.length ? "yes" : "no");
