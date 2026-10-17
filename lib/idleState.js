// lib/idleState.js
//
// Lets the 5-minute scan skip the database when nothing is happening (v19.41).
//
// Why: Neon's free plan bills compute only while the database is awake, and it
// goes to sleep after 5 minutes of no queries. The scan used to ask the database
// a few dozen questions every 5 minutes (open trades, coin list, last trade
// times, run marker), so it never slept and used about 6 of the 100 monthly
// compute-hours every single day.
//
// How: the scan keeps what it last learned from the database in this instance's
// memory (open trades, last-finished times, coin list, run markers, fires it has
// already handled). A normal 5-minute run first does a "dry pass": the exact same
// scan code, but its database calls are answered from memory. Nothing was written
// and nothing needs writing (no new fire, no trade touching its stop or target)
// -> the run ends there with zero queries. Otherwise the real run goes ahead
// exactly as before.
//
// Safety rules that keep this honest:
//   * The dry pass can only find MORE work than the real run, never less: a time
//     it has no record of counts as "nothing finished yet" (more candidates), and a
//     query it does not recognise sends the run down the real path. Extra real runs cost compute, missed fires cost trades.
//   * A real run happens at least every hour (HEARTBEAT_MS), on a cold
//     instance, and whenever the dry pass sees work, so a stale memory heals itself.
//   * Everything here is per server instance. Another instance starts cold and
//     reads the database like before.
//   * Time always comes from the `now` the caller passes in (so tests can replay).

import { createHmac, timingSafeEqual } from "crypto";

export const HEARTBEAT_MS = 60 * 60 * 1000;
const SEEN_KEEP_MS = 6 * 60 * 60 * 1000;

const st = {
  coins: null,        // coin list from the last real run
  open: null,         // open trade rows from the last real run (with label)
  shut: new Map(),    // "coin|tf|label" -> { bull, bear } last finished time (ms)
  marks: new Map(),   // coin -> last fully successful scan (ms)
  seen: new Map(),    // fire key -> bar time, fires already handled by a real run
  lastFull: 0,
  lastCheck: 0,
  stats: { idleRuns: 0, fullRuns: 0, lastFullReason: null },
};

const fireKey = (coin, tf, label, dir, barTime) => `${coin}|${tf}|${label}|${dir}|${barTime}`;
const openKey = (coin, tf, label, dir) => `${coin}|${tf}|${label}|${dir}`;

export const idle = {
  warm: (now) => !!(st.coins && st.open && st.lastFull && now - st.lastFull < HEARTBEAT_MS),
  coldReason: (now) => (!st.coins || !st.open || !st.lastFull ? "cold" : now - st.lastFull >= HEARTBEAT_MS ? "heartbeat" : null),
  getCoins: () => st.coins || [],
  setShut: (coin, tf, label, shutAt) => st.shut.set(`${coin}|${tf}|${label}`, { bull: shutAt.bull || 0, bear: shutAt.bear || 0 }),
  setMark: (coin, now) => st.marks.set(coin, now),
  markSeen: (coin, tf, label, dir, barTime) => st.seen.set(fireKey(coin, tf, label, dir, barTime), Number(barTime)),
  // a real run finished: remember what the database said, and when
  fullDone: (now, coins, openRows, reason) => {
    st.coins = coins; st.open = openRows; st.lastFull = now; st.lastCheck = now;
    for (const [k, t] of st.seen) if (t < now - SEEN_KEEP_MS) st.seen.delete(k);
    st.stats.fullRuns++; st.stats.lastFullReason = reason;
  },
  idleDone: (now) => { st.lastCheck = now; st.stats.idleRuns++; },
  reset: () => { st.coins = null; st.open = null; st.lastFull = 0; },
  // a brand-new server instance (tests use this to prove a carried memory is enough)
  wipe: () => { st.coins = null; st.open = null; st.lastFull = 0; st.lastCheck = 0; st.shut = new Map(); st.marks = new Map(); st.seen = new Map(); },
  // true if a scan or resolve already looked at the open trades in the last `ms` (used by close-alert)
  recentlyChecked: (now, ms) => !!(st.open && st.lastCheck && now - st.lastCheck < ms),
  openCount: () => (st.open ? st.open.length : null),
  stats: () => ({ ...st.stats, lastFull: st.lastFull, lastCheck: st.lastCheck }),
};

