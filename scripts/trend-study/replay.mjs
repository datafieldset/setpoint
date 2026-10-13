// Runs the REAL repo engine (lib/trend.js) over history, one timeframe at a time, with the live exit rules (2 ATR stop, 0.75R target).
import fs from "fs";
import * as T from "../../lib/trend.js";
const load = (f) => JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0] * 1000, low: r[1], high: r[2], open: r[3], close: r[4] })).filter((x) => x.close > 0).sort((a, b) => a.time - b.time);
const FAR = Date.now() + 1e12;
const d = load("BTC_1d.json");
const smaByDay = new Map();
{ const q = []; let s = 0; for (const x of d) { if (q.length === 200) s -= q.shift(); q.push(x.close); s += x.close; if (q.length === 200) smaByDay.set(Math.floor(x.time / 864e5) + 1, s / 200); } }
const smaFor = (t) => smaByDay.get(Math.floor(t / 864e5)) ?? null;
const h1raw = load("BTC_1h.json");
const m15 = load("BTC_15m.json");
const src = { "4h": h1raw, "1h": h1raw, "30m": m15, "15m": m15, "5m": load("BTC_5m.json"), "1m": load("BTC_1m.json") };
const partSec = { "4h": 3600, "1h": 3600, "30m": 900, "15m": 900, "5m": 300, "1m": 60 };
const h1 = T.splitBars(h1raw, 3600, 3600, FAR).done, h4 = T.splitBars(h1raw, 14400, 3600, FAR).done;
const htf = T.makeHtf(h1, h4);
const f = (n, d = 2) => n.toFixed(d);

export function replay(tf, opts = {}) {
  const cfg = { ...T.TREND_TFS[tf], ...(opts.cfg || {}) };
  const { done: bars } = T.splitBars(src[tf], cfg.baseSec, partSec[tf], FAR);
  const pre = T.precompute(bars);
  const out = { bull: [], bear: [] };
  for (const dir of ["bull", "bear"]) {
    let open = null;
    for (let i = 0; i < bars.length - 1; i++) {
      // 1. check the open trade against bar i (the entry bar counts too, cautious: both levels in one bar = a loss)
      if (open) {
        const b = bars[i], L = dir === "bull";
        const hitStop = L ? b.low <= open.stop : b.high >= open.stop, hitTarget = L ? b.high >= open.target : b.low <= open.target;
        if (hitStop || hitTarget) { out[dir].push({ t: open.t, r: hitStop ? -1 : T.TARGET_R }); open = null; }
      }
      // 2. a new entry on bar i+1 (the forming bar), indicators from bar i
      if (!open) {
        const fb = bars[i + 1];
        const sma = smaFor(fb.time);
        const a = T.analyze(cfg, bars, pre, i, { time: fb.time, open: fb.open, high: fb.high, low: fb.low, close: fb.open }, { sma, htf });
        if (!a) continue;
        const e = dir === "bull" ? a.bull : a.bear;
        if (e.fire) open = { t: fb.time, dir, stop: e.stop, target: e.target }; // the entry bar itself is checked on the next loop turn
      }
    }
  }
  return { bars, out };
}

const sum = (tr, days) => {
  if (!tr.length) return "n=0";
  const w = tr.filter((x) => x.r > 0).length, a = tr.reduce((s, x) => s + x.r, 0) / tr.length;
  const mid = tr[Math.floor(tr.length / 2)].t, A = tr.filter((x) => x.t < mid), B = tr.filter((x) => x.t >= mid);
  const av = (z) => (z.length ? z.reduce((s, x) => s + x.r, 0) / z.length : NaN);
  return `n=${String(tr.length).padStart(4)} (${f((tr.length / days) * 30, 1)}/mo) win ${f((100 * w) / tr.length, 0)}% avgR ${f(a).padStart(5)} halves ${f(av(A))}/${f(av(B))}`;
};
if (process.argv[2]) {
  for (const tf of process.argv[2].split(",")) {
    const { bars, out } = replay(tf);
    const days = (bars[bars.length - 1].time - bars[0].time) / 864e5;
    console.log(`\n== ${tf} (${f(days, 0)} days) ==\n buys : ${sum(out.bull, days)}\n sells: ${sum(out.bear, days)}`);
  }
}
