// app/components/MeterParts.jsx
//
// v25.7: the Market Meter card body and the Price vs averages card (ladder, tabs and the four charts), pulled out of app/page.jsx
// so the dashboard and the public /watch page draw the same thing from the same code. Their styles are in ./meterCss.js.
import React, { useState } from "react";
import { pickFocus, LINE_TINT } from "../../lib/lineFocus.js";
import { meterHeadline, meterStageLine, meterPos, meterFreshLine } from "../../lib/meter.js";
import { fmtPrice, fmtVol, fngColor } from "../../lib/format.js";

export function LockIcon({ size = 12 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
      <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6" /><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" />
    </svg>
  );
}

// The body of the Market Meter card: headline, gauge, read line, the 15m / 1h / 1d / 1w moves, and the Mood + Heavy volume row.
// `meter` is the 5 minute read from marketRegime(), `moves` is buildMeterMoves(). With `locked` the Mood + Heavy volume row is blurred
// behind a "Free account unlocks these" pill (it calls `onLocked` when pressed).
export function MeterCore({ meter, moves, fng, netFlow, locked = false, onLocked }) {
  const stage = meterStageLine(meter, moves);
  const fresh = meterFreshLine(moves);
  return (
    <>
      <div className="mm-headline">{meterHeadline(meter, moves)}</div>
      {fresh && <div className="mm-fresh">{fresh}</div>}
      <div className="mm-gauge" role="img" aria-label={`Short-term read: ${meter.label}`}>
        <div className="mm-gauge-bar"><span className="mm-marker" style={{ left: `${meterPos(meter, moves)}%` }} /></div>
        <div className="mm-gauge-ends"><span>Falling</span><span>Flat</span><span>Rising</span></div>
      </div>
      {stage && <div className={`mm-stage ${meter.phase === "ending" ? "ending" : ""}`}>{stage}</div>}
      {moves && (
        <div className="mm-moves">
          {[["15m", moves.m15], ["1h", moves.h1], ["1d", moves.h24], ["1w", moves.w1]].filter(([, v]) => v != null).map(([k, v]) => (
            <div key={k} className="mm-move"><span className="mm-move-k">{k}</span><span className={`mm-move-v mono ${v >= 0 ? "up" : "down"}`}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span></div>
          ))}
        </div>
      )}
      {(fng || netFlow) && (
        <div className={`mm-ctx ${locked ? "locked" : ""}`}>
          <div className="mm-ctx-cells" aria-hidden={locked || undefined}>
            {fng && (
              <div className="mm-ctx-i"><span className="mm-ctx-k">Mood</span><span className="mm-ctx-v"><span className="mono" style={{ color: fngColor(fng.value) }}>{fng.value}</span> {fng.label}</span></div>
            )}
            {netFlow && (
              <div className="mm-ctx-i"><span className="mm-ctx-k">Heavy volume 5h</span>
                {netFlow.txCount > 0 && netFlow.net !== 0
                  ? <span className={`mm-ctx-v ${netFlow.net > 0 ? "sell" : "buy"}`}>{netFlow.net > 0 ? "Net selling" : "Net buying"} <span className="mono">{fmtVol(Math.abs(netFlow.net))}</span></span>
                  : <span className="mm-ctx-v quiet">{netFlow.txCount > 0 ? "Even" : "None right now"}</span>}
              </div>
            )}
          </div>
          {locked && (
            <button type="button" className="mm-lock-pill" onClick={() => onLocked && onLocked()}><LockIcon size={14} /> Free account unlocks these</button>
          )}
        </div>
      )}
    </>
  );
}

