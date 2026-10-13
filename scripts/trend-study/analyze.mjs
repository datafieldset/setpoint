import fs from "fs";
const R = "/home/claude/gh-current/repo/lib/";
const { aggregate } = await import(R + "resolve.js");
const T = await import(R + "trend.js");
const D = "../trend";
const TFK = process.argv[2];
const TRAIL = TFK === "4h" ? 4 : 3;
const SRC = { "15m": ["15m", 1, 900], "1h": ["1h", 1, 3600], "4h": ["1h", 4, 3600] };
const [file, factor, gran] = SRC[TFK];
const load = (f) => JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0] * 1000, low: r[1], high: r[2], open: r[3], close: r[4], volumeto: r[5] })).filter((x) => x.close > 0).sort((a, b) => a.time - b.time);
let c = load(`${D}/BTC_${file}.json`);
if (factor > 1) c = aggregate(c, gran, factor);
const barMs = { "15m": 900e3, "1h": 3600e3, "4h": 14400e3 }[TFK];
const { rows, bars } = JSON.parse(fs.readFileSync(`fires_${TFK}.json`));
const d1 = load(`${D}/BTC_1d.json`);
const h1 = load(`${D}/BTC_1h.json`);
const h4 = aggregate(h1, 3600, 4);
const atr = T.atrSeries(c), rsi = T.rsiSeries(c), adx = T.adxSeries(c);
// 200 day average, no lookahead (only completed days)
const smaAt = (t) => { const day = Math.floor(t / 864e5) * 864e5; let lo = 0, hi = d1.length; while (lo < hi) { const m = (lo + hi) >> 1; if (d1[m].time < day) lo = m + 1; else hi = m; } if (lo < 200) return null; let s = 0; for (let k = lo - 200; k < lo; k++) s += d1[k].close; return s / 200; };
// higher timeframe EMA, only completed bars
const mkEma = (arr, sec, n) => { const e = T.emaSeries(arr.map((x) => x.close), n); return (t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].time + sec * 1000 <= t) lo = m + 1; else hi = m; } return lo ? { e: e[lo - 1], c: arr[lo - 1].close } : null; }; };
const e1h = mkEma(h1, 3600, 50), e4h = mkEma(h4, 14400, 20);

function trailExit(i, dir) { // enter at close of bar i, trail by TRAIL x ATR on completed bars
  const L = dir === "bull", entry = c[i].close, a0 = atr[i]; if (!a0) return null;
  const risk = TRAIL * a0; let stop = L ? entry - risk : entry + risk; let ext = entry;
  const cap = TFK === "15m" ? 800 : TFK === "1h" ? 500 : 150;
  for (let j = i + 1; j < Math.min(c.length, i + 1 + cap); j++) {
    const k = c[j];
    if (L ? k.low <= stop : k.high >= stop) { const px = L ? Math.min(k.open, stop) : Math.max(k.open, stop); return { end: j, r: (L ? px - entry : entry - px) / risk }; }
    ext = L ? Math.max(ext, k.high) : Math.min(ext, k.low);
    if (atr[j]) { const ns = L ? ext - TRAIL * atr[j] : ext + TRAIL * atr[j]; stop = L ? Math.max(stop, ns) : Math.min(stop, ns); }
  }
  const j = Math.min(c.length - 1, i + cap); const px = c[j].close; return { end: j, r: (L ? px - entry : entry - px) / risk, open: true };
}
function fixedExit(f) { // the signal's own stop and 2:1 target, 40 bars like the old walk
  const L = f.dir === "bull"; const i = f.i;
  for (let j = i + 1; j < Math.min(c.length, i + 41); j++) {
    const k = c[j]; const ht = L ? k.high >= f.target : k.low <= f.target, hs = L ? k.low <= f.stop : k.high >= f.stop;
    if (hs) return { end: j, r: -1 }; if (ht) return { end: j, r: Math.abs(f.target - f.entry) / Math.abs(f.entry - f.stop) };
  }
  return { end: Math.min(c.length - 1, i + 40), r: 0, open: true };
}
const feat = (i, dir) => {
  const t = c[i].time + barMs, px = c[i].close, L = dir === "bull", sma = smaAt(t);
  const side = sma == null ? null : L ? px > sma : px < sma;
  const stretchOk = sma == null ? null : L ? px <= sma * 1.2 : true;
  const a = e1h(t), b = e4h(t);
  const h1ok = a ? (L ? px > a.e : px < a.e) : null;
  const h4ok = b ? (L ? px > b.e : px < b.e) : null;
  const mom = L ? rsi[i] > 60 && adx[i] > 20 : rsi[i] < 40 && adx[i] > 20;
  return { side, stretchOk, h1ok, h4ok, mom };
};
const FILTERS = {
  none: () => true,
  "200d side": (f) => f.side === true,
  "200d+not stretched": (f) => f.side === true && f.stretchOk === true,
  "+1h agree": (f) => f.side === true && f.stretchOk === true && f.h1ok === true,
  "+1h&4h agree": (f) => f.side === true && f.stretchOk === true && f.h1ok === true && f.h4ok === true,
  "+RSI/ADX": (f) => f.side === true && f.stretchOk === true && f.h1ok === true && f.mom === true,
};
const stat = (xs) => { const n = xs.length; if (!n) return { n: 0, w: null, r: null }; const w = xs.filter((x) => x.r > 0).length; return { n, w: Math.round((100 * w) / n), r: +(xs.reduce((s, x) => s + x.r, 0) / n).toFixed(2) }; };
const half = (xs) => { const mid = c[Math.floor(c.length / 2)].time; return [xs.filter((x) => x.t < mid), xs.filter((x) => x.t >= mid)]; };
function run(list, exit, filt) { // one open trade per key
  let busy = -1; const out = [];
  for (const f of list) {
    if (f.i <= busy) continue;
    const ft = feat(f.i, f.dir); if (!filt(ft)) continue;
    const ex = exit(f); if (!ex) continue;
    busy = ex.end; out.push({ t: f.t, r: ex.r });
  }
  return out;
}
const byKey = {};
for (const f of rows) (byKey[f.label + "|" + f.dir] ||= []).push(f);
// null: every bar, each direction
const allBars = (dir) => { const out = []; for (let i = 300; i < c.length - 1; i++) out.push({ i, t: c[i].time, dir }); return out; };
const nulls = {};
for (const dir of ["bull", "bear"]) nulls[dir] = allBars(dir);
const res = { tf: TFK, null: {}, sig: {} };
for (const dir of ["bull", "bear"]) for (const [fn, fl] of Object.entries(FILTERS)) {
  const xs = run(nulls[dir], (f) => trailExit(f.i, f.dir), fl);
  res.null[dir + "|" + fn] = { all: stat(xs), halves: half(xs).map(stat) };
}
for (const [key, list] of Object.entries(byKey)) {
  const o = { fixed: stat(run(list, fixedExit, FILTERS.none)), filt: {} };
  for (const [fn, fl] of Object.entries(FILTERS)) {
    const xs = run(list, (f) => trailExit(f.i, f.dir), fl);
    o.filt[fn] = { all: stat(xs), halves: half(xs).map(stat) };
  }
  res.sig[key] = o;
}
fs.writeFileSync(`res_${TFK}.json`, JSON.stringify(res));
console.log(TFK, "done", Object.keys(res.sig).length, "signal-dirs");
