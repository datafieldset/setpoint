// End-to-end test of lib/trendRunner.js and the shared resolver with a real Postgres (pglite) and a fake candle feed.
// Walks time forward in 5-minute steps through recent history, calling runTrend exactly as the cron would.
import fs from "fs";
import * as R from "../../lib/trendRunner.js";
import { aggregate } from "../../lib/resolve.js";
import { TF } from "../../lib/timeframes.js";
import { TREND_ORDER } from "../../lib/trend.js";

const load = (f) => JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0] * 1000, low: r[1], high: r[2], open: r[3], close: r[4] })).filter((x) => x.close > 0).sort((a, b) => a.time - b.time);
const data = { 60: load("BTC_1m.json"), 300: load("BTC_5m.json"), 900: load("BTC_15m.json"), 3600: load("BTC_1h.json") };
const d1 = load("BTC_1d.json");
const smaOf = (now) => { const day = Math.floor(now / 864e5) * 864e5; const done = d1.filter((x) => x.time < day).slice(-200); return done.length === 200 ? done.reduce((s, x) => s + x.close, 0) / 200 : null; };

// candles as the live feed would show at time `now`: completed candles plus the in-progress one built from finer data
const SCALE = { BTC: 1, XLM: 0.19 / 83000 }; // XLM is the Bitcoin series scaled to a 19 cent coin, to exercise the second-coin path
const sc = (c, k) => (k === 1 ? c : c.map((x) => ({ ...x, open: x.open * k, high: x.high * k, low: x.low * k, close: x.close * k })));
function feed(sec, pages, now) {
  const size = sec * 1000;
  const fine = sec === 3600 ? data[60] : sec === 900 ? data[60] : sec === 300 ? data[60] : data[60];
  const out = [];
  const src = data[sec];
  // completed candles from the native series
  const startIdx = src.findIndex((c) => c.time >= now - 300 * pages * size);
  for (let i = Math.max(0, startIdx); i < src.length && src[i].time + size <= now; i++) out.push(src[i]);
  // in-progress candle from 1m data
  const b = Math.floor(now / size) * size;
  const parts = data[60].filter((c) => c.time >= b && c.time + 60000 <= now);
  if (parts.length) out.push({ time: b, open: parts[0].open, high: Math.max(...parts.map((c) => c.high)), low: Math.min(...parts.map((c) => c.low)), close: parts[parts.length - 1].close });
  return out.slice(-300 * pages);
}

