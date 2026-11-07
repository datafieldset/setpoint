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
  const hiDay = hiAt ? new Date(hiAt).toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" }) : null;
  return { h1: back(1), h24: back(24), w1: back(168), dd7: Math.min(0, (last.close / hi - 1) * 100), hiDay };
}

// The big picture can overrule a 5 minute wiggle. When the week is down, Bitcoin is under its 50-day and the day is not a real rally,
// a 5 minute uptrend is a bounce inside a downtrend (mirror image for an up market).
export function meterBackdrop(moves) {
  if (!moves || moves.vs50 == null) return null;
  if (moves.w1 < 0 && moves.vs50 <= -NEAR_50 && moves.h24 < DAY_MOVE_NAMED) return "down";
  if (moves.w1 > 0 && moves.vs50 >= NEAR_50 && moves.h24 > -DAY_MOVE_NAMED) return "up";
  return null;
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
  // A week-over-week number cannot see a spike and a fall, so name a deep drop from the week's high on its own.
  const off = dd7 != null && dd7 <= -DRAWDOWN_NAMED && hiDay ? `, ${fmtMove(dd7)}% off its ${hiDay} high` : "";
  const below50 = vs50 != null && vs50 <= -NEAR_50;
  const above50 = vs50 != null && vs50 >= NEAR_50;
  const tail50 = below50 ? " and still below its 50-day" : above50 ? " and holding above its 50-day" : "";
  const joiner = against ? "but short term it's" : sDir && leadDir && sDir === leadDir ? "and short term it's still" : (!leadDir && !trending) || (sDir && !leadDir) ? "and short term it's" : "but short term it's";
  let line = `Bitcoin is ${lead}${off}${tail50}, ${joiner} ${short}.`;
  if (m.level >= 4 && trending) line += " It's stretched, so chasing is risky.";
  return line;
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
  if (/flat this week/.test(h) && Math.abs(stripRounds(moves.w1)) >= WEEK_MOVE_NAMED) out.push(`says flat but the week shows ${stripRounds(moves.w1)}%: ${tag}`);
  if (/\bup [\d.]+% this week/.test(h) && !(moves.w1 > 0)) out.push(`says up but the week is down: ${tag}`);
  if (/\bdown [\d.]+% this week/.test(h) && !(moves.w1 < 0)) out.push(`says down but the week is up: ${tag}`);
  const named = h.match(/(up|down) ([\d.]+)% (this week|over the last day)/);
  if (named) { const v = named[3] === "this week" ? moves.w1 : moves.h24; if (fmtMove(v) !== named[2]) out.push(`headline number ${named[2]} does not match the strip ${fmtMove(v)}: ${tag}`); }
  if (moves.dd7 <= -DRAWDOWN_NAMED && moves.hiDay && !h.includes("off its")) out.push(`a ${fmtMove(moves.dd7)}% drop from the week's high is not named: ${tag}`);
  if (moves.dd7 > -DRAWDOWN_NAMED && h.includes("off its")) out.push(`names a drop that is not there: ${tag}`);
  const back = meterBackdrop(moves);
  if (back === "down" && pos > 45) out.push(`down market but marker at ${pos}: ${tag}`);
  if (back === "up" && pos < 55) out.push(`up market but marker at ${pos}: ${tag}`);
  if (/Real uptrend/.test(meterStageLine(m, moves) || "") && (moves.w1 < 0 && moves.vs50 <= -NEAR_50 && moves.h24 < DAY_MOVE_NAMED)) out.push(`"Real uptrend" in a down market: ${tag}`);
  return out;
}
