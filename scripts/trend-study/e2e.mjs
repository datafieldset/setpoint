// End-to-end test of lib/trendRunner.js with a fake database and fake candle feed.
// Walks time forward in 5-minute steps through recent history, calling runTrend exactly as the cron would.
import fs from "fs";
import * as R from "../../lib/trendRunner.js";
import { TREND_ORDER } from "../../lib/trend.js";

const load = (f) => JSON.parse(fs.readFileSync(f)).map((r) => ({ time: r[0] * 1000, low: r[1], high: r[2], open: r[3], close: r[4] })).filter((x) => x.close > 0).sort((a, b) => a.time - b.time);
const data = { 60: load("BTC_1m.json"), 300: load("BTC_5m.json"), 900: load("BTC_15m.json"), 3600: load("BTC_1h.json") };
const d1 = load("BTC_1d.json");
const smaOf = (now) => { const day = Math.floor(now / 864e5) * 864e5; const done = d1.filter((x) => x.time < day).slice(-200); return done.length === 200 ? done.reduce((s, x) => s + x.close, 0) / 200 : null; };

// candles as the live feed would show at time `now`: completed candles plus the in-progress one built from finer data
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

// ---- fake sql: matches the exact statements the runner issues
const rows = [];
let nextId = 1;
const fakeSql = async (strings, ...v) => {
  const q = strings.join("?").replace(/\s+/g, " ").trim();
  if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("DROP INDEX") || q.startsWith("CREATE UNIQUE INDEX")) return [];
  if (q.startsWith("SELECT * FROM trend_positions WHERE coin = ? AND tf = ? AND status = 'open'")) return rows.filter((r) => r.tf === v[1] && r.status === "open").map((r) => ({ ...r }));
  if (q.startsWith("UPDATE trend_positions SET status = 'closed'")) {
    const [exit, rr, stop, ext, last, id] = v;
    const row = rows.find((r) => r.id === id && r.status === "open"); if (!row) return [];
    Object.assign(row, { status: "closed", exit, r: rr, stop, ext, last_hour: last }); return [{ id }];
  }
  if (q.startsWith("UPDATE trend_positions SET stop")) { const [stop, ext, last, id] = v; const row = rows.find((r) => r.id === id && r.status === "open"); if (row) Object.assign(row, { stop, ext, last_hour: last }); return []; }
  if (q.startsWith("INSERT INTO trend_positions")) {
    const [coin, tf, dir, bar_time, entry, risk, stop, ext, last_hour, sma, fng, stretch] = v;
    if (rows.some((r) => r.tf === tf && r.dir === dir && (r.status === "open" || r.bar_time === bar_time))) return []; // unique indexes
    const row = { id: nextId++, coin, tf, dir, bar_time, entry, risk, stop, ext, last_hour, sma, fng, stretch, status: "open" };
    rows.push(row); return [{ id: row.id }];
  }
  if (q.startsWith("SELECT dir, max(last_hour)")) { const out = []; for (const dir of ["long","short"]) { const z = rows.filter(r => r.tf === v[1] && r.dir === dir && r.status === "closed"); if (z.length) out.push({ dir, lh: Math.max(...z.map(r => r.last_hour)) }); } return out; }
  if (q.includes("FROM push_subscriptions")) return [];
  throw new Error("unexpected sql: " + q.slice(0, 100));
};

const webpush = { sendNotification: async () => {} };
const start = Date.parse(process.argv[2] || "2026-09-01T00:00:00Z"), end = Date.parse(process.argv[3] || "2026-10-12T17:00:00Z");
const stats = { runs: 0, errors: {}, skipped: {}, opened: 0, closed: 0 };
for (let now = start + 90000; now <= end; now += 5 * 60 * 1000) {
  const deps = {
    now,
    fetchGran: async (sec, pages) => feed(sec, pages, now),
    getDailySMA: async () => smaOf(now),
    crowd: async () => 55,
  };
  const res = await R.runTrend(fakeSql, webpush, deps);
  stats.runs++;
  stats.opened += res.opened; stats.closed += res.closed;
  for (const [tf, r] of Object.entries(res.byTf)) { if (r.error) stats.errors[tf + ":" + r.error] = (stats.errors[tf + ":" + r.error] || 0) + 1; if (r.skipped) stats.skipped[tf + ":" + r.skipped] = (stats.skipped[tf + ":" + r.skipped] || 0) + 1; }
}
console.log("runs", stats.runs, "opened", stats.opened, "closed", stats.closed);
console.log("errors", JSON.stringify(stats.errors), "\nskipped", JSON.stringify(stats.skipped));
for (const tf of TREND_ORDER) {
  const mine = rows.filter((r) => r.tf === tf);
  for (const dir of ["long", "short"]) {
    const z = mine.filter((r) => r.dir === dir), c = z.filter((r) => r.status === "closed");
    const w = c.filter((r) => r.r > 0).length, tot = c.reduce((s, r) => s + r.r, 0);
    console.log(tf.padEnd(4), dir.padEnd(5), "trades", String(z.length).padStart(3), "closed", String(c.length).padStart(3), "win", c.length ? Math.round((100 * w) / c.length) + "%" : "-", "avgR", c.length ? (tot / c.length).toFixed(2) : "-", "open", z.length - c.length);
  }
}
// sanity: no row with a nonsense stop side or R
const bad = rows.filter((r) => (r.dir === "long" ? r.stop >= r.entry && r.status === "open" && r.stop > r.ext : false) || (r.status === "closed" && !(r.r > -1.6 && r.r < 40)));
console.log("rows", rows.length); if (process.argv[4]) console.log(JSON.stringify(rows.filter(r=>r.tf==="1m").map(r=>({id:r.id,dir:r.dir,bar:new Date(r.bar_time).toISOString().slice(11,16),entry:r.entry,exit:r.exit,r:r.r,last:r.last_hour?new Date(r.last_hour).toISOString().slice(11,16):null}))));
fs.writeFileSync("e2e_1m.json", JSON.stringify(rows.filter(r => r.tf === "1m" && r.dir === "long").map(r => ({ t: r.bar_time, entry: r.entry, exit: r.exit, r: r.r }))));
