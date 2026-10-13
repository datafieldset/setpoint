// lib/trendRunner.js
//
// Server side of Trend Rider (v19.23): fetches Bitcoin candles, keeps open
// trades moving on all six timeframes, opens new ones the moment price
// touches a breakout level, pushes to the admin for the two alerting
// timeframes, and feeds the public panel. Rules live in lib/trend.js.
// Called from every check-signals run (about every 5 minutes) and never
// allowed to break that run.
import { getDailySMA, fetchFng, HEADERS } from "./marketContext.js";
import { TREND_COIN, TREND_TFS, TREND_ORDER, FILTER_DAYS, FEAR_LINE, splitBars, makeHtf, precompute, analyze, advance, openR } from "./trend.js";
import { TREND_REF } from "./trendRef.js";

let tableReady = false;
const SCAN_MS = 15 * 60 * 1000;

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
  // v19.23: one row per trade per timeframe. last_hour now holds the start
  // time of the last check candle already processed (name kept, no rename).
  await sql`ALTER TABLE trend_positions ADD COLUMN IF NOT EXISTS tf TEXT NOT NULL DEFAULT '4h'`;
  await sql`ALTER TABLE trend_positions ADD COLUMN IF NOT EXISTS fng INTEGER`;
  await sql`ALTER TABLE trend_positions ADD COLUMN IF NOT EXISTS stretch DOUBLE PRECISION`;
  await sql`DROP INDEX IF EXISTS trend_one_open_per_dir`;
  await sql`DROP INDEX IF EXISTS trend_one_per_bar`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS trend_open_per_tf_dir ON trend_positions (coin, tf, dir) WHERE status = 'open'`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS trend_one_per_tf_bar ON trend_positions (coin, tf, dir, bar_time)`;
  await sql`CREATE TABLE IF NOT EXISTS trend_state (key TEXT PRIMARY KEY, val BIGINT NOT NULL)`;
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
// A failed push must never undo or abort trade bookkeeping.
const safePush = async (...a) => { try { await pushAdmins(...a); } catch { /* alerts are best effort */ } };

// ---------------------------------------------------------------- candles

const GRAN_CACHE = new Map();
const CACHE_MS = 25000;
const toCandle = (x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4] });

// Up to `pages` x 300 most recent candles of granularity `sec` (ascending).
async function fetchGran(sec, pages = 1) {
  const key = `${sec}:${pages}`;
  const hit = GRAN_CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  let all = [];
  let end = null;
  for (let p = 0; p < pages; p++) {
    let url = `https://api.exchange.coinbase.com/products/${TREND_COIN}-USD/candles?granularity=${sec}`;
    if (end) url += `&start=${new Date(end - 300 * sec * 1000).toISOString()}&end=${new Date(end - 1000).toISOString()}`;
    const r = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`feed ${r.status}`);
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    const chunk = raw.map(toCandle).filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
    all = chunk.concat(all);
    end = chunk[0].time;
  }
  if (!all.length) throw new Error("no data");
  GRAN_CACHE.set(key, { data: all, at: Date.now() });
  return all;
}
// One feed hiccup should cost one timeframe at most: fall back to the last good copy (up to 10 minutes old) before giving up.
async function fetchGranSafe(sec, pages) {
  try { return await fetchGran(sec, pages); }
  catch (e) {
    const hit = GRAN_CACHE.get(`${sec}:${pages}`);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
    throw e;
  }
}

// What each timeframe's bars are built from, and what its stops are checked on.
const SRC = { "4h": [3600, 2], "1h": [3600, 2], "30m": [900, 1], "15m": [900, 1], "5m": [300, 1], "1m": [60, 1] };
const CHECK = { "4h": [3600, 2], "1h": [300, 1], "30m": [300, 1], "15m": [300, 1], "5m": [60, 1], "1m": [60, 1] };

let fngCache = { at: 0, value: null };
async function crowd() {
  if (Date.now() - fngCache.at < 30 * 60 * 1000) return fngCache.value;
  const f = await fetchFng();
  fngCache = { at: Date.now(), value: f ? f.value : fngCache.value };
  return fngCache.value;
}

