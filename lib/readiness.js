// lib/readiness.js
//
// "How close is an alert" (v23.9, Nov 11, Na picked Option A of the Market Meter mockup). For each live signal that
// declares a `ready` kind in ALL_SIGNALS, say in plain words which of its checks are met right now and what it is
// still waiting for. Pure logic, no network or database. It reads the SAME rules the server runs (lib/trend.js
// analyze, lib/flush.js isFlushBar and flushPlan), so the meter cannot describe a rule the signal does not use.
//
// A new signal shows up in the meter by adding `ready: "<kind>"` to its ALL_SIGNALS entry. A new KIND of signal
// adds one function to READY below. The page never names a signal.
//
// Each function returns { badge, tone, lines: [{ ok, text }] }:
//   badge  short status on the right ("3 of 4 met", "Quiet", "Armed", "Ready")
//   tone   "wait" (amber), "quiet" (grey) or "go" (green)
//   lines  ok: true = a met check, false = the thing it is waiting on, null = plain information
import { TREND_TFS, precompute, analyze, RSI_BUY, ADX_MIN, STRETCH_MAX } from "./trend.js";
import { FLOW_Z } from "./flow.js";
import { CALM_MAX_ATR_PCT } from "./calmRider.js";
import { isFlushBar, flushPlan, FLUSH_DROP_PCT, FLUSH_LOOKBACK, FLUSH_COOLDOWN, FLUSH_WAIT } from "./flush.js";

const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
const pct = (v) => Math.abs(v).toFixed(1) + "%";

// Split exchange candles into finished bars and the one still forming.
function split(candles, baseMs, now) {
  const done = [], rest = [];
  for (const c of candles || []) (c.time + baseMs <= now ? done : rest).push(c);
  return { done, forming: rest.length ? rest[rest.length - 1] : null };
}

// Plain-English wording for each check analyze() can return. A key that is not listed falls back to the check's own label.
const TREND_WORDS = {
  avg200: (c, a) => {
    const d = a.sma ? (a.price / a.sma - 1) * 100 : null;
    if (d === null) return c.ok ? "Above its 200-day line" : "Waiting: price needs to be above its 200-day line";
    return c.ok ? `Above its 200-day line, by ${pct(d)}` : `Waiting: price needs to get back above its 200-day line (now ${pct(d)} under)`;
  },
  rsi: (c) => (c.ok ? "Buyers are in control" : `Waiting: buyers need to take control (momentum ${Math.round(c.value ?? 0)}, needs ${RSI_BUY})`),
  adx: (c) => (c.ok ? "The move has real strength (fast moves count, up or down)" : `Waiting: the trend needs to get stronger (strength ${Math.round(c.value ?? 0)}, needs ${ADX_MIN})`),
  stretch: (c, a) => {
    const d = a.sma ? (a.price / a.sma - 1) * 100 : null;
    if (c.ok && d !== null && d <= 0) return "Not stretched above the line (price is below the line)";
    return c.ok ? "Not stretched too far above the line" : `Waiting: price is stretched too far above its 200-day line (${d === null ? "over" : pct(d)}, limit ${Math.round(STRETCH_MAX * 100)}%)`;
  },
};

// Trend-style signals (buys on a TREND_TFS chart). ctx: { candles, sma, now }.
function trendReady(entry, ctx) {
  const tf = entry.tfs && entry.tfs[0];
  const cfg = TREND_TFS[tf];
  if (!cfg || cfg.retired || !ctx.candles || !(ctx.sma > 0)) return null;
  const { done } = split(ctx.candles, cfg.baseSec * 1000, ctx.now);
  if (done.length < cfg.N + 16) return null;
  const a = analyze(cfg, done, precompute(done), done.length - 1, null, { sma: ctx.sma, htf: null });
  if (!a) return null;
  const conds = a.bull.conds;
  const lines = conds.map((c) => ({ ok: !!c.ok, text: (TREND_WORDS[c.key] || ((x) => (x.ok ? x.label : `Waiting: ${x.label}`)))(c, a) }));
  lines.sort((x, y) => Number(y.ok) - Number(x.ok)); // met checks first, the waiting ones last
  const met = conds.filter((c) => c.ok).length;
  if (met === conds.length) {
    lines.push({ ok: null, text: `Every check is met. If they are still met when the next ${cfg.label} candle opens, it buys.` });
    return { badge: "Ready", tone: "go", lines };
  }
  return { badge: `${met} of ${conds.length} met`, tone: "wait", lines };
}

