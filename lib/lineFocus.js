// lib/lineFocus.js
//
// Which long-term line to highlight, and how much danger or opportunity it carries (v24.8, Nov 13, Na). One rule for the share card
// (lib/meterCard.js) and the page's "Bitcoin vs its long-term lines" card (app/page.jsx), so they can never disagree.
//   - The highlight goes to the line price is closest to, if it is within 5% of it. Otherwise it stays on the 50-day, the "flip the story" line.
//   - Colour: amber = within 1% of it (being tested), green = more than 1% above it (a cushion), red = more than 1% below it (overhead).
//   - The sentence under the ladder follows the highlighted line and colour.
export const FOCUS_MAX_PCT = 5;
export const FOCUS_AMBER_PCT = 1;

// {p} is where the price of the highlighted line goes.
const FOCUS_TEXT = {
  "200-week": { amberAbove: "Holding above the 200-week ({p}) keeps the long-term floor.", amberBelow: "Back above the 200-week ({p}) would reclaim the long-term floor.", green: "Above the 200-week ({p}), the long-term floor is holding.", red: "Below the 200-week ({p}). Reclaiming it is step one." },
  "200-day": { amberAbove: "Holding above the 200-day ({p}) keeps the long-term trend.", amberBelow: "A close back above the 200-day ({p}) would reclaim the trend.", green: "Above the 200-day ({p}), the long-term trend is intact.", red: "Below the 200-day ({p}). A daily close back above is step one." },
  "50-day": { amberAbove: "Holding above the 50-day ({p}) keeps the short-term trend up.", amberBelow: "A daily close back above the 50-day ({p}) flips the story.", green: "Above the 50-day ({p}), the short-term trend is up.", red: "Flip the story with a daily close above {p}" },
};

// price and the three line values (d50 is required, the other two may be missing). Returns { key, v, dist, tone, above, pre, post, gap }.
export function pickFocus(price, { d50, d200, w200 }) {
  const lines = [{ key: "50-day", v: d50 }, { key: "200-day", v: d200 }, { key: "200-week", v: w200 }]
    .filter((l) => l.v > 0)
    .map((l) => ({ ...l, dist: (price / l.v - 1) * 100 }));
  if (!lines.length || !(price > 0)) return null;
  const nearest = lines.reduce((a, b) => (Math.abs(b.dist) < Math.abs(a.dist) ? b : a));
  const f = Math.abs(nearest.dist) <= FOCUS_MAX_PCT ? nearest : lines.find((l) => l.key === "50-day") || lines[0];
  const tone = Math.abs(f.dist) <= FOCUS_AMBER_PCT ? "amber" : f.dist > 0 ? "green" : "red";
  const above = f.dist >= 0;
  const [pre, post] = FOCUS_TEXT[f.key][tone === "amber" ? (above ? "amberAbove" : "amberBelow") : tone].split("{p}");
  return { key: f.key, v: f.v, dist: f.dist, tone, above, pre, post, gap: /\s$/.test(pre) };
}
