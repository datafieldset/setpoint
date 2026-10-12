// lib/trendRunner.js
//
// Server side of Trend Rider: fetches Bitcoin candles, keeps the open
// trades moving, opens new ones, and pushes to the admin. Rules live in
// lib/trend.js. Called from every check-signals run (every 5 minutes) and
// never allowed to break that run.
import { fetchCandles, getDailySMA } from "./marketContext.js";
import { TREND, build4hBars, atrSeries, entryAt, advancePosition, triggerLevels, openR } from "./trend.js";

const BAR = TREND.barHours * 3600 * 1000;
const HOUR = 3600 * 1000;
let tableReady = false;

export async function ensureTrendTable(sql) {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS trend_positions (
      id SERIAL PRIMARY KEY,
      coin TEXT NOT NULL DEFAULT 'BTC',
      dir TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      bar_time BIGINT NOT NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      entry DOUBLE PRECISION NOT NULL,
      risk DOUBLE PRECISION NOT NULL,
      stop DOUBLE PRECISION NOT NULL,
      ext DOUBLE PRECISION NOT NULL,
      last_hour BIGINT NOT NULL,
      sma DOUBLE PRECISION,
      exit DOUBLE PRECISION,
      closed_at TIMESTAMPTZ,
      r DOUBLE PRECISION
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS trend_one_open_per_dir ON trend_positions (coin, dir) WHERE status = 'open'`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS trend_one_per_bar ON trend_positions (coin, dir, bar_time)`;
  tableReady = true;
}

const price = (n) => "$" + Math.round(n).toLocaleString("en-US");

async function pushAdmins(sql, webpush, title, body) {
  const admins = await sql`
    SELECT DISTINCT ps.endpoint, ps.subscription
    FROM push_subscriptions ps JOIN users u ON u.email = ps.email
    WHERE u.is_admin = true
  `;
  const payload = JSON.stringify({ title, body, url: "/", tag: "trend-rider" });
  let sent = 0;
  for (const sub of admins) {
    try { await webpush.sendNotification(sub.subscription, payload); sent++; } catch { /* dead subscription, skip */ }
  }
  return sent;
}

export async function runTrend(sql, webpush, deps = {}) {
  await ensureTrendTable(sql);
  const hourly = await (deps.fetchCandles || fetchCandles)(TREND.coin, "1h"); // ~300 hourly bars, ascending
  const now = deps.now || Date.now();
  const bars = build4hBars(hourly, now);
  if (bars.length < TREND.breakoutBars + 2) return { skipped: "not_enough_bars" };
  const atrs = atrSeries(bars);
  const result = { closed: 0, opened: 0 };

  // 1. keep open trades moving
  const open = await sql`SELECT * FROM trend_positions WHERE coin = ${TREND.coin} AND status = 'open'`;
  for (const row of open) {
    const pos = { dir: row.dir, entry: row.entry, risk: row.risk, stop: row.stop, ext: row.ext, lastHour: Number(row.last_hour) };
    const res = advancePosition(pos, hourly, bars, atrs, now);
    if (res.closed) {
      const done = await sql`UPDATE trend_positions SET status = 'closed', exit = ${res.exit}, r = ${res.r}, closed_at = now(), stop = ${res.stop}, ext = ${res.ext}, last_hour = ${res.lastHour} WHERE id = ${row.id} AND status = 'open' RETURNING id`;
      if (!done.length) continue; // another run already closed it
      result.closed++;
      const sign = res.r >= 0 ? "+" : "";
      await pushAdmins(sql, webpush, `Trend Rider closed: Bitcoin ${row.dir}, ${sign}${res.r.toFixed(2)}R`, `Entered ${price(row.entry)}, stopped out at ${price(res.exit)}. Looking for the next breakout.`);
    } else if (res.stop !== row.stop || res.ext !== row.ext || res.lastHour !== Number(row.last_hour)) {
      await sql`UPDATE trend_positions SET stop = ${res.stop}, ext = ${res.ext}, last_hour = ${res.lastHour} WHERE id = ${row.id} AND status = 'open'`;
    }
  }

  // 2. look for a new entry on the latest completed 4h bar
  let sma = null;
  try { sma = await (deps.getDailySMA || getDailySMA)(TREND.coin, TREND.filterDays); } catch { /* no entries this run, existing trades still managed above */ }
  if (sma) {
    const i = bars.length - 1;
    const latestDue = Math.floor((now - BAR) / BAR) * BAR; // newest bar that should be complete
    const e = bars[i].time !== latestDue ? null : entryAt(bars, i, sma, atrs);
    if (e) {
      const ins = await sql`
        INSERT INTO trend_positions (coin, dir, bar_time, entry, risk, stop, ext, last_hour, sma)
        VALUES (${TREND.coin}, ${e.dir}, ${e.barTime}, ${e.entry}, ${e.risk}, ${e.stop}, ${e.entry}, ${e.barTime + BAR - HOUR}, ${sma})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (ins.length) {
        result.opened++;
        const pct = ((e.risk / e.entry) * 100).toFixed(1);
        await pushAdmins(sql, webpush, `Trend Rider: Bitcoin ${e.dir === "long" ? "buy" : "sell"} at ${price(e.entry)}`, `Trailing stop ${price(e.stop)} (${pct}% away). No fixed target, the stop follows price. Test signal.`);
      }
    }
  }
  return result;
}

// Everything the dashboard panel needs.
export async function trendState(sql) {
  await ensureTrendTable(sql);
  const hourly = await fetchCandles(TREND.coin, "1h");
  const bars = build4hBars(hourly, Date.now());
  let sma = null;
  try { sma = await getDailySMA(TREND.coin, TREND.filterDays); } catch { /* shown as unavailable */ }
  const last = hourly[hourly.length - 1];
  const priceNow = last ? last.close : null;
  const open = await sql`SELECT * FROM trend_positions WHERE coin = ${TREND.coin} AND status = 'open' ORDER BY opened_at DESC`;
  const closed = await sql`SELECT * FROM trend_positions WHERE coin = ${TREND.coin} AND status = 'closed' ORDER BY closed_at DESC LIMIT 40`;
  const all = await sql`SELECT count(*)::int AS n, coalesce(sum(CASE WHEN r > 0 THEN 1 ELSE 0 END), 0)::int AS wins, coalesce(sum(r), 0)::float AS total_r FROM trend_positions WHERE coin = ${TREND.coin} AND status = 'closed'`;
  const a = all[0] || { n: 0, wins: 0, total_r: 0 };
  return {
    config: TREND,
    price: priceNow,
    triggers: bars.length >= TREND.breakoutBars ? triggerLevels(bars, sma) : null,
    open: open.map((p) => ({ id: p.id, dir: p.dir, openedAt: p.opened_at, entry: p.entry, stop: p.stop, risk: p.risk, ext: p.ext, openR: priceNow ? openR(p, priceNow) : null })),
    closed: closed.map((p) => ({ id: p.id, dir: p.dir, openedAt: p.opened_at, closedAt: p.closed_at, entry: p.entry, exit: p.exit, r: p.r })),
    record: { trades: a.n, wins: a.wins, totalR: a.total_r, avgR: a.n ? a.total_r / a.n : null },
  };
}
