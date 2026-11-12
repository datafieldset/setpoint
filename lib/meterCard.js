// lib/meterCard.js
//
// The numbers and words on the Market Meter's share image (v24.7, Nov 12, Na approved the mockup: "Do it and push").
// Pure logic, no network and no database, so scripts/review.mjs can test it. The route app/api/meter-card/route.jsx fetches the data and
// draws what this returns. It reads the SAME functions the meter on the page reads (lib/meter.js, marketRegime in lib/signals.js), so the
// image cannot say something the meter does not. It never names a signal: the card is the market, not our alerts.
import { meterMovesFrom, meterHeadline, RANGE_MIN, RANGE_EDGE } from "./meter.js";
import { marketRegime } from "./signals.js";

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const sgn = (n) => (Math.abs(n) < 0.05 ? "0.0%" : (n >= 0 ? "+" : "-") + Math.abs(n).toFixed(1) + "%");
const when = (now) => new Date(now).toLocaleString("en-US", { timeZone: "Pacific/Honolulu", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " HST";

// candles1h, candles5m: Coinbase candles, oldest first. weekly: getWeekly200MA() ({ daily50, daily200, sma }). fng: { value, label } or null.
export function buildMeterCard({ candles1h, candles5m, weekly, fng, now = Date.now() }) {
  const base = meterMovesFrom(candles1h);
  if (!base || !weekly) return null;
  const d50 = weekly.daily50, d200 = weekly.daily200, w200 = weekly.sma;
  if (!(d50 > 0 && d200 > 0 && w200 > 0)) return null;
  const px = base.px;
  const moves = { ...base, vs50: (px / d50 - 1) * 100 };
  // The page reads the 5 minute regime for the gauge. The headline only needs it when there is no range line, so a missing read is not fatal.
  const m = (candles5m && candles5m.length ? marketRegime(candles5m, "5m") : null) || { stage: "mixed", phase: "building", level: 1, label: "" };
  const full = meterHeadline(m, moves);
  if (!full) return null;
  // The big price sits right under the sentence, so the sentence drops its own "Bitcoin $71,515," opener.
  const sentence = full.replace(/^Bitcoin \$[\d,]+, (.)/, (_, c) => c.toUpperCase());
  const bull = px > d50;
  const mv = (k, v) => ({ k, text: sgn(v), up: Math.abs(v) < 0.05 ? null : v >= 0 });
  const span = base.hi24 - base.lo24;
  const at = span > 0 ? Math.min(1, Math.max(0, (px - base.lo24) / span)) : 0.5;
  const tight = !(span > 0) || span / px < RANGE_MIN;
  const rangeNote = tight ? "Tight range" : at <= RANGE_EDGE ? "Near the low" : at >= 1 - RANGE_EDGE ? "Near the high" : "Mid-range";
  const levels = [
    { n: "50-day", v: d50, cls: "d50" },
    { n: "Current price", v: px, cls: "px" },
    { n: "200-day", v: d200 },
    { n: "200-week", v: w200 },
  ].sort((a, b) => b.v - a.v);
  const ladder = levels.map((l) => {
    if (l.cls === "px") return { name: l.n, value: money(l.v), note: "now", cls: "px" };
    const note = l.v > px ? `${sgn((l.v / px - 1) * 100)} ${l.cls === "d50" ? "to break" : "to reach"}` : `${sgn((px / l.v - 1) * 100)} above`;
    return { name: l.n, value: money(l.v), note, cls: l.cls || "" };
  });
  return {
    verdict: bull ? "BULLISH" : "BEARISH",
    bull,
    sentence,
    price: money(px),
    moves: [mv("1h", base.h1), mv("1 day", base.h24), mv("1 week", base.w1)],
    range: { low: money(base.lo24), high: money(base.hi24), at, note: rangeNote },
    ladder,
    goldenCross: d50 > d200,
    fng: fng && fng.value != null ? { value: fng.value, label: fng.label || "" } : null,
    flip: px < d50 ? { pre: "Flip the story with a daily close above", hi: money(d50), post: "", gap: true } : { pre: "Staying above the 50-day (", hi: money(d50), post: ") keeps it bullish", gap: false },
    stamp: when(now),
  };
}
