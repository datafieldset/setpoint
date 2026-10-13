// lib/trendRunner.js
//
// Server side of Trend Rider: fetches Bitcoin candles, opens a trade the
// moment price touches a breakout level on any of the six timeframes, and
// pushes to admins when it does. The rules live in lib/trend.js. Trades are
// ordinary signal_track rows (label "Trend Rider") with a stop and a target,
// so they are closed by the same resolver as every other signal
// (lib/resolve.js, called here and by close-alert) and every screen and API
// that shows the other signals shows this one too. Called from every
// check-signals run (about every 5 minutes) and never allowed to break it.
import { getDailySMA, fetchFng, HEADERS } from "./marketContext.js";
import { TREND_COIN, TREND_TFS, TREND_ORDER, FILTER_DAYS, splitBars, makeHtf, precompute, analyze } from "./trend.js";
import { ensureSignalTrack } from "./schema.js";
import { resolveOpenTrades } from "./resolve.js";
import { brandName } from "./brand.js";

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

async function pushAdmins(sql, webpush, title, body, tag) {
  const admins = await sql`
    SELECT DISTINCT ps.endpoint, ps.subscription
    FROM push_subscriptions ps JOIN users u ON u.email = ps.email
    WHERE u.is_admin = true
  `;
  const payload = JSON.stringify({ title, body, url: "/", tag });
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

// What each timeframe's bars are built from: [candle size in seconds, pages of 300].
const SRC = { "4h": [3600, 2], "1h": [3600, 2], "30m": [900, 1], "15m": [900, 1], "5m": [300, 1], "1m": [60, 1] };

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
  for (const k of TREND_ORDER) { const [s, p] = SRC[k]; need.set(`${s}:${p}`, [s, p]); }
  need.set("3600:2", [3600, 2]); // the 1h and 4h charts every faster chart is checked against
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
  const baseC = ctx.candles[`${s}:${p}`];
  if (!baseC || !ctx.htf) throw new Error(ctx.failed[`${s}:${p}`] || ctx.failed["3600:2"] || "feed unavailable");
  const { done, forming } = splitBars(baseC, cfg.baseSec, s, ctx.now);
  return { cfg, done, forming, pre: precompute(done) };
}

// ---------------------------------------------------------------- the run

export async function runTrend(sql, webpush, deps = {}) {
  await ensureSignalTrack(sql);
  await ensureTrendState(sql);
  const now = deps.now || Date.now();
  // close anything that has reached its stop or target first, so a finished trade never blocks the next one
  let closedInfo = { resolved: 0 };
  try { closedInfo = await Promise.race([resolveOpenTrades(sql, deps.resolveIo), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 8000))]); } catch { /* close-alert also resolves, a hiccup here only delays closing */ }
  const ctx = await loadContext(deps, now);
  const result = { opened: 0, closed: closedInfo.resolved, byTf: {} };
  // scan back to the last successful run (at least 15 minutes, at most what the candles hold), so a late cron never skips touches
  const mark = await sql`SELECT val FROM trend_state WHERE key = 'last_run'`;
  const lastRun = mark.length ? Number(mark[0].val) : 0;
  const scanMs = Math.min(4 * 3600 * 1000, Math.max(SCAN_MS, lastRun ? now - lastRun + 2 * 60 * 1000 : 0));

  for (const tf of TREND_ORDER) {
    const res = { opened: 0 };
    result.byTf[tf] = res;
    try {
      const v = tfView(tf, ctx);
      const { cfg, done, forming, pre } = v;
      if (done.length < cfg.N + 40) { res.skipped = "not_enough_bars"; continue; }

      // New entries. The cron looks every ~5 minutes, so scan every bar
      //    active in the last 15 minutes (the forming one and any that just
      //    finished). Fills are at the breakout level, as in the study, and
      //    a touch is only ever recorded once (unique index on the bar).
      const baseMs = cfg.baseSec * 1000;
      const all = forming ? done.concat([forming]) : done;
      // one trade at a time per direction: never enter on a bar that began
      // before the previous trade in that direction finished
      const lastShut = await sql`
        SELECT dir, max(extract(epoch FROM resolved_at) * 1000)::bigint AS lh FROM signal_track
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
          // The resolver starts checking at the beginning of the entry bar (scanFrom), cautious like the study: the whole bar counts.
          const ins = await sql`
            INSERT INTO signal_track (coin, tf, label, dir, fired_at, entry, stop, target, bar_time, verified_at_fire, meta)
            VALUES (${TREND_COIN}, ${tf}, ${TREND_LABEL}, ${e.dir}, ${new Date(now)}, ${e.entry}, ${e.stop}, ${e.target}, ${bar.time}, false,
                    ${JSON.stringify({ scanFrom: bar.time, sma: ctx.sma, fng: ctx.fng, stretch: e.stretch })}::jsonb)
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          if (ins.length) {
            res.opened++; result.opened++;
            if (bar.time + baseMs > now - SCAN_MS) { // only alert on a fresh touch, not one found while catching up
              await safePush(sql, webpush, `${e.dir === "bull" ? "Buy" : "Sell"} ${brandName(TREND_LABEL)}`, `BTC · ${tf}. Entry ${price(e.entry)} · Target ${price(e.target)} · Stop ${price(e.stop)}`, `trend-rider:${tf}:${e.dir}:${bar.time}`);
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