// Flush-style signals (buy the retest after a sharp drop). ctx: { candles (1 hour), now }.
function flushReady(entry, ctx) {
  const baseMs = 3600 * 1000;
  if (!ctx.candles) return null;
  const { done, forming } = split(ctx.candles, baseMs, ctx.now);
  if (done.length < FLUSH_LOOKBACK + 2) return null;
  const all = forming ? done.concat([forming]) : done;
  const price = all[all.length - 1].close;
  // Is a buy already resting after a recent flush? Same walk as flushFires in lib/flush.js.
  const atr = precompute(done).atr;
  let lastFlush = -Infinity, armed = null;
  const from = Math.max(FLUSH_LOOKBACK, done.length - (FLUSH_WAIT + 2 * FLUSH_COOLDOWN + 2));
  for (let i = from; i < done.length; i++) {
    if (!isFlushBar(done, i) || i - lastFlush <= FLUSH_COOLDOWN) continue;
    lastFlush = i;
    const plan = flushPlan(done[i], atr[i]);
    if (!plan) continue;
    const until = done[i].time + (FLUSH_WAIT + 1) * baseMs; // the last bar that can fill starts 24 hours after the flush bar
    let live = until > ctx.now;
    for (let k = i + 1; k < all.length && live; k++) {
      if (all[k].time > done[i].time + FLUSH_WAIT * baseMs) { live = false; break; }
      if (all[k].low <= plan.stop || all[k].low <= plan.entry) live = false; // broke the stop, or already filled (then it shows as an open alert)
    }
    armed = live ? { plan, low: done[i].low, hoursLeft: Math.max(1, Math.round((until - ctx.now) / baseMs)) } : null;
  }
  if (armed) {
    return { badge: "Armed", tone: "wait", lines: [{ ok: false, text: `Waiting: a sharp drop hit ${usd(armed.low)}. The buy is set at ${usd(armed.plan.entry)} and fills if price dips back to it in the next ${armed.hoursLeft} hour${armed.hoursLeft === 1 ? "" : "s"}, unless it falls through the stop first.` }] };
  }
  let lo = Infinity;
  for (let j = done.length - FLUSH_LOOKBACK; j < done.length; j++) if (done[j].low < lo) lo = done[j].low;
  const d = (price / lo - 1) * 100;
  const text = d > 0
    ? `Watching for a sharp one-hour drop through the 2-day low (${usd(lo)}, ${pct(d)} below price), in a market with big hourly swings. After one, it buys if price dips back near that low within 24 hours.`
    : `Price is at its 2-day low (${usd(lo)}). A one-hour drop of ${FLUSH_DROP_PCT}% or more through it, while the hourly swings are already big, sets up a buy.`;
  return { badge: "Quiet", tone: "quiet", lines: [{ ok: null, text }] };
}


// Flow Rider (lib/flow.js): two checks, read from ctx.extra.flow (the page gets it from /api/ready-state). Same two tests the server runs.
function flowReady(entry, ctx) {
  const fl = ctx.extra && ctx.extra.flow;
  if (!fl || !(fl.avg50 > 0)) return null;
  const strength = Math.max(0, -fl.z), need = -FLOW_Z, heavy = fl.z <= FLOW_Z;
  const d = ((fl.price - fl.avg50) / fl.avg50) * 100;
  const lines = [
    { ok: heavy, text: heavy ? `Heavy selling over the last 24 hours (${strength.toFixed(1)} on a scale where ${need} or more counts)` : `Waiting: selling over the last 24 hours is only ${strength.toFixed(1)} on a scale where ${need} or more counts` },
    { ok: fl.below, text: fl.below ? `Price is under its 50-day line (${usd(fl.avg50)}, ${pct(d)} below)` : `Waiting: price needs to drop under its 50-day line (${usd(fl.avg50)}, ${pct(d)} above)` },
  ];
  lines.sort((x, y) => Number(y.ok) - Number(x.ok));
  const met = lines.filter((l) => l.ok).length;
  if (met === 2) { lines.push({ ok: null, text: "Both checks are met. It sells short at the open of the next 15 minute candle." }); return { badge: "Ready", tone: "go", lines }; }
  return { badge: met ? "1 of 2 met" : "Quiet", tone: met ? "wait" : "quiet", lines };
}

// Calm Rider (lib/calmRider.js): one check, read from the 1 hour candles. Same number the server's gate reads.
function calmReady(entry, ctx) {
  if (!ctx.candles) return null;
  const { done } = split(ctx.candles, 3600 * 1000, ctx.now);
  if (done.length < 30) return null;
  const atr = precompute(done).atr[done.length - 1];
  const last = done[done.length - 1];
  if (!(atr > 0) || !(last.close > 0)) return null;
  const ap = (atr / last.close) * 100, calm = ap < CALM_MAX_ATR_PCT;
  if (calm) return { badge: "Calm", tone: "wait", lines: [{ ok: true, text: `The market is calm (the normal 1 hour swing is ${ap.toFixed(2)}% of price, the limit is ${CALM_MAX_ATR_PCT}%)` }, { ok: null, text: "It buys when a 30 minute or 1 hour candle closes up by more than its usual amount." }] };
  return { badge: "Quiet", tone: "quiet", lines: [{ ok: false, text: `Waiting: the market is too swingy for this one (the normal 1 hour swing is ${ap.toFixed(2)}% of price, it needs to be under ${CALM_MAX_ATR_PCT}%)` }] };
}

export const READY = { trend: trendReady, flush: flushReady, flow: flowReady, calm: calmReady };
// Kinds whose row needs extra live facts beyond the chart candles (the page fetches /api/ready-state once for them).
export const READY_EXTRA = { flow: true };

// Which chart a signal's readiness needs (the page fetches Bitcoin candles for these).
export const readyTf = (entry) => (entry && entry.ready && entry.tfs && entry.tfs[0]) || null;

// entry: an ALL_SIGNALS entry with `ready`. ctx: { candles, sma, now, open }. Returns null when it cannot be worked out (then the page shows nothing).
export function signalReadiness(entry, ctx) {
  if (!entry || !READY[entry.ready]) return null;
  if (ctx.open) return { badge: "Alert open", tone: "go", lines: [{ ok: null, text: `A Bitcoin trade is running on the ${ctx.tf || "same"} chart. See Open Alerts.` }] };
  try { return READY[entry.ready](entry, ctx); } catch { return null; }
}