// Everything the engine needs, fetched once per run (shared by all six).
async function loadContext(deps, now) {
  const get = deps.fetchGran || fetchGranSafe;
  const need = new Map();
  for (const k of TREND_ORDER) { const [s, p] = SRC[k]; need.set(`${s}:${p}`, [s, p]); const [cs, cp] = CHECK[k]; need.set(`${cs}:${cp}`, [cs, cp]); }
  const candles = {}, failed = {};
  await Promise.all([...need.entries()].map(async ([key, [s, p]]) => {
    try { candles[key] = await get(s, p); } catch (e) { failed[key] = String(e.message || e).slice(0, 80); }
  }));
  let sma = null;
  try { sma = await (deps.getDailySMA || getDailySMA)(TREND_COIN, FILTER_DAYS); } catch { /* no entries this run, open trades still managed */ }
  const hourly = candles["3600:2"];
  const htf = hourly ? makeHtf(splitBars(hourly, 3600, 3600, now).done, splitBars(hourly, 14400, 3600, now).done) : null;
  let fng = null;
  try { fng = await (deps.crowd || crowd)(); } catch { /* tag stays empty */ }
  return { candles, failed, sma, htf, fng, now };
}

// Bars, indicators and the forming bar for one timeframe.
function tfView(tf, ctx) {
  const cfg = TREND_TFS[tf];
  const [s, p] = SRC[tf];
  const [cs, cp] = CHECK[tf];
  const baseC = ctx.candles[`${s}:${p}`], checks = ctx.candles[`${cs}:${cp}`];
  if (!baseC || !checks || !ctx.htf) throw new Error(ctx.failed[`${s}:${p}`] || ctx.failed[`${cs}:${cp}`] || ctx.failed["3600:2"] || "feed unavailable");
  const { done, forming } = splitBars(baseC, cfg.baseSec, s, ctx.now);
  const pre = precompute(done);
  const lastPrice = checks.length ? checks[checks.length - 1].close : (done.length ? done[done.length - 1].close : null);
  return { cfg, done, forming, pre, checks, lastPrice };
}

// ---------------------------------------------------------------- the run

