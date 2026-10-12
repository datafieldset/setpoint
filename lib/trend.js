// lib/trend.js
//
// Trend Rider (v19.21): a slow trend-following signal for Bitcoin, built
// to catch the multi-day moves the scalping signals can't. Admin-only
// forward test. Pure logic lives here, no network or database, so the
// study, the tests and the cron all run the exact same rules.
//
// The rules, from the Oct 12 study on 10 years of daily and 6 years of
// 4h BTC (see memory/lessons-learned.md):
//   Entry  : a 4h bar CLOSES beyond the highest high (or lowest low) of
//            the previous 20 bars, and price is on the right side of its
//            200-day average (above for longs, below for shorts).
//   Exit   : a trailing stop, 4 average bar-ranges (ATR) behind the best
//            price since entry. No fixed target. The stop only moves in
//            the trade's favour.
//   Size   : 1R is the opening distance to the stop (4 ATR).
// Honest expectation: roughly 40% winners, winners about 1.5x what a
// loser costs. Over the last 24 months this edge was close to zero (BTC
// got calmer), which is why it runs as a test before anyone relies on it.

export const TREND = {
  coin: "BTC",
  barHours: 4,
  breakoutBars: 20,
  atrBars: 14,
  trailAtr: 4,
  filterDays: 200,
};

const HOUR = 3600 * 1000;
const BAR = TREND.barHours * HOUR;

// Wilder's ATR over any bar list, same method the rest of the app uses.
export function atrSeries(bars, n = TREND.atrBars) {
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    if (i <= n) { sum += tr; if (i === n) out[i] = sum / n; }
    else out[i] = (out[i - 1] * (n - 1) + tr) / n;
  }
  return out;
}

// Hourly candles (ascending, {time, open, high, low, close}) into COMPLETED
// 4h bars aligned to UTC multiples of 4 hours. A bar is only returned once
// all four of its hours have closed.
export function build4hBars(hourly, nowMs = Date.now()) {
  const map = new Map();
  for (const c of hourly) {
    const b = Math.floor(c.time / BAR) * BAR;
    const cur = map.get(b);
    if (!cur) map.set(b, { time: b, open: c.open, high: c.high, low: c.low, close: c.close, hours: 1 });
    else { cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close; cur.hours++; }
  }
  return [...map.values()].filter((b) => b.hours === TREND.barHours && b.time + BAR <= nowMs).sort((a, b) => a.time - b.time);
}

// Is there an entry on bar i? `sma` is the 200-day average at that time.
export function entryAt(bars, i, sma, atrs = atrSeries(bars)) {
  const n = TREND.breakoutBars;
  if (i < n + 1 || !atrs[i] || !(sma > 0)) return null;
  let hh = -Infinity, ll = Infinity;
  for (let j = i - n; j < i; j++) { hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low); }
  const b = bars[i];
  const risk = TREND.trailAtr * atrs[i];
  if (b.close > hh && b.close > sma) return { dir: "long", entry: b.close, risk, stop: b.close - risk, barTime: b.time, breakout: hh };
  if (b.close < ll && b.close < sma) return { dir: "short", entry: b.close, risk, stop: b.close + risk, barTime: b.time, breakout: ll };
  return null;
}

// Where price must close to trigger, for the "what to watch" line.
export function triggerLevels(bars, sma) {
  const n = TREND.breakoutBars;
  if (bars.length < n) return null;
  const w = bars.slice(-n);
  const hh = Math.max(...w.map((b) => b.high)), ll = Math.min(...w.map((b) => b.low));
  const price = bars[bars.length - 1].close;
  return {
    price, sma,
    longTrigger: hh, shortTrigger: ll,
    longAllowed: sma > 0 ? price > sma : false,
    shortAllowed: sma > 0 ? price < sma : false,
  };
}

// Walks an open position forward through hourly candles. `pos` is
// { dir, entry, risk, stop, ext, lastHour } (lastHour = open time of the last
// hourly candle already processed). Stops are checked every hour (a hit at the
// stop price, or the open if it gapped past it) but the trailing stop only
// moves when a 4h bar completes, exactly as in the study.
export function advancePosition(pos, hourly, bars4h, atrs, nowMs = Date.now()) {
  const L = pos.dir === "long";
  const byStart = new Map(bars4h.map((b, i) => [b.time, i]));
  let { stop, ext, lastHour } = pos;
  for (const h of hourly) {
    if (h.time <= lastHour || h.time + HOUR > nowMs) continue;
    const gapped = L ? h.open <= stop : h.open >= stop;
    const hit = L ? h.low <= stop : h.high >= stop;
    if (hit) {
      const exit = gapped ? h.open : stop;
      return { closed: true, exit, r: (L ? exit - pos.entry : pos.entry - exit) / pos.risk, closedHour: h.time, stop, ext, lastHour: h.time };
    }
    lastHour = h.time;
    // last hour of a 4h bar: the bar is complete, move the trail
    const bucket = Math.floor(h.time / BAR) * BAR;
    if (h.time === bucket + BAR - HOUR && byStart.has(bucket)) {
      const i = byStart.get(bucket);
      const b = bars4h[i];
      if (atrs[i]) {
        ext = L ? Math.max(ext, b.high) : Math.min(ext, b.low);
        const ns = L ? ext - TREND.trailAtr * atrs[i] : ext + TREND.trailAtr * atrs[i];
        stop = L ? Math.max(stop, ns) : Math.min(stop, ns);
      }
    }
  }
  return { closed: false, stop, ext, lastHour };
}

// R for an open position at the current price.
export function openR(pos, price) {
  return (pos.dir === "long" ? price - pos.entry : pos.entry - price) / pos.risk;
}
