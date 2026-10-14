// lib/trend.js
//
// Trend Rider (v19.31): a breakout signal for Bitcoin and every watched coin, run on six
// timeframes at once (4h, 1h, 30m, 15m, 5m, 1m). A public test. Pure logic lives here, no network or database,
// so the studies, the replay tests and the cron all run the exact same
// rules.
//
// What it does, in plain words:
//   Entry   : the moment price TOUCHES the highest high (buy) or lowest low
//             (sell) of the previous 20 candles, instead of waiting for the
//             candle to close. The fill is the level itself (or the open if
//             price gapped past it).
//   Needs   : (1) price on the right side of its 200-day average,
//             (2) confirmation: RSI above 60 (buys) or below 40 (sells) and
//                 ADX above 20 (a real trend, not chop),
//             (3) on the fast charts, the bigger chart agrees (price on the
//                 right side of its 1h / 4h average),
//             (4) buys only: not stretched, price within 20% of its 200-day
//                 average.
//   Exit    : an ordinary stop and target, like every other signal. The
//             stop is 2 ATR from the entry, the target is 0.75R (0.75 of
//             the stop distance) the other way. 4 hour sells are off, they
//             lost money at every setting tested.
//   Size    : 1R is the distance to the stop.
// Indicators are read from the last COMPLETED candle, so nothing peeks.
// Study numbers behind every choice are in memory/lessons-learned.md.

export const TREND_COIN = "BTC"; // always scanned; the test bed the rules were built on
export const MAX_COINS = 12;     // most coins one cron run will scan (Bitcoin first, then the most watched)
export const FILTER_DAYS = 200;
export const STRETCH_MAX = 0.2; // buys only: skip when price is > 20% above its 200-day average
export const RSI_BUY = 60, RSI_SELL = 40, ADX_MIN = 20;
export const STOP_ATR = 2;   // stop distance, in ATR
export const TARGET_R = 0.75; // target distance, in multiples of the stop distance

// Display order, slowest first. `htf` lists the bigger charts that must agree.
// `sells: false` turns sells off for that timeframe.
export const TREND_TFS = {
  "4h": { label: "4 hour", baseSec: 14400, N: 20, htf: [], buyConfirm: true, sellConfirm: true, sells: false },
  "1h": { label: "1 hour", baseSec: 3600, N: 20, htf: [], buyConfirm: true, sellConfirm: true, sells: true },
  "30m": { label: "30 min", baseSec: 1800, N: 20, htf: ["1h"], buyConfirm: true, sellConfirm: true, sells: true },
  "15m": { label: "15 min", baseSec: 900, N: 20, htf: ["1h", "4h"], buyConfirm: true, sellConfirm: true, sells: true },
  "5m": { label: "5 min", baseSec: 300, N: 20, htf: ["1h"], buyConfirm: true, sellConfirm: true, sells: true },
  "1m": { label: "1 min", baseSec: 60, N: 20, htf: ["1h"], buyConfirm: true, sellConfirm: true, sells: true },
};
export const TREND_ORDER = Object.keys(TREND_TFS);

// ---------------------------------------------------------------- indicators

// Wilder's ATR, same method the rest of the app uses.
export function atrSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    if (i <= n) { sum += tr; if (i === n) out[i] = sum / n; }
    else out[i] = (out[i - 1] * (n - 1) + tr) / n;
  }
  return out;
}

export function emaSeries(vals, n) {
  const k = 2 / (n + 1);
  const out = [];
  let e = null;
  for (let i = 0; i < vals.length; i++) { e = e === null ? vals[i] : vals[i] * k + e * (1 - k); out.push(e); }
  return out;
}

export function rsiSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    const u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= n) { g += u; l += w; if (i === n) { g /= n; l /= n; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); } }
    else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + w) / n; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); }
  }
  return out;
}

// Wilder ADX. out[i] is the ADX as of bar i (null until it has settled).
export function adxSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  const T = [], P = [], M = [];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high, dn = bars[i - 1].low - bars[i].low;
    P.push(up > dn && up > 0 ? up : 0);
    M.push(dn > up && dn > 0 ? dn : 0);
    T.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close)));
  }
  let sT = 0, sP = 0, sM = 0, a = null;
  const DX = [];
  for (let k = 0; k < T.length; k++) {
    if (k < n) { sT += T[k]; sP += P[k]; sM += M[k]; }
    else { sT = sT - sT / n + T[k]; sP = sP - sP / n + P[k]; sM = sM - sM / n + M[k]; }
    if (k >= n - 1) {
      const pdi = (100 * sP) / sT, mdi = (100 * sM) / sT;
      DX.push((100 * Math.abs(pdi - mdi)) / ((pdi + mdi) || 1e-9));
      if (DX.length === n) a = DX.reduce((x, y) => x + y, 0) / n;
      else if (DX.length > n) a = (a * (n - 1) + DX[DX.length - 1]) / n;
      if (a !== null) out[k + 1] = a;
    }
  }
  return out;
}

export function precompute(bars) {
  return { atr: atrSeries(bars), rsi: rsiSeries(bars), adx: adxSeries(bars) };
}

// ---------------------------------------------------------------- candles