// A real, deliberately different visual from the horizontal volatility
// meter used everywhere else, this is vertical, and the center of the
// track IS the MA line itself, not a neutral midpoint of some abstract
// score. The dot moves up when price is genuinely above the line,
// down when it's genuinely below, clamped at the real, given range so
// an extreme reading doesn't run off the track.
// A real, simple line chart, no charting library, just plain SVG — two
// real lines over the last 120 real days, so the actual crossover
// moment is something you can see happen, not just infer from two
// separate numbers. Marks the real, most recent point where the lines
// actually crossed, when one exists inside this window.
// Real price history plotted as an actual line, with the MA itself
// drawn as a flat, horizontal reference across it — replaces a single,
// static gauge with something that shows how price has actually
// approached and moved away from this level over real time.
// Real, evenly-spaced date labels pulled directly from a series' own
// real timestamps, shared by both charts below rather than two separate
// copies of the same real logic. Positioned by percentage, not pixels,
// so they line up correctly regardless of how wide the chart actually
// renders.
function buildAxisLabels(series, count, withYear) {
  if (!series || series.length < 2) return [];
  const labels = [];
  const step = (series.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    const idx = Math.round(i * step);
    const d = new Date(series[idx].time);
    const text = withYear ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short" });
    labels.push({ pct: (idx / (series.length - 1)) * 100, text });
  }
  return labels;
}

function ChartAxis({ labels }) {
  if (!labels.length) return null;
  return (
    <div className="chart-axis">
      {labels.map((l, i) => (
        <span key={i} className="chart-axis-label" style={{ left: `${l.pct}%` }}>{l.text}</span>
      ))}
    </div>
  );
}

// v20.9 (Na, Nov 3): all three long-term charts share one look: a white line, a dashed amber line, a translucent green fill where the
// first line is above the second and red where it is below, a dot on the point that matters, and the same height. `bandPolygons`
// builds the fill between two series and splits a segment at the exact point the lines cross, so a cross never smears across a day.
function bandPolygons(a, b, x, y) {
  const out = [];
  const poly = (pts, up, key) => out.push(<polygon key={key} points={pts.map(([px, py]) => `${px},${py}`).join(" ")} fill={up ? "var(--green)" : "var(--red)"} fillOpacity=".2" />);
  for (let i = 0; i < a.length - 1; i++) {
    const d0 = a[i] - b[i], d1 = a[i + 1] - b[i + 1];
    const A0 = [x(i), y(a[i])], A1 = [x(i + 1), y(a[i + 1])], B0 = [x(i), y(b[i])], B1 = [x(i + 1), y(b[i + 1])];
    if ((d0 >= 0) === (d1 >= 0) || d0 === 0 || d1 === 0) {
      poly([A0, A1, B1, B0], d0 + d1 >= 0, i);
    } else {
      const t = d0 / (d0 - d1);
      const cx = x(i) + t * (x(i + 1) - x(i));
      const cv = a[i] + t * (a[i + 1] - a[i]);
      const C = [cx, y(cv)];
      poly([A0, C, B0], d0 > 0, `${i}a`);
      poly([C, A1, B1], d1 > 0, `${i}b`);
    }
  }
  return out;
}

// v19.49 (Na, Oct 29): Bitcoin's daily price against its 50-day average over the last 90 days. The space between the
// two is shaded green while price is above the line and red while it's below, so a test of the line is easy to see.
// `price` is the live price; the last point of the series uses it so the dot is current.
function PriceVs50Chart({ series, price, field = "sma50", lineColor = LINE_TINT["50-day"] }) {  // field: which average to draw (v24.3: "sma200" for the 200-day tab)
  if (!series || series.length < 2) return null;
  const pts = series.map((p, i) => (i === series.length - 1 && price ? { ...p, close: price } : p));
  const W = 300, H = 120, PAD = 6;
  const vals = pts.flatMap((p) => [p.close, p[field]]);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = (i) => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const bands = bandPolygons(pts.map((p) => p.close), pts.map((p) => p[field]), x, y);
  const last = pts[pts.length - 1];
  const labels = [0, 1, 2, 3].map((k) => {
    const idx = Math.round((k * (pts.length - 1)) / 3);
    return { pct: (idx / (pts.length - 1)) * 100, text: new Date(pts[idx].time).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) };
  });
  return (
    <div className="chart-wrap">
      <div className="chart-plot">
      <svg className="cross-chart p50-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {bands}
        <polyline points={pts.map((p, i) => `${x(i)},${y(p[field])}`).join(" ")} fill="none" stroke={lineColor} strokeWidth="1.5" strokeDasharray="5,4" vectorEffect="non-scaling-stroke" />
        <polyline points={pts.map((p, i) => `${x(i)},${y(p.close)}`).join(" ")} fill="none" stroke="var(--text)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="p50-dot" style={{ left: `${(x(pts.length - 1) / W) * 100}%`, top: `${(y(last.close) / H) * 100}%` }} />
      </div>
      <ChartAxis labels={labels} />
    </div>
  );
}

