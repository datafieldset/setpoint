// lib/meter.js
//
// The Market Meter's words and marker, in one place (v21.6, Nov 6). They used to live inside app/page.jsx where nothing could test
// them, and the same screen was wrong twice in five days: Nov 2 it said "flat" with the week down 3.6%, Nov 6 it said "flat" with the week
// down 1.7% (the strip right under it showed -1.7% in red) and never mentioned that Bitcoin had fallen from $81,196 to $74,888 in two days,
// because a week-over-week number cannot see a spike and a fall. scripts/review.mjs now runs checkMeter() on a grid of numbers, and
// scripts/meter-check.mjs checks the live screen against real candles.
//
// `moves` = { h1, h24, w1, vs50, dd7, hiDay } (percent). dd7 = how far price sits under its 7 day high (0 or negative), hiDay = that high's weekday name.

export const DAY_MOVE_NAMED = 1.45;  // a day move this big (the strip rounds to 1.5%) is named
export const WEEK_MOVE_NAMED = 0.5;  // v21.6: any week move the strip shows as 0.5% or more is named (was 2, which called -1.7% "flat")
export const DRAWDOWN_NAMED = 5;     // v21.6: price this far under its 7 day high is named
const NEAR_50 = 1;                   // within 1% of the 50-day counts as "near" it, not above or below
const fmtMove = (v) => { const t = Math.abs(v).toFixed(1); return t.endsWith(".0") ? t.slice(0, -2) : t; };

