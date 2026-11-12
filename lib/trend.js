// lib/trend.js
//
// Trend Rider (v19.31): a breakout signal for Bitcoin and every watched coin, run on five (the 4 hour chart is Swing Rider)
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
//             (4) buys only: not stretched, price within 20% of its 200-day (v23.6 dropped it on the 4 hour chart, v23.8 put it back; noStretch is the switch)
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
// v19.42 (Na, Oct 22): on the 5 and 15 minute charts, skip a trade whose stop sits closer than this share of the
// price. Tiny stops get hit by ordinary wiggle and pay almost nothing even when they win. Six months of BTC replay:
// 5m 59% -> 62% wins (+0.03R -> +0.09R per trade), 15m 61% -> 65%, same total R from far fewer, bigger trades.
// Other charts are untouched (1m and 1h showed no effect).
export const MIN_STOP_PCT = 0.35;
// v19.44 (Na, Oct 22): the 1 minute chart also skips tiny stops, at a lower line (0.2% of price). v19.48 (Oct 27): the 1 minute
// chart now uses a 4 ATR stop and a 0.4% minimum. BTC replay: 69% wins, +0.21R, winners earn about 0.42% (was 64%, +0.11R, about 0.2%). An alert with a
// 0.11% stop and a target two price ticks away (XLM, Oct 22) is not tradable. Win rate did not change with stop size on 1m
// (61-65% at every cutoff over 70 days of BTC), so this removes the untradable alerts for free: about 12 a day -> about 1.6 on BTC.
export const MIN_STOP_PCT_1M = 0.4;
export const STOP_ATR_1M = 4; // v19.48: the 1 minute chart uses a wider stop (4 ATR) so a win is worth acting on
// v22.3 (Nov 7, Na: "build it, maybe only 5m"): a buy is skipped when the last hour of trading was quieter than normal, a breakout on thin
// volume. Last hour = the 12 finished 5 minute bars, normal = the average of the 288 finished bars before it (24 hours). cfg.minVolRatio
// is the lowest ratio allowed; only the 5 minute chart has it. Evidence (BTC, 2 years of 5m history, 273 buys): below normal 64 trades 53%
// -0.070R, normal or above 209 trades 64% +0.114R; the 35 live 5m buys agree (below normal 13 trades 38% -0.327R, above 22 trades 73% +0.273R).
// The same split on 15m (history only) and 1h (history only) pointed the same way, 30m and 1m barely. Fails open when the feed has under 288 bars.
export const VOL_HOURS_BARS = 12;
export const VOL_DAY_BARS = 288;
// v22.5 (Nov 7, Na: "only do it for the 15min for now"): 15m trades log how tight the market was, the high-to-low range of the last 48 hours as a percent of
// price, in meta.box. Logging only, it never blocks a trade. Replay (Feb 2025 to Nov 2026, BTC, no fees): 15m buys with a 48 hour range under 2.5%
// 36 trades 75% +0.313R, wider 259 trades 61% +0.073R. Small sample, so we collect live trades before acting on it. Other charts do not log it.
export const BOX_HOURS = 48;
export function boxPct(bars, i, baseSec) {
  const n = Math.round((BOX_HOURS * 3600) / baseSec);
  if (i < n) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = i - n + 1; j <= i; j++) { if (bars[j].high > hi) hi = bars[j].high; if (bars[j].low < lo) lo = bars[j].low; }
  const ref = bars[i].close;
  return ref > 0 ? ((hi - lo) / ref) * 100 : null;
}
export function volumeRatio(bars, i) {
  if (i < VOL_DAY_BARS) return null;
  let hour = 0, day = 0;
  for (let j = i - VOL_DAY_BARS + 1; j <= i; j++) { const v = bars[j].vol; if (!(v >= 0)) return null; day += v; if (j > i - VOL_HOURS_BARS) hour += v; }
  if (!(day > 0)) return null;
  return (hour / VOL_HOURS_BARS) / (day / VOL_DAY_BARS);
}
// v22.4 (Nov 7, Na: "you make the call"): sells are OFF on every chart. 2 years of BTC replay, 1,682 sells: 57% wins, +0.005R (break-even is 57.1%), halves +0.001R / +0.009R;
// only 15m (+0.041R) was positive in both halves. Turn a chart back on by setting sells: true once live or longer history shows an edge.
// v22.8 (Nov 8, Na: "build and push"): the 4 hour chart is now its own signal, Swing Rider (rider + targetR below). Same breakout rules, same 2 ATR stop,
// but a 3R target instead of 0.75R. BTC replay Jan 2020 to Nov 2026, fee 0.15% round trip, buys only: 60 trades, +0.54R each after fees, positive in every era
// (about 9 a year; 2022 has no trades because price sat under its 200-day average). The same breakout on the 1 hour chart with a 3R target was only +0.19R
// (199 trades), so 1 hour stays Trend Rider. A fixed 3R target keeps the normal Entry/Stop/Target card (scale-out and trailing exits tested better but do not fit it).
// `rider` names the signal that logs the trade (default Trend Rider); `targetR` overrides TARGET_R.
// v23.4 (Nov 11, Na: "Replace it" and "Retire them"):
// (1) Swing Rider no longer waits for a breakout (stateEntry below). It buys the open of a new 4 hour bar whenever the bar that just finished
// has the trend conditions (price above its 200-day average, RSI above 60, ADX above 20, not stretched), one trade at a time. Why: random buys
// taken only under those conditions made +0.36R, almost what the breakout version made (+0.46R on 57 trades), so the strong trend is the edge and
// the breakout trigger added little. Numbers for the rule as coded here are in memory/signal-roster.md (Nov 11).
// (2) Trend Rider is retired on every other chart (retired: true): after a 0.20% cost it lost on all of them (1h -0.14R on 311 trades,
// 30m -0.25R, 15m -0.30R, 5m -0.35R) and on 1h it did no better than random buys. The runner opens no new trades on a retired chart;
// trades already open still close at their own stop or target. Set retired: false to bring a chart back, with a dated reason in memory.
// v23.6 (Nov 11, Na: "Yes do it", 12 trades a year is not enough to charge for): Swing Rider drops the "not stretched" check (noStretch) so it fires
// about 28 times a year on Bitcoin instead of about 12. Cost of that: +0.23R a trade instead of +0.60R, longer losing streaks. Numbers in memory/signal-roster.md.
// v23.8 (Nov 11, Na: "Yes do it"): the "not stretched" check is back on the 4 hour chart (noStretch removed). The 95 extra trades it blocks (price more than
// 20% above the 200-day) made about nothing (+0.07R and -0.05R), so v23.6 added alerts and longer losing streaks but no profit. noStretch stays as a switch.
export const SWING_LABEL = "Swing Rider";
export const SWING_TARGET_R = 3;
export const TREND_TFS = {
  "4h": { label: "4 hour", baseSec: 14400, N: 20, htf: [], buyConfirm: true, sellConfirm: true, sells: false, rider: SWING_LABEL, targetR: SWING_TARGET_R, stateEntry: true },
  "1h": { label: "1 hour", baseSec: 3600, N: 20, htf: [], buyConfirm: true, sellConfirm: true, sells: false, retired: true },
  "30m": { label: "30 min", baseSec: 1800, N: 20, htf: ["1h"], buyConfirm: true, sellConfirm: true, sells: false, retired: true },
  "15m": { label: "15 min", baseSec: 900, N: 20, htf: ["1h", "4h"], buyConfirm: true, sellConfirm: true, sells: false, retired: true, minStopPct: MIN_STOP_PCT, logBox: true },
  "5m": { label: "5 min", baseSec: 300, N: 20, htf: ["1h"], buyConfirm: true, sellConfirm: true, sells: false, retired: true, minStopPct: MIN_STOP_PCT, minVolRatio: 1 },
  "1m": { label: "1 min", baseSec: 60, N: 20, htf: ["1h"], buyConfirm: true, sellConfirm: true, sells: false, retired: true, minStopPct: MIN_STOP_PCT_1M, stopAtr: STOP_ATR_1M },
};
export const TREND_ORDER = Object.keys(TREND_TFS);
// v19.38 (Na, Oct 14): on the 1 minute chart every coin except Bitcoin skips the "1 hour chart agrees" check.
// Bitcoin was working as it was, so it keeps the check. Everything else is the same for all coins.
export const cfgFor = (tf, coin) => (tf === "1m" && coin !== TREND_COIN ? { ...TREND_TFS[tf], htf: [] } : TREND_TFS[tf]);

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
    if (!cur) map.set(b, { time: b, open: c.open, high: c.high, low: c.low, close: c.close, parts: 1, lastPart: c.time, vol: c.volumeto || 0 });
    else { cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close; cur.parts++; cur.lastPart = c.time; cur.vol += c.volumeto || 0; }
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
    // stateEntry (buys only): no breakout level. The trade is taken at the open of the new bar when the finished bar passes the checks below.
    const state = L && !!cfg.stateEntry;
    const level = state ? null : L ? hh : ll;
    const touched = state ? !!forming : !!forming && (L ? forming.high > level : forming.low < level);
    const entry = touched ? (state ? forming.open : L ? Math.max(forming.open, level) : Math.min(forming.open, level)) : null;
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
    if (cfg.minStopPct) conds.push({ key: "minstop", label: `Stop at least ${cfg.minStopPct}% of price away`, ok: ((cfg.stopAtr || STOP_ATR) * pre.atr[i]) / ref * 100 >= cfg.minStopPct });
    const box = L && cfg.logBox ? boxPct(bars, i, cfg.baseSec) : null;
    const vol = L && cfg.minVolRatio ? volumeRatio(bars, i) : null;
    if (L && cfg.minVolRatio) conds.push({ key: "volume", label: "Last hour's volume at least normal", ok: vol === null || vol >= cfg.minVolRatio });
    if (L && !cfg.noStretch) conds.push({ key: "stretch", label: `Not stretched (within ${Math.round(STRETCH_MAX * 100)}% of 200-day average)`, ok: sma !== null && ref / sma - 1 < STRETCH_MAX });
    if (!L && cfg.sells === false) conds.push({ key: "sells", label: "Sells are off on this chart", ok: false });
    const ok = conds.every((c) => c.ok);
    const risk = (cfg.stopAtr || STOP_ATR) * pre.atr[i];
    return {
      dir, level, touched, entry, risk,
      stop: entry === null ? null : L ? entry - risk : entry + risk,
      target: entry === null ? null : L ? entry + (cfg.targetR || TARGET_R) * risk : entry - (cfg.targetR || TARGET_R) * risk,
      ok, fire: ok && touched, conds,
      stretch: sma ? ref / sma - 1 : null,
      vol: vol === null ? null : Number(vol.toFixed(2)),
      box: box === null ? null : Number(box.toFixed(2)),
      rsi, adx,
    };
  };
  return { price, sma, atr: pre.atr[i], bull: build("bull"), bear: build("bear") };
}

// Which signal logs a timeframe's trades, and which timeframes belong to a signal. Surfaces read these instead of naming a chart.
export const riderFor = (tf) => TREND_TFS[tf]?.rider || "Trend Rider";
export const tfsFor = (label) => TREND_ORDER.filter((tf) => !TREND_TFS[tf].retired && riderFor(tf) === label);