// ---- real Postgres (pglite) behind the same tagged-template call the app uses (neon).
// pglite isn't a repo dependency: point PGLITE at an installed copy, e.g.
//   PGLITE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node e2e.mjs
const { PGlite } = await import(process.env.PGLITE || "@electric-sql/pglite");
const db = new PGlite();
const fakeSql = async (strings, ...v) => {
  let text = strings[0];
  for (let i = 0; i < v.length; i++) text += `$${i + 1}` + strings[i + 1];
  const params = v.map((x) => (x instanceof Date ? x.toISOString() : x));
  const r = await db.query(text, params);
  return r.rows;
};
await db.exec("CREATE TABLE users (email TEXT, is_admin BOOLEAN, watchlist TEXT); CREATE TABLE push_subscriptions (email TEXT, endpoint TEXT, subscription JSONB); INSERT INTO users VALUES ('a@x', true, '[\"BTC\"]'), ('b@x', true, '[\"BTC\",\"XLM\"]'), ('c@x', false, '[\"SOL\"]'); INSERT INTO push_subscriptions VALUES ('a@x','ea','{\"who\":\"a\"}'), ('b@x','eb','{\"who\":\"b\"}')");
const pushes = []; const pushLog = [];
const webpush = { sendNotification: async (sub, payload) => { const p = JSON.parse(payload); pushes.push(p.title); pushLog.push({ who: sub.who, body: p.body, tag: p.tag }); } };
const start = Date.parse(process.argv[2] || "2026-09-01T00:00:00Z"), end = Date.parse(process.argv[3] || "2026-10-12T17:00:00Z");
const stats = { runs: 0, errors: {}, skipped: {}, opened: 0, closed: 0 };
for (let now = start + 90000; now <= end; now += 5 * 60 * 1000) {
  const deps = {
    now,
    coins: ["BTC", "XLM"],
    fetchGran: async (sec, pages, coin) => sc(feed(sec, pages, now), SCALE[coin]),
    getDailySMA: async (coin) => smaOf(now) * SCALE[coin],
    crowd: async () => 55,
    // the shared resolver reads candles for each timeframe, here from the same fake feed
    resolveIo: {
      now,
      fetchCandles: async (coin, tf) => {
        const m = TF[tf]; const c = sc(feed(m.gran, m.aggFactor > 1 ? 2 : 1, now), SCALE[coin]);
        return m.aggFactor > 1 ? aggregate(c, m.gran, m.aggFactor) : c;
      },
      fetchMinute: async (c, start, end) => data[60].filter((x) => x.time >= start && x.time < end).map((x) => ({ time: x.time, low: x.low * SCALE[c], high: x.high * SCALE[c] })),
    },
  };
  const res = await R.runTrend(fakeSql, webpush, deps);
  stats.runs++;
  stats.opened += res.opened; stats.closed += res.closed;
  const flat = {}; for (const [c, o] of Object.entries(res.byCoin)) { if (o.error) flat[c] = { error: o.error }; for (const [t, v] of Object.entries(o.byTf || {})) flat[c + ":" + t] = v; }
  for (const [tf, r] of Object.entries(flat)) { if (r.error) stats.errors[tf + ":" + r.error] = (stats.errors[tf + ":" + r.error] || 0) + 1; if (r.skipped) stats.skipped[tf + ":" + r.skipped] = (stats.skipped[tf + ":" + r.skipped] || 0) + 1; }
}
console.log("runs", stats.runs, "opened", stats.opened, "closed", stats.closed);
console.log("errors", JSON.stringify(stats.errors), "\nskipped", JSON.stringify(stats.skipped));
const all = await fakeSql`SELECT tf, dir, outcome, r, exit_price, entry, stop, target, label, coin, bar_time FROM signal_track ORDER BY id`;
for (const tf of TREND_ORDER) {
  for (const dir of ["bull", "bear"]) {
    const z = all.filter((r) => r.tf === tf && r.dir === dir), c = z.filter((r) => r.outcome !== "open");
    const w = c.filter((r) => Number(r.r) > 0).length, tot = c.reduce((s, r) => s + Number(r.r), 0);
    console.log(tf.padEnd(4), dir.padEnd(5), "trades", String(z.length).padStart(3), "closed", String(c.length).padStart(3), "win", c.length ? Math.round((100 * w) / c.length) + "%" : "-", "avgR", c.length ? (tot / c.length).toFixed(2) : "-", "open", z.length - c.length);
  }
}
// sanity: every row is a Trend Rider trade with a stop and a target, and closes at -1R or +0.75R
const bad = all.filter((r) => !["Trend Rider", "Rebound Rider"].includes(r.label) || !["BTC", "XLM"].includes(r.coin) || r.target === null || (r.outcome !== "open" && ![-1, 0.75].includes(Number(r.r))));
const byTfPush = {}; for (const t of pushes) { const k = t; byTfPush[k] = (byTfPush[k] || 0) + 1; }
console.log("pushes", pushes.length, JSON.stringify(byTfPush), "sample:", pushes.slice(0, 3).join(" || "));
for (const coin of ["BTC", "XLM"]) { const z = all.filter((r) => r.coin === coin), c = z.filter((r) => r.outcome !== "open"); console.log(coin, "trades", z.length, "closed", c.length, "win", c.length ? Math.round(100 * c.filter((r) => Number(r.r) > 0).length / c.length) + "%" : "-"); }
const who = {}; for (const p of pushLog) { const k = p.who + ":" + p.body.split(" ")[0]; who[k] = (who[k] || 0) + 1; }
console.log("pushes by user:coin", JSON.stringify(who), "| sample XLM body:", (pushLog.find((p) => p.body.startsWith("XLM")) || {}).body, "| tags unique per user:", new Set(pushLog.map((p) => p.who + p.tag)).size === pushLog.length);
console.log("rows", all.length, "bad", bad.length, bad.map((r) => JSON.stringify(r)).join(" "));
const outcomeOk = all.every((r) => r.outcome === "open" || (r.outcome === "win") === (Number(r.r) > 0));
console.log("win/loss matches sign of r:", outcomeOk);
fs.writeFileSync("e2e_1m.json", JSON.stringify(all.filter((r) => r.tf === "1m" && r.dir === "bull").map((r) => ({ t: Number(r.bar_time), entry: Number(r.entry), exit: Number(r.exit_price), r: Number(r.r) }))));