// The three numbers of the strip plus the 7 day high, from 1 hour candles (ascending, {high, close}). Page and tests share this.
export function meterMovesFrom(cs) {
  if (!cs || cs.length <= 169) return null;
  const last = cs[cs.length - 1];
  const back = (h) => ((last.close / cs[cs.length - 1 - h].close) - 1) * 100;
  let hi = -Infinity, hiAt = null;
  for (let i = cs.length - 168; i < cs.length; i++) { const h = cs[i].high ?? cs[i].close; if (h > hi) { hi = h; hiAt = cs[i].time; } }
  // v22.9: the week's low, and where the run to the high started (lowest low in the 48 hours before the high bar), for the spike-then-drop sentence.
  let lo = Infinity, loAt = null, hiIdx = cs.length - 1;
  for (let i = cs.length - 168; i < cs.length; i++) { const l = cs[i].low ?? cs[i].close; if (l < lo) { lo = l; loAt = cs[i].time; } if (cs[i].time === hiAt) hiIdx = i; }
  let runStart = Infinity;
  for (let i = Math.max(0, hiIdx - 48); i < hiIdx; i++) { const l = cs[i].low ?? cs[i].close; if (l < runStart) runStart = l; }
  const day = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Pacific/Honolulu" }); // YYYY-MM-DD in Honolulu
  const hiDay = hiAt ? new Date(hiAt).toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" }) : null;
  const hiAgo = hiAt ? Math.round((Date.parse(day(last.time)) - Date.parse(day(hiAt))) / 864e5) : null;
  return { h1: back(1), h24: back(24), w1: back(168), dd7: Math.min(0, (last.close / hi - 1) * 100), hiDay, hiAgo, hi7: hi, hiAt, lo7: lo, loAt, loAgo: loAt ? Math.round((Date.parse(day(last.time)) - Date.parse(day(loAt))) / 864e5) : null, loDay: loAt ? new Date(loAt).toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" }) : null, runStart: runStart === Infinity ? null : runStart, px: last.close, hi24: Math.max(...cs.slice(-24).map((c) => c.high ?? c.close)), lo24: Math.min(...cs.slice(-24).map((c) => c.low ?? c.close)), fresh: meterFreshEvent(cs) };
}

// v22.7 (Nov 8, Na: "Btc just hit its lowest and market meter looks the same"): a flush is a 1 hour candle that falls 2.5% or more from its
// open and breaks the lowest low of the 48 hours before it (the same test Flush Rider uses, lib/flush.js). For FRESH_HOURS hours after it the
// meter says so in one extra line, then the line disappears. The candle list may end with the hour still in progress.
export const FRESH_DROP_PCT = 2.5;
export const FRESH_HOURS = 6;
export function meterFreshEvent(cs) {
  if (!cs || cs.length < 60) return null;
  const n = cs.length;
  for (let j = n - 1; j >= Math.max(49, n - 1 - FRESH_HOURS); j--) {
    const b = cs[j];
    if (!(b.open > 0) || b.low == null) continue;
    const drop = ((b.open - b.low) / b.open) * 100;
    if (drop < FRESH_DROP_PCT) continue;
    let lo = Infinity;
    for (let k = j - 48; k < j; k++) if (cs[k].low < lo) lo = cs[k].low;
    if (!(b.low < lo)) continue;
    return { low: b.low, drop, hoursAgo: n - 1 - j, back: ((cs[n - 1].close / b.low) - 1) * 100 };
  }
  return null;
}

// The extra line, or null when nothing fresh happened.
export function meterFreshLine(moves) {
  const f = moves && moves.fresh;
  if (!f) return null;
  const when = f.hoursAgo === 0 ? "this hour" : f.hoursAgo === 1 ? "an hour ago" : `${f.hoursAgo} hours ago`;
  const price = "$" + Math.round(f.low).toLocaleString("en-US");
  const head = f.hoursAgo === 0 ? `New low: Bitcoin has fallen ${fmtMove(f.drop)}% this hour, breaking its 48-hour low.` : `New low ${when}: Bitcoin fell ${fmtMove(f.drop)}% in one hour and broke its 48-hour low.`;
  const tail = f.back >= 0.3 ? ` It touched ${price} and has bounced ${fmtMove(f.back)}% since.` : ` It touched ${price} and is still close to it.`;
  return head + tail;
}

// The big picture can overrule a 5 minute wiggle. When the week is down, Bitcoin is under its 50-day and the day is not a real rally,
// a 5 minute uptrend is a bounce inside a downtrend (mirror image for an up market).
export function meterBackdrop(moves) {
  if (!moves || moves.vs50 == null) return null;
  if (moves.w1 < 0 && moves.vs50 <= -NEAR_50 && moves.h24 < DAY_MOVE_NAMED) return "down";
  if (moves.w1 > 0 && moves.vs50 >= NEAR_50 && moves.h24 > -DAY_MOVE_NAMED) return "up";
  return null;
}

const RANGE_MIN = 0.01, RANGE_EDGE = 0.25; // v24.4: the range line needs a range of 1% or more; bottom or top means the outer quarter
const STORY_DAYS = 3; // how many days the spike-and-drop story stays in the headline

// v24.4 (Na, Nov 12): when the short-term read is only "quiet" or "sideways" it says nothing, so the headline says where price sits in the
// last 24 hours instead ("still near the bottom of today's range, low $71,151"). `still` only when it continues the week's direction.
// null when the range is under 1% of price (a position inside a tiny range means nothing), then the old wording stays.
const usd0 = (v) => "$" + Math.round(v).toLocaleString("en-US");
export function meterRangeLine(moves, weekDir) {
  const { hi24, lo24, px } = moves || {};
  if (!(hi24 > lo24) || !(px > 0) || (hi24 - lo24) / px < RANGE_MIN) return null;
  const at = (px - lo24) / (hi24 - lo24);
  if (at <= RANGE_EDGE) return `${weekDir === "down" ? "still " : ""}near the bottom of today's range, low ${usd0(lo24)}`;
  if (at >= 1 - RANGE_EDGE) return `${weekDir === "up" ? "still " : ""}near the top of today's range, high ${usd0(hi24)}`;
  return "in the middle of today's range";
}

export function meterHeadline(m, moves) {
  if (!m) return null;
  const back = meterBackdrop(moves);
  const against = (back === "down" && m.stage === "bullish-trending") || (back === "up" && m.stage === "bearish-trending");
  const short = against ? (back === "down" ? "bouncing" : "pulling back") : {
    "bullish-trending": "rising",
    "bearish-trending": "falling",
    "sideways-ranging": m.phase === "ending" ? "squeezed tight, may be about to break" : "moving sideways",
    "high-volatility": "swinging hard",
    "low-volatility": "quiet",
  }[m.stage] || "mixed";
  const trending = m.stage === "bullish-trending" || m.stage === "bearish-trending";
  const sDir = m.stage === "bullish-trending" ? "up" : m.stage === "bearish-trending" ? "down" : null;
  if (!moves) return `Short term, Bitcoin is ${short}.`;
  const { h24, w1, vs50, dd7, hiDay } = moves;
  const weekBig = Math.abs(w1) >= WEEK_MOVE_NAMED;
  const dayBig = Math.abs(h24) >= DAY_MOVE_NAMED;
  // Lead with the week, unless the day moved more and is big. If neither moved, it is flat.
  let lead, leadDir;
  if (dayBig && (!weekBig || Math.abs(h24) > Math.abs(w1))) { leadDir = h24 > 0 ? "up" : "down"; lead = `${leadDir} ${fmtMove(h24)}% over the last day`; }
  else if (weekBig) { leadDir = w1 > 0 ? "up" : "down"; lead = `${leadDir} ${fmtMove(w1)}% this week`; }
  else { leadDir = null; lead = "flat this week"; }
  const below50 = vs50 != null && vs50 <= -NEAR_50;
  const above50 = vs50 != null && vs50 >= NEAR_50;
  // v23.5 (Na, Nov 11): the spike-and-drop story only runs while the high is fresh (3 days or less). After that the market has moved on, so the headline just describes now.
  const dropped = dd7 != null && dd7 <= -DRAWDOWN_NAMED && hiDay && moves.hi7 > 0 && (moves.hiAgo ?? 0) <= STORY_DAYS;
  const stretched = m.level >= 4 && trending ? " It's stretched, so chasing is risky." : "";
  if (dropped) {
    // A week-over-week number cannot see a spike and a fall, so a deep drop from the week's high gets its own sentence (v21.8, wording from Na).
    const when = moves.hiAgo === 0 ? "today" : moves.hiAgo === 1 ? "yesterday" : `on ${hiDay}`;
    const price = `$${(Math.round(moves.hi7 / 100) * 100).toLocaleString("en-US")}`;
    // v22.9 (Na, Nov 8): when the week's low came after the high, say it as a story plus what price is doing right now, in two sentences.
    // "Spiked" only when the run into the high was 3% or more; "gave it all back" only when price is under where that run started.
    if (moves.lo7 > 0 && moves.loAt > moves.hiAt && moves.px > 0) {
      const spiked = moves.runStart > 0 && moves.hi7 / moves.runStart - 1 >= 0.03;
      const gaveBack = spiked && moves.px < moves.runStart;
      const s1 = `Bitcoin ${spiked ? "spiked to" : "hit its high of"} ${price} ${when}, then ${gaveBack ? "gave it all back, down" : "fell"} ${fmtMove(dd7)}%${gaveBack ? " from the peak" : ""}.`;
      const loWhen = moves.loAgo === 0 ? "Today" : moves.loAgo === 1 ? "Yesterday" : `On ${moves.loDay}`;
      const bounce = (moves.px / moves.lo7 - 1) * 100;
      const lowPrice = "$" + Math.round(moves.lo7).toLocaleString("en-US");
      const s2 = `${loWhen} it dropped to ${lowPrice} and ${bounce >= 0.3 ? `has since bounced ${fmtMove(bounce)}% off the low` : "is still sitting near the low"}.`;
      return `${s1} ${s2}`;
    }
    const rel = leadDir && sDir && sDir !== leadDir;
    const ph = against || rel ? (back === "up" ? "pulling back" : sDir === "up" ? "bouncing" : "turning down") : sDir === leadDir && sDir ? (sDir === "up" ? "still climbing" : "still sliding") : short;
    const mid = below50 ? ", still under its 50-day" : above50 ? ", holding above its 50-day" : "";
    const tail = against || rel ? `, but short term it's ${ph}` : `, and ${ph}`;
    return `Bitcoin hit its high of ${price} ${when}, then fell ${fmtMove(dd7)}%. It's ${lead.replace("this week", "on the week")}${mid}${tail}.${stretched}`;
  }
  const tail50 = below50 ? " and still below its 50-day" : above50 ? " and holding above its 50-day" : "";
  const joiner = against ? "but short term it's" : sDir && leadDir && sDir === leadDir ? "and short term it's still" : (!leadDir && !trending) || (sDir && !leadDir) ? "and short term it's" : "but short term it's";
  const range = ["quiet", "moving sideways", "mixed"].includes(short) ? meterRangeLine(moves, leadDir) : null;
  const opener = moves.px > 0 ? `Bitcoin ${usd0(moves.px)},` : "Bitcoin is";
  return `${opener} ${lead}${tail50}, ${range || `${joiner} ${short}`}.${stretched}`;
}

// The line under the gauge. The plain 5 minute sideways label would only repeat the headline, so it is hidden unless
// something more is worth saying: a day move that has paused ("Sold off today, now pausing"), or any non-sideways read.
export function meterStageLine(m, moves) {
  if (m.stage === "sideways-ranging" && m.phase !== "ending") {
    if (moves && Math.abs(moves.h24) >= DAY_MOVE_NAMED) {
      return moves.h24 < 0 ? "Sold off today, now pausing. No new direction yet." : "Rallied today, now pausing. No new direction yet.";
    }
    return null;
  }
  const back = meterBackdrop(moves);
  if (back === "down" && m.stage === "bullish-trending") return "Bouncing inside a downtrend, not a new uptrend";
  if (back === "up" && m.stage === "bearish-trending") return "Pulling back inside an uptrend, not a new downtrend";
  return m.label;
}

// Where the marker sits on the bearish-to-bullish bar, 0 to 100 (50 is flat). Blends the 5m read (stage and strength) with the bigger
// picture: 1h / 1d / 1w moves (the day counts most) and where price sits against its 50-day average, so a falling market below its
// 50-day can never show a centered marker; the 5 minute read cannot flip the side the big picture is on.
export const meterPos = (m, moves) => {
  const short = m.stage === "bullish-trending" ? m.level * 9 : m.stage === "bearish-trending" ? -m.level * 9 : 0;
  const move = moves ? Math.max(-30, Math.min(30, moves.h1 * 2 + moves.h24 * 5 + moves.w1 * 1.5)) : 0;
  const trend50 = moves && moves.vs50 != null ? Math.max(-10, Math.min(10, moves.vs50 * 1.5)) : 0;
  const pos = Math.round(Math.max(4, Math.min(96, 50 + short + move + trend50)));
  const back = meterBackdrop(moves);
  return back === "down" ? Math.min(pos, 45) : back === "up" ? Math.max(pos, 55) : pos;
};

// Self-check used by review.mjs: the sentence must agree with the numbers shown next to it. Returns a list of problems (empty = fine).
export function checkMeter(m, moves) {
  const out = [];
  const h = meterHeadline(m, moves), pos = meterPos(m, moves), tag = JSON.stringify({ stage: m.stage, ...moves });
  const stripRounds = (v) => Number(v.toFixed(1));
  // Fixed numbers on purpose, NOT the constants above: a check that reads the same constant it is checking can never catch that constant being wrong.
  if (/flat this week/.test(h) && Math.abs(stripRounds(moves.w1)) >= 0.5 && !(Math.abs(moves.h24) >= 1.45 && Math.abs(moves.h24) > Math.abs(moves.w1))) out.push(`says flat but the week shows ${stripRounds(moves.w1)}%: ${tag}`);
  if (/\bup [\d.]+% this week/.test(h) && !(moves.w1 > 0)) out.push(`says up but the week is down: ${tag}`);
  if (/\bdown [\d.]+% this week/.test(h) && !(moves.w1 < 0)) out.push(`says down but the week is up: ${tag}`);
  const named = h.match(/(up|down) ([\d.]+)% (this week|on the week|over the last day)/);
  if (named) { const v = named[3] === "over the last day" ? moves.h24 : moves.w1; if (fmtMove(v) !== named[2]) out.push(`headline number ${named[2]} does not match the strip ${fmtMove(v)}: ${tag}`); }
  if (moves.dd7 <= -5 && moves.hiDay && (moves.hiAgo ?? 0) <= STORY_DAYS) {
    if (!h.includes(`then fell ${fmtMove(moves.dd7)}%`) && !h.includes(`down ${fmtMove(moves.dd7)}% from the peak`)) out.push(`a ${fmtMove(moves.dd7)}% drop from the week's high is not named: ${tag}`);
    if (!/\$[\d,]+/.test(h)) out.push(`names a drop but not the high's price: ${tag}`);
  }
  if (h.includes("dropped to")) { // v22.9 two-sentence form: the low and the bounce must match the numbers
    if (!h.includes("$" + Math.round(moves.lo7).toLocaleString("en-US"))) out.push(`the low's price is wrong or missing: ${tag}`);
    const bn = h.match(/bounced ([\d.]+)% off the low/), real = (moves.px / moves.lo7 - 1) * 100;
    if (bn && fmtMove(real) !== bn[1]) out.push(`bounce ${bn[1]} does not match ${fmtMove(real)}: ${tag}`);
    if (!bn && real >= 0.3) out.push(`price is ${fmtMove(real)}% off the low but the headline says it is still near it: ${tag}`);
    if (h.includes("gave it all back") && !(moves.px < moves.runStart)) out.push(`says gave it all back but price is above where the run started: ${tag}`);
  }
  // v24.4: the price at the front and the range line must agree with the numbers.
  const lead$ = h.match(/^Bitcoin (\$[\d,]+),/);
  if (lead$ && lead$[1] !== usd0(moves.px)) out.push(`headline price ${lead$[1]} is not the price ${usd0(moves.px)}: ${tag}`);
  const rg = h.match(/(near the bottom|near the top|in the middle) of today's range(?:, (?:low|high) (\$[\d,]+))?/);
  if (rg) {
    const at = (moves.px - moves.lo24) / (moves.hi24 - moves.lo24);
    if (rg[1] === "near the bottom" && !(at <= 0.25 && rg[2] === usd0(moves.lo24))) out.push(`says near the bottom of the range but price is ${(at * 100).toFixed(0)}% up it or the low is wrong: ${tag}`);
    if (rg[1] === "near the top" && !(at >= 0.75 && rg[2] === usd0(moves.hi24))) out.push(`says near the top of the range but price is ${(at * 100).toFixed(0)}% up it or the high is wrong: ${tag}`);
    if (rg[1] === "in the middle" && !(at > 0.25 && at < 0.75)) out.push(`says the middle of the range but price is ${(at * 100).toFixed(0)}% up it: ${tag}`);
    if ((moves.hi24 - moves.lo24) / moves.px < 0.01) out.push(`names a position inside a range under 1%: ${tag}`);
  }
  if (moves.dd7 > -5 && (h.includes("then fell") || h.includes("from the peak"))) out.push(`names a drop that is not there: ${tag}`);
  const back = meterBackdrop(moves);
  if (back === "down" && pos > 45) out.push(`down market but marker at ${pos}: ${tag}`);
  if (back === "up" && pos < 55) out.push(`up market but marker at ${pos}: ${tag}`);
  if (/Real uptrend/.test(meterStageLine(m, moves) || "") && (moves.w1 < 0 && moves.vs50 <= -NEAR_50 && moves.h24 < DAY_MOVE_NAMED)) out.push(`"Real uptrend" in a down market: ${tag}`);
  // v22.7 freshness: a fresh flush must be named, and nothing fresh must not be.
  const fl = meterFreshLine(moves);
  if (moves.fresh && !fl) out.push(`a fresh flush is not named: ${tag}`);
  if (moves.fresh && fl && !fl.includes("$" + Math.round(moves.fresh.low).toLocaleString("en-US"))) out.push(`the fresh line does not name the low: ${tag}`);
  if (!moves.fresh && fl) out.push(`names a fresh low that is not there: ${tag}`);
  return out;
}