// Raw candles ({time, open, high, low, close}, ascending) into bars of
// `sec` seconds aligned to UTC. Returns every bucket, flagging whether it is
// complete (has all its parts and has closed by `nowMs`).
export function bucketBars(candles, sec, nowMs = Date.now()) {
  const size = sec * 1000;
  const map = new Map();
  for (const c of candles) {
    const b = Math.floor(c.time / size) * size;
    const cur = map.get(b);
    if (!cur) map.set(b, { time: b, open: c.open, high: c.high, low: c.low, close: c.close, parts: 1, lastPart: c.time });
    else { cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close; cur.parts++; cur.lastPart = c.time; }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

// Split a candle list (base candles, any source) into completed bars plus
// the bar that is still forming. `partSec` is the source candle size.
export function splitBars(candles, baseSec, partSec, nowMs = Date.now()) {
  const size = baseSec * 1000;
  const need = baseSec / partSec;
  const all = bucketBars(candles, baseSec, nowMs);
  const done = [];
  let forming = null;
  for (const b of all) {
    if (b.time + size <= nowMs && b.parts >= need) done.push(b);
    else if (b.time + size > nowMs) forming = b;
    // a past bucket with missing parts is dropped (feed gap)
  }
  return { done, forming };
}

// State of a bigger chart as of the last completed bar before time tRef.
// Mirrors the study: the bar before the one that contains tRef.
export function makeHtf(h1Bars, h4Bars) {
  const mk = (bars, emaLen, sec) => {
    const ema = emaSeries(bars.map((b) => b.close), emaLen);
    const idx = new Map(bars.map((b, i) => [b.time, i]));
    return (tRef) => {
      const size = sec * 1000;
      const k = idx.get(Math.floor(tRef / size) * size - size);
      return k === undefined ? null : { close: bars[k].close, ema: ema[k] };
    };
  };
  return { "1h": mk(h1Bars, 50, 3600), "4h": mk(h4Bars, 20, 14400) };
}

// ---------------------------------------------------------------- entries

// Everything the rules say about one direction right now.
//   cfg     one of TREND_TFS
//   bars    COMPLETED base bars, ascending; i = last index (bars.length - 1)
//   pre     precompute(bars)
//   forming the bar in progress ({time, open, high, low, close}) or null
//   ctx     { sma, htf (from makeHtf), price? }
// Returns { bull, bear }, each { level, touched, entry, risk, stop, ok, conds[] }.
export function analyze(cfg, bars, pre, i, forming, ctx) {
  const n = cfg.N;
  if (i < n + 15 || !pre.atr[i]) return null;
  let hh = -Infinity, ll = Infinity;
  for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low); }
  const sma = ctx.sma > 0 ? ctx.sma : null;
  const price = forming ? forming.close : bars[i].close;
  const tRef = bars[i].time; // last completed bar: indicators are read here
  const rsi = pre.rsi[i], adx = pre.adx[i];
  const htf = cfg.htf.map((k) => (ctx.htf ? ctx.htf[k](tRef) : null));

  const build = (dir) => {
    const L = dir === "bull";
    const level = L ? hh : ll;
    const touched = !!forming && (L ? forming.high > level : forming.low < level);
    const entry = touched ? (L ? Math.max(forming.open, level) : Math.min(forming.open, level)) : null;
    const ref = entry ?? price;
    const conds = [];
    conds.push({ key: "avg200", label: L ? "Price above its 200-day average" : "Price below its 200-day average", ok: sma !== null && (L ? ref > sma : ref < sma) });
    const needConfirm = L ? cfg.buyConfirm : cfg.sellConfirm;
    if (needConfirm) {
      conds.push({ key: "rsi", label: L ? `RSI above ${RSI_BUY}` : `RSI below ${RSI_SELL}`, ok: rsi != null && (L ? rsi > RSI_BUY : rsi < RSI_SELL), value: rsi });
      conds.push({ key: "adx", label: `ADX above ${ADX_MIN} (trending)`, ok: adx != null && adx > ADX_MIN, value: adx });
    }
    cfg.htf.forEach((k, idx) => {
      const s = htf[idx];
      conds.push({ key: "htf" + k, label: L ? `${k} chart trending up` : `${k} chart trending down`, ok: !!s && (L ? s.close > s.ema : s.close < s.ema) });
    });
    if (L) conds.push({ key: "stretch", label: `Not stretched (within ${Math.round(STRETCH_MAX * 100)}% of 200-day average)`, ok: sma !== null && ref / sma - 1 < STRETCH_MAX });
    if (!L && cfg.sells === false) conds.push({ key: "sells", label: "Sells are off on this chart", ok: false });
    const ok = conds.every((c) => c.ok);
    const risk = STOP_ATR * pre.atr[i];
    return {
      dir, level, touched, entry, risk,
      stop: entry === null ? null : L ? entry - risk : entry + risk,
      target: entry === null ? null : L ? entry + TARGET_R * risk : entry - TARGET_R * risk,
      ok, fire: ok && touched, conds,
      stretch: sma ? ref / sma - 1 : null,
      rsi, adx,
    };
  };
  return { price, sma, atr: pre.atr[i], bull: build("bull"), bear: build("bear") };
}
