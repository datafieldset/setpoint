// lib/trendRunner.js
//
// Server side of Trend Rider: fetches Bitcoin candles, keeps open trades
// moving on all six timeframes, opens new ones the moment price touches a
// breakout level, and pushes to admins on every timeframe.
// The rules live in lib/trend.js. Trades are ordinary signal_track rows
// (label "Trend Rider", target NULL because the stop trails), so every
// screen and API that shows the other signals shows this one too. Called
// from every check-signals run (about every 5 minutes) and never allowed
// to break that run.
import { getDailySMA, fetchFng, HEADERS } from "./marketContext.js";
import { TREND_COIN, TREND_TFS, TREND_ORDER, FILTER_DAYS, splitBars, makeHtf, precompute, analyze, advance } from "./trend.js";
import { ensureSignalTrack } from "./schema.js";

export const TREND_LABEL = "Trend Rider";
const SCAN_MS = 15 * 60 * 1000;

let stateReady = false;
// The run watermark: when the last fully successful run finished.
async function ensureTrendState(sql) {
  if (stateReady) return;
  await sql`CREATE TABLE IF NOT EXISTS trend_state (key TEXT PRIMARY KEY, val BIGINT NOT NULL)`;
  stateReady = true;
}

const price = (n) => "$" + Math.round(n).toLocaleString("en-US");

async function pushAdmins(sql, webpush, title, body) {
  const admins = await sql`
    SELECT DISTINCT ps.endpoint, ps.subscription
    FROM push_subscriptions ps JOIN users u ON u.email = ps.email
    WHERE u.is_admin = true
  `;
  const payload = JSON.stringify({ title, body, url: "/", tag: "trend-rider:" + title });
  let sent = 0;
  for (const sub of admins) {
    try { await webpush.sendNotification(sub.subscription, payload); sent++; } catch { /* dead subscription, skip */ }
  }
  return sent;
}
// A failed push must never undo or abort trade bookkeeping.
const safePush = async (sql, webpush, ...a) => { if (!webpush) return; try { await pushAdmins(sql, webpush, ...a); } catch { /* alerts are best effort */ } };

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
  await ensureSignalTrack(sql);
  await ensureTrendState(sql);
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
      const open = await sql`
        SELECT id, dir, entry, risk, stop, meta FROM signal_track
        WHERE coin = ${TREND_COIN} AND tf = ${tf} AND label = ${TREND_LABEL} AND outcome = 'open'
      `;
      for (const row of open) {
        const was = { stop: Number(row.stop), ext: Number(row.meta.ext), lastCheck: Number(row.meta.checkedTo) };
        const pos = { dir: row.dir, entry: Number(row.entry), risk: Number(row.risk), ...was };
        const r = advance(pos, cfg, checks, done, pre.atr, now);
        if (r.closed) {
          const upd = await sql`
            UPDATE signal_track
            SET outcome = ${r.r > 0 ? "win" : "loss"}, resolved_at = ${new Date(now)}, exit_price = ${r.exit}, r = ${r.r}, stop = ${r.stop},
                meta = meta || ${JSON.stringify({ ext: r.ext, checkedTo: r.lastCheck })}::jsonb
            WHERE id = ${row.id} AND outcome = 'open' RETURNING id
          `;
          if (!upd.length) continue; // another run already closed it
          res.closed++; result.closed++;
          if (cfg.alerts && r.lastCheck + cfg.checkSec * 1000 > now - 30 * 60 * 1000) { // never alert about something that ended long ago (a late catch-up run)
            const sign = r.r >= 0 ? "+" : "";
            await safePush(sql, webpush, `Trend Rider ${cfg.label} closed: Bitcoin ${row.dir === "bull" ? "buy" : "sell"}, ${sign}${r.r.toFixed(2)}R`, `In at ${price(Number(row.entry))}, out at ${price(r.exit)}. Looking for the next breakout.`);
          }
        } else if (r.stop !== was.stop || r.ext !== was.ext || r.lastCheck !== was.lastCheck) {
          // Only ever moves forward, so a slower run that finishes late can never undo a faster one.
          await sql`
            UPDATE signal_track
            SET stop = CASE WHEN dir = 'bull' THEN GREATEST(stop, ${r.stop}::numeric) ELSE LEAST(stop, ${r.stop}::numeric) END,
                meta = meta || jsonb_build_object(
                  'ext', CASE WHEN dir = 'bull' THEN GREATEST((meta->>'ext')::float8, ${r.ext}::float8) ELSE LEAST((meta->>'ext')::float8, ${r.ext}::float8) END,
                  'checkedTo', GREATEST((meta->>'checkedTo')::bigint, ${r.lastCheck}::bigint)
                )
            WHERE id = ${row.id} AND outcome = 'open'
          `;
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
      const lastShut = await sql`
        SELECT dir, max((meta->>'checkedTo')::bigint) AS lh FROM signal_track
        WHERE coin = ${TREND_COIN} AND tf = ${tf} AND label = ${TREND_LABEL} AND outcome IN ('win', 'loss') GROUP BY dir
      `;
      const shutAt = { bull: 0, bear: 0 };
      for (const x of lastShut) shutAt[x.dir] = Number(x.lh);
      let j0 = all.length - 1;
      while (j0 > 1 && all[j0 - 1].time + baseMs > now - scanMs) j0--; // oldest bar still inside the scan window
      for (let j = Math.max(1, j0); j < all.length; j++) { // oldest first: the first touch wins
        const bar = all[j];
        if (bar.time + baseMs <= now - scanMs) continue; // older than the scan window
        if (all[j - 1].time !== bar.time - baseMs) continue; // feed gap, skip
        const a = analyze(cfg, done, pre, j - 1, bar, { sma: ctx.sma, htf: ctx.htf });
        if (!a) continue;
        for (const e of [a.bull, a.bear]) {
          if (!e.fire || bar.time <= shutAt[e.dir]) continue;
          const lastCheck = bar.time - checkMs; // walk the whole entry bar, cautious like the study
          const ins = await sql`
            INSERT INTO signal_track (coin, tf, label, dir, fired_at, entry, stop, target, risk, bar_time, verified_at_fire, meta)
            VALUES (${TREND_COIN}, ${tf}, ${TREND_LABEL}, ${e.dir}, ${new Date(now)}, ${e.entry}, ${e.stop}, NULL, ${e.risk}, ${bar.time}, false,
                    ${JSON.stringify({ ext: e.entry, checkedTo: lastCheck, sma: ctx.sma, fng: ctx.fng, stretch: e.stretch })}::jsonb)
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          if (ins.length) {
            res.opened++; result.opened++;
            if (cfg.alerts && bar.time + baseMs > now - SCAN_MS) { // only alert on a fresh touch, not one found while catching up
              const pctAway = ((e.risk / e.entry) * 100).toFixed(1);
              await safePush(sql, webpush, `Trend Rider ${cfg.label}: Bitcoin ${e.dir === "bull" ? "buy" : "sell"} at ${price(e.entry)}`, `Trailing stop ${price(e.stop)} (${pctAway}% away). No fixed target, the stop follows price. Test signal.`);
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