// A stand-in for the database client. Same call shape as `sql\`...\``, answers from
// memory, records the work a real run would have to do, and refuses anything it
// doesn't know (which sends the run down the real path).
export function makeDrySql() {
  const work = { fires: [], updates: 0, unknown: null };
  const openSet = new Set((st.open || []).map((r) => openKey(r.coin, r.tf, r.label, r.dir)));
  const q = async (strings, ...vals) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    // the resolver asking for open trades
    if (text.includes("FROM signal_track WHERE outcome = 'open'")) return (st.open || []).map((r) => ({ ...r }));
    // a trade finished: the real run has to write it
    if (text.startsWith(" UPDATE signal_track") || text.startsWith("UPDATE signal_track")) { work.updates++; return []; }
    // last finished trade per direction for one signal on one coin and chart
    if (text.includes("max(extract(epoch FROM resolved_at)")) {
      // no record = 0 = "nothing finished yet", which can only find more candidates, never fewer
      const s = st.shut.get(`${vals[0]}|${vals[1]}|${vals[2]}`) || { bull: 0, bear: 0 };
      return [{ dir: "bull", lh: s.bull }, { dir: "bear", lh: s.bear }];
    }
    // the run marker
    if (text.includes("SELECT val FROM trend_state")) {
      const coin = String(vals[0]).replace("last_run:", "");
      return st.marks.has(coin) ? [{ val: st.marks.get(coin) }] : [];
    }
    if (text.includes("INSERT INTO trend_state")) { st.marks.set(String(vals[0]).replace("last_run:", ""), Number(vals[1])); return []; }
    // a new fire: only counts as work if a real run has not handled it and no trade is already open for it
    if (text.includes("INSERT INTO signal_track")) {
      const [coin, tf, label, dir] = vals; const barTime = vals[8];
      if (st.seen.has(fireKey(coin, tf, label, dir, barTime)) || openSet.has(openKey(coin, tf, label, dir))) return [];
      work.fires.push(fireKey(coin, tf, label, dir, barTime));
      return [];
    }
    work.unknown = work.unknown || text.slice(0, 80);
    throw new Error("idle: unknown query: " + text.slice(0, 60));
  };
  q.work = work;
  return q;
}

// ---- carrying the memory between runs
//
// Vercel only sometimes hands the next 5-minute call to the same server instance, so the cron loop
// (GitHub Actions) carries the memory itself: every response includes it as a signed string and the
// next call sends it back. The signature (HMAC with a server-only secret) means nobody who has the
// public cron key can feed in a made-up memory and make real fires or closes get skipped.
const secret = () => process.env.IDLE_STATE_SECRET || process.env.VAPID_PRIVATE_KEY || process.env.DATABASE_URL || "";
const sign = (text) => createHmac("sha256", secret()).update(text).digest("hex");
const COIN_RE = /^[A-Z0-9]{2,10}$/;
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function exportState() {
  if (!st.coins || !st.open || !secret()) return null;
  const text = JSON.stringify({ v: 1, coins: st.coins, open: st.open, shut: [...st.shut], marks: [...st.marks], seen: [...st.seen], lastFull: st.lastFull, lastCheck: st.lastCheck });
  return { state: text, sig: sign(text) };
}

// Adopts a carried memory only if the signature checks out and it is newer than what this instance has.
export function importState(text, sig, now) {
  try {
    if (typeof text !== "string" || typeof sig !== "string" || !secret() || text.length > 400000) return false;
    const want = Buffer.from(sign(text), "hex"), got = Buffer.from(sig, "hex");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
    const o = JSON.parse(text);
    if (o.v !== 1 || !Array.isArray(o.coins) || !Array.isArray(o.open)) return false;
    if (!(num(o.lastFull) && num(o.lastCheck)) || o.lastCheck > now + 60000 || !(o.lastCheck > st.lastCheck)) return false;
    if (!o.coins.every((c) => typeof c === "string" && COIN_RE.test(c)) || o.coins.length > 24) return false;
    st.coins = o.coins; st.open = o.open.slice(0, 1000);
    st.shut = new Map((o.shut || []).filter((e) => Array.isArray(e) && typeof e[0] === "string" && e[1]).map(([k, v]) => [k, { bull: Number(v.bull) || 0, bear: Number(v.bear) || 0 }]));
    st.marks = new Map((o.marks || []).filter((e) => Array.isArray(e) && typeof e[0] === "string" && num(e[1]) !== null));
    st.seen = new Map((o.seen || []).filter((e) => Array.isArray(e) && typeof e[0] === "string" && num(e[1]) !== null));
    st.lastFull = o.lastFull; st.lastCheck = o.lastCheck;
    return true;
  } catch { return false; }
}