// v19.50 (Na, Oct 29): the three Bitcoin average panels (200-week, 50/200-day, price vs 50-day) were a lot of scrolling.
// One card now: a price ladder showing where Bitcoin sits against each line, the exact close needed to break the 50-day,
// and tabs that show one chart at a time (50-day first, since that's the one in play).
// v25.7: `locked` (public /watch page, signed-out visitors) leaves the 200-week chart open and shows the other three tabs with a lock;
// pressing a locked tab calls `onLocked` (the page scrolls to its sign-up card).
export function LongTermLines({ weekly200, price: livePrice, locked = false, onLocked }) {
  const [tab, setTab] = useState(locked ? "w200" : "d50");
  const [about, setAbout] = useState(false);
  if (!weekly200) return null;
  const line50 = weekly200.daily50, line200 = weekly200.daily200, lineW = weekly200.sma;
  const lastClose = weekly200.dailyPrice?.length ? weekly200.dailyPrice[weekly200.dailyPrice.length - 1].close : null;
  const price = livePrice || lastClose;
  if (!price || line50 == null) return null;
  // v24.8 (Na, Nov 13): the highlight follows the line price is closest to (v24.9: always the closest, no cutoff), coloured by danger or opportunity.
  // Same rule as the share card (lib/lineFocus.js).
  const f = pickFocus(price, { d50: line50, d200: line200, w200: lineW });
  const toneVar = { amber: "var(--amber)", green: "var(--green-soft)", red: "var(--red-soft)" }[f.tone];
  const tag = `${f.tone === "amber" ? `Testing the ${f.key} from ${f.above ? "above" : "below"}` : `${f.above ? "Above" : "Below"} the ${f.key}`}, ${f.dist >= 0 ? "+" : ""}${f.dist.toFixed(1)}%`;

  // Ladder: every line and Bitcoin on one vertical scale, labels nudged apart so none overlap.
  const rungs = [
    { k: "50-day", v: line50, c: f.key === "50-day" ? toneVar : LINE_TINT["50-day"] },
    { k: "Bitcoin", v: price, c: toneVar, me: true },
    line200 != null && { k: "200-day", v: line200, c: f.key === "200-day" ? toneVar : LINE_TINT["200-day"] },
    lineW != null && { k: "200-week", v: lineW, c: f.key === "200-week" ? toneVar : "var(--muted)" },
  ].filter(Boolean).sort((x, y) => y.v - x.v);
  const hi = rungs[0].v, lo = rungs[rungs.length - 1].v, pad = (hi - lo) * 0.05 || 1;
  const LH = 190, top = 14, bot = LH - 14;
  const yOf = (v) => top + ((hi + pad - v) / (hi - lo + 2 * pad)) * (bot - top);
  let prevLabel = -99;
  const placed = rungs.map((r) => {
    const y = yOf(r.v);
    const ly = Math.max(y, prevLabel + 20);
    prevLabel = ly;
    return { ...r, y, ly };
  });

  const need = <>{f.pre}<b className="mono">${fmtPrice(f.v)}</b>{f.post}</>;
  const legends = {
    d50: <>White line is Bitcoin's daily close, dashed blue is the 50-day average (${fmtPrice(line50)}). Green fill: price above the line. Red: below.</>,
    d200: line200 != null ? <>White line is Bitcoin's daily close, dashed violet is the 200-day average (${fmtPrice(line200)}), {Math.abs(((price - line200) / line200) * 100).toFixed(1)}% {price >= line200 ? "below" : "above"} price. Green fill: price above the line. Red: below.</> : null,
    cross: line200 != null ? <>Dashed blue is the 50-day (${fmtPrice(line50)}), violet is the 200-day (${fmtPrice(line200)}). {line50 >= line200 ? "The 50 is above the 200, a golden cross. Green fill: 50 above 200." : "The 50 is below the 200, a death cross. Red fill: 50 below 200."} The dot is the most recent cross.</> : null,
    w200: lineW != null ? <>White line is Bitcoin's weekly close over the last 75 weeks, the dashed line is the 200-week average (${fmtPrice(lineW)}), {Math.abs(((price - lineW) / lineW) * 100).toFixed(1)}% {price >= lineW ? "below" : "above"} price. Green fill: price above the line. Red: below.</> : null,
  };
  const tabs = [["d50", "50‑day", weekly200.dailyPrice?.length > 1], ["d200", "200‑day", weekly200.dailyPrice200?.length > 1 && line200 != null], ["w200", "200‑week", weekly200.priceSeries?.length > 1 && lineW != null], ["cross", "Golden cross", weekly200.dailySeries?.length > 1 && line200 != null]].filter((t) => t[2]);
  const isOpen = (k) => !locked || k === "w200";
  const active = tabs.some((t) => t[0] === tab && isOpen(t[0])) ? tab : (tabs.find((t) => isOpen(t[0])) || tabs[0])?.[0];
  const golden = line200 != null && line50 >= line200;

  return (
    <div className="w200-panel lt-card">
      <div className="w200-head">Price vs averages</div>
      <div className={`cross-tag ${f.tone === "amber" ? "test" : f.tone === "green" ? "golden" : "death"}`}>{tag}</div>
      <svg className="lt-ladder" viewBox={`0 0 330 ${LH}`} role="img" aria-label={`Where Bitcoin sits against its averages: ${rungs.map((r) => `${r.k} $${fmtPrice(r.v)}`).join(", ")}`}>
        <line x1="14" y1={top - 4} x2="14" y2={bot + 4} stroke="var(--border)" strokeWidth="2" />
        {placed.map((r) => (
          <g key={r.k}>
            <circle cx="14" cy={r.y} r={r.me ? 6 : 4} fill={r.c} />
            <line x1="22" y1={r.y} x2="34" y2={r.ly - 4} stroke="var(--border)" />
            <text x="40" y={r.ly} fontSize={r.me ? 13.5 : 13} fontWeight={r.me ? 700 : 500} fill={r.c}>
              {r.k} ${fmtPrice(r.v)}
              {!r.me && <tspan fill="var(--muted)" fontSize="11.5" fontWeight="500">{" "}{(((price / r.v) - 1) * 100) >= 0 ? "+" : ""}{(((price / r.v) - 1) * 100).toFixed(1)}%</tspan>}
            </text>
          </g>
        ))}
      </svg>
      <div className="p50-need">{need}</div>
      <div className="lt-tabs" role="tablist">
        {tabs.map(([k, label]) => isOpen(k) ? (
          <button key={k} role="tab" aria-selected={active === k} className={`lt-tab ${active === k ? "on" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ) : (
          <button key={k} role="tab" aria-selected="false" aria-label={`${label}, unlocks with a free account`} className="lt-tab locked" onClick={() => onLocked && onLocked()}>{label}<LockIcon /></button>
        ))}
      </div>
      {active === "d50" && <PriceVs50Chart series={weekly200.dailyPrice} price={livePrice} />}
      {active === "cross" && <CrossoverChart series={weekly200.dailySeries} />}
      {active === "d200" && <PriceVs50Chart series={weekly200.dailyPrice200} price={livePrice} field="sma200" lineColor={LINE_TINT["200-day"]} />}
      {active === "w200" && <PriceVsMaChart series={weekly200.priceSeries} maValue={lineW} price={livePrice} lineColor={f.key === "200-week" ? toneVar : "var(--muted)"} />}
      <div className="lt-legend">{legends[active]}{locked ? " The other three charts unlock with a free account." : ""}</div>
      <div className="w200-note">
        Context, not a trading signal.{" "}
        <button className="lt-about" onClick={() => setAbout((v) => !v)} aria-expanded={about}>{about ? "Hide" : "About these lines"}</button>
      </div>
      {about && (
        <div className="w200-note lt-about-text">
          The line moves a little every day, so check it again at the close. Over ten years of history a daily close back above the 50-day has leaned bullish and a close under it bearish, but only about 30 cases each way. {golden ? "When the 50-day crosses above the 200-day, traders call that a golden cross." : "When the 50-day sits below the 200-day, traders call that a death cross."} The 200-week line is the long-run floor: every prior Bitcoin bear market has bottomed at or near it.
        </div>
      )}
    </div>
  );
}

// 200-week: weekly closes against the flat 200-week average. Same look as the 50-day chart, so time spent above or below it shows.
function PriceVsMaChart({ series, maValue, price, lineColor = "var(--muted)" }) {
  if (!series || series.length < 2 || maValue == null) return null;
  const pts = series.map((p, i) => (i === series.length - 1 && price ? { ...p, close: price } : p));
  const W = 300, H = 120, PAD = 6;
  const vals = [...pts.map((p) => p.close), maValue];
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = (i) => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const last = pts[pts.length - 1];
  return (
    <div className="chart-wrap">
      <div className="chart-plot">
      <svg className="cross-chart p50-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {bandPolygons(pts.map((p) => p.close), pts.map(() => maValue), x, y)}
        <line x1={PAD} y1={y(maValue)} x2={W - PAD} y2={y(maValue)} stroke={lineColor} strokeWidth="1.5" strokeDasharray="5,4" vectorEffect="non-scaling-stroke" />
        <polyline points={pts.map((p, i) => `${x(i)},${y(p.close)}`).join(" ")} fill="none" stroke="var(--text)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="p50-dot" style={{ left: `${(x(pts.length - 1) / W) * 100}%`, top: `${(y(last.close) / H) * 100}%` }} />
      </div>
      <ChartAxis labels={buildAxisLabels(series, 4, true)} />
    </div>
  );
}

// Golden cross: the 50-day (dashed blue, like everywhere else) against the 200-day (violet). Green fill while the 50 is above the 200
// (a golden cross), red while it is below (a death cross). The amber dot sits on the most recent cross.
function CrossoverChart({ series }) {
  if (!series || series.length < 2) return null;
  const W = 300, H = 120, PAD = 6;
  const vals = series.flatMap((p) => [p.sma50, p.sma200]);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = (i) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  // Most recent crossover inside this window, walking backward so the marker lands on the latest cross.
  let crossIdx = null;
  for (let i = series.length - 1; i > 0; i--) {
    const prevDiff = series[i - 1].sma50 - series[i - 1].sma200;
    const currDiff = series[i].sma50 - series[i].sma200;
    if ((prevDiff <= 0 && currDiff > 0) || (prevDiff >= 0 && currDiff < 0)) { crossIdx = i; break; }
  }
  return (
    <div className="chart-wrap">
      <div className="chart-plot">
      <svg className="cross-chart p50-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {bandPolygons(series.map((p) => p.sma50), series.map((p) => p.sma200), x, y)}
        <polyline points={series.map((p, i) => `${x(i)},${y(p.sma200)}`).join(" ")} fill="none" stroke={LINE_TINT["200-day"]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline points={series.map((p, i) => `${x(i)},${y(p.sma50)}`).join(" ")} fill="none" stroke={LINE_TINT["50-day"]} strokeWidth="1.5" strokeDasharray="5,4" vectorEffect="non-scaling-stroke" />
      </svg>
      {crossIdx != null && <span className="p50-dot cross-dot" style={{ left: `${(x(crossIdx) / W) * 100}%`, top: `${(y(series[crossIdx].sma50) / H) * 100}%` }} />}
      </div>
      <ChartAxis labels={buildAxisLabels(series, 4, false)} />
    </div>
  );
}