export async function runTrend(sql, webpush, deps = {}) {
  await ensureTrendTable(sql);
  const now = deps.now || Date.now();
  const ctx = await loadContext(deps, now);
  const result = { opened: 0, closed: 0, byTf: {} };
  // scan back to the last successful run (at least 15 minutes, at most what the candles hold), so a late cron never skips touches
  const mark = await sql`SELECT val FROM trend_state WHERE key = 'last_run'`;
  const lastRun = mark.length ? Number(mark[0].val) : 0;
  const scanMs = Math.min(4 * 3600 * 1000, Math.max(SCAN_MS, lastRun ? now - lastRun + 2 * 60 * 1000 : 0));

  for (const tf of TREND_ORDER) {
    const res = { opened: 0, closed: 0 };
    result.byTf[tf] = res;
    try {
      const v = tfView(tf, ctx);
      const { cfg, done, forming, pre, checks } = v;
      if (done.length < cfg.N + 40) { res.skipped = "not_enough_bars"; continue; }

      // 1. keep open trades moving
      const open = await sql`SELECT * FROM trend_positions WHERE coin = ${TREND_COIN} AND tf = ${tf} AND status = 'open'`;
      for (const row of open) {
        const pos = { dir: row.dir, entry: row.entry, risk: row.risk, stop: row.stop, ext: row.ext, lastCheck: Number(row.last_hour) };
        const r = advance(pos, cfg, checks, done, pre.atr, now);
        if (r.closed) {
          const upd = await sql`UPDATE trend_positions SET status = 'closed', exit = ${r.exit}, r = ${r.r}, closed_at = now(), stop = ${r.stop}, ext = ${r.ext}, last_hour = ${r.lastCheck} WHERE id = ${row.id} AND status = 'open' RETURNING id`;
          if (!upd.length) continue; // another run already closed it
          res.closed++; result.closed++;
          if (cfg.alerts) {
            const sign = r.r >= 0 ? "+" : "";
            await safePush(sql, webpush, `Trend Rider ${cfg.label} closed: Bitcoin ${row.dir === "long" ? "buy" : "sell"}, ${sign}${r.r.toFixed(2)}R`, `In at ${price(row.entry)}, out at ${price(r.exit)}. Looking for the next breakout.`);
          }
        } else if (r.stop !== row.stop || r.ext !== row.ext || r.lastCheck !== Number(row.last_hour)) {
          await sql`UPDATE trend_positions SET stop = CASE WHEN dir = 'long' THEN GREATEST(stop, ${r.stop}) ELSE LEAST(stop, ${r.stop}) END, ext = CASE WHEN dir = 'long' THEN GREATEST(ext, ${r.ext}) ELSE LEAST(ext, ${r.ext}) END, last_hour = GREATEST(last_hour, ${r.lastCheck}) WHERE id = ${row.id} AND status = 'open'`;
        }
      }

      // 2. new entries. The cron looks every ~5 minutes, so scan every bar
      //    active in the last 15 minutes (the forming one and any that just
      //    finished). Fills are at the breakout level, as in the study, and
      //    a touch is only ever recorded once (unique index on the bar).
      const baseMs = cfg.baseSec * 1000, checkMs = cfg.checkSec * 1000;
      const all = forming ? done.concat([forming]) : done;
      // one trade at a time per direction: never enter on a bar that began
      // before the previous trade in that direction finished
      const lastShut = await sql`SELECT dir, max(last_hour)::bigint AS lh FROM trend_positions WHERE coin = ${TREND_COIN} AND tf = ${tf} AND status = 'closed' GROUP BY dir`;
      const shutAt = { long: 0, short: 0 };
      for (const x of lastShut) shutAt[x.dir] = Number(x.lh);
      let j0 = all.length - 1;
      while (j0 > 1 && all[j0 - 1].time + baseMs > now - scanMs) j0--; // oldest bar still inside the scan window
      for (let j = Math.max(1, j0); j < all.length; j++) { // oldest first: the first touch wins
        const bar = all[j];
        if (bar.time + baseMs <= now - scanMs) continue; // older than the scan window
        if (all[j - 1].time !== bar.time - baseMs) continue; // feed gap, skip
        const a = analyze(cfg, done, pre, j - 1, bar, { sma: ctx.sma, htf: ctx.htf });
        if (!a) continue;
        for (const e of [a.long, a.short]) {
          if (!e.fire || bar.time <= shutAt[e.dir]) continue;
          const lastCheck = bar.time - checkMs; // walk the whole entry bar, cautious like the study
          const ins = await sql`
            INSERT INTO trend_positions (coin, tf, dir, bar_time, entry, risk, stop, ext, last_hour, sma, fng, stretch)
            VALUES (${TREND_COIN}, ${tf}, ${e.dir}, ${bar.time}, ${e.entry}, ${e.risk}, ${e.stop}, ${e.entry}, ${lastCheck}, ${ctx.sma}, ${ctx.fng}, ${e.stretch})
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          if (ins.length) {
            res.opened++; result.opened++;
            if (cfg.alerts) {
              const pctAway = ((e.risk / e.entry) * 100).toFixed(1);
              await safePush(sql, webpush, `Trend Rider ${cfg.label}: Bitcoin ${e.dir === "long" ? "buy" : "sell"} at ${price(e.entry)}`, `Trailing stop ${price(e.stop)} (${pctAway}% away). No fixed target, the stop follows price. Test signal.`);
            }
          }
        }
      }
    } catch (err) {
      res.error = String(err.message || err).slice(0, 120); // one timeframe failing never stops the others
    }
  }
  if (!Object.keys(ctx.failed).length) await sql`INSERT INTO trend_state (key, val) VALUES ('last_run', ${now}) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val`;
  else result.feedFailed = ctx.failed;
  return result;
}

// ---------------------------------------------------------------- the panel

const emptyRec = () => ({ trades: 0, wins: 0, losses: 0, winPct: null, totalR: 0, avgR: null });
function recOf(rows) {
  const r = emptyRec();
  for (const x of rows) { r.trades += x.n; r.wins += x.wins; r.totalR += x.total_r; }
  r.losses = r.trades - r.wins;
  r.winPct = r.trades ? Math.round((100 * r.wins) / r.trades) : null;
  r.avgR = r.trades ? r.totalR / r.trades : null;
  return r;
}

// Everything the public panel shows, per timeframe.
export async function trendState(sql, deps = {}) {
  const now = deps.now || Date.now();
  const ctx = await loadContext(deps, now);
  const readDb = async () => ({
    recRows: await sql`
      SELECT tf, dir, count(*)::int AS n,
             coalesce(sum(CASE WHEN r > 0 THEN 1 ELSE 0 END), 0)::int AS wins,
             coalesce(sum(r), 0)::float AS total_r
      FROM trend_positions WHERE coin = ${TREND_COIN} AND status = 'closed' GROUP BY tf, dir
    `,
    crowdRows: await sql`
      SELECT tf, (fng IS NOT NULL AND fng <= ${FEAR_LINE}) AS fearful, count(*)::int AS n,
             coalesce(sum(CASE WHEN r > 0 THEN 1 ELSE 0 END), 0)::int AS wins
      FROM trend_positions WHERE coin = ${TREND_COIN} AND status = 'closed' AND fng IS NOT NULL GROUP BY tf, fearful
    `,
    openRows: await sql`SELECT * FROM trend_positions WHERE coin = ${TREND_COIN} AND status = 'open' ORDER BY opened_at DESC`,
    closedRows: await sql`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY tf ORDER BY closed_at DESC) AS rn
        FROM trend_positions WHERE coin = ${TREND_COIN} AND status = 'closed'
      ) t WHERE rn <= 12 ORDER BY closed_at DESC
    `,
  });
  let db;
  try { db = await readDb(); }
  catch { await ensureTrendTable(sql); db = await readDb(); } // first ever visit before the cron has created the table
  const { recRows, crowdRows, openRows, closedRows } = db;

  const out = {};
  let btcPrice = null;
  for (const tf of TREND_ORDER) {
    let view = null, a = null, err = null;
    try {
      view = tfView(tf, ctx);
      if (view.done.length >= view.cfg.N + 40) a = analyze(view.cfg, view.done, view.pre, view.done.length - 1, view.forming, { sma: ctx.sma, htf: ctx.htf });
    } catch (e) { err = String(e.message || e).slice(0, 100); }
    if (view && view.lastPrice && tf === "1m") btcPrice = view.lastPrice;
    const mine = recRows.filter((r) => r.tf === tf);
    const cr = crowdRows.filter((r) => r.tf === tf);
    const fear = cr.find((r) => r.fearful), greed = cr.find((r) => !r.fearful);
    const lp = view ? view.lastPrice : null;
    out[tf] = {
      label: TREND_TFS[tf].label,
      alerts: TREND_TFS[tf].alerts,
      error: err,
      watch: a ? {
        price: lp ?? a.price,
        atr: a.atr,
        buy: { level: a.long.level, conds: a.long.conds },
        sell: { level: a.short.level, conds: a.short.conds },
      } : null,
      open: openRows.filter((p) => p.tf === tf).map((p) => ({
        id: p.id, dir: p.dir, openedAt: p.opened_at, entry: p.entry, stop: p.stop, risk: p.risk, ext: p.ext,
        openR: lp ? openR(p, lp) : null, fng: p.fng,
      })),
      closed: closedRows.filter((p) => p.tf === tf).slice(0, 12).map((p) => ({ id: p.id, dir: p.dir, openedAt: p.opened_at, closedAt: p.closed_at, entry: p.entry, exit: p.exit, r: p.r })),
      record: {
        all: recOf(mine),
        buys: recOf(mine.filter((r) => r.dir === "long")),
        sells: recOf(mine.filter((r) => r.dir === "short")),
        crowd: {
          fearful: fear ? { trades: fear.n, wins: fear.wins, winPct: fear.n ? Math.round((100 * fear.wins) / fear.n) : null } : { trades: 0, wins: 0, winPct: null },
          greedy: greed ? { trades: greed.n, wins: greed.wins, winPct: greed.n ? Math.round((100 * greed.wins) / greed.n) : null } : { trades: 0, wins: 0, winPct: null },
        },
      },
      ref: TREND_REF[tf] || null,
    };
  }
  return { asOf: now, price: btcPrice, sma: ctx.sma, fng: ctx.fng, order: TREND_ORDER, tfs: out };
}
