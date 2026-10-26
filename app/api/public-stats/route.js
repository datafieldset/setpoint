// app/api/public-stats/route.js
//
// Genuinely public, no password, no login. This page's entire premise is
// "check it yourself", which only works if anyone can hit this endpoint
// without an account.
//
// Real, direct redesign (Sep 21): the previous version counted a
// signal's ENTIRE, all-time history the moment it counted as verified
// at all, static promotion or the newer, dynamic regime-only path.
// That let one strong, recent stretch get diluted by months of older
// trades from before the signal was ever actually earning it, or by a
// condition-specific slice that only performs well in the current
// market, dragging the headline number down in a way that didn't
// honestly reflect what's happening right now. Real, direct fix: for
// each real signal with a genuine, current, verified status, only
// count its own real, most-recent 20 trades, the same rolling window
// every other real surface already uses to decide "is this currently
// earning it." A signal that's promoted but currently failing pulls
// the number down immediately; one that just started earning it only
// ever contributes its own genuine, recent record, never stale
// history from before it existed.
//
// Real, second, direct fix, found the same day: the first version of
// this only checked the static table, meaning a signal currently,
// genuinely demoted by its own live record still had its trades
// counted here, even though it was already correctly hidden from real
// customers on the dashboard itself.
//
// Real, third, deeper fix (Sep 21, same day): the second version still
// only ever considered STATICALLY-promoted signals as eligible at
// all, entirely ignoring the regime-only path — a signal that's
// currently, genuinely earning "verified" purely from a real, strong
// record in the current market condition (Reversal watch on 1m short,
// 90% on a real 10-trade sample in the current bullish-trending
// regime; RSI oversold on 1m long, 70% on 10 real trades in the
// current sideways-ranging regime) was invisible here even though the
// dashboard itself already, correctly treats it as verified. That's
// the exact, same two-surfaces-disagree class of bug this file keeps
// getting caught by. Now checks every real, resolved row directly
// against the one, real, shared definition of verified, static or
// regime, exactly matching what a real customer's own dashboard shows.
import { brandName } from "../../../lib/brand.js";
import { ALL_SIGNALS, KILLED_COMBOS, FOCUS_MODE, PUBLIC_TESTING, isSignalVisible, belowTargetFloor, LIVE_GATE_WINDOW, PROVEN_THRESHOLD, REGIME_ONLY_MIN_SAMPLE, getLiveVerifiedGate, provenContext, buildGatesFromRows, confidenceTier } from "../../../lib/signals.js";
import { ensureSignalTrack } from "../../../lib/schema.js";
import { resultR, avgResult, exitPrice } from "../../../lib/results.js";
import { withCache } from "../../../lib/cache.js";

export const dynamic = "force-dynamic";

// Real, direct fix (Oct 2, caching overhaul): this is genuinely
// public, no login, no rate limit at all, which means any real
// visitor, search crawler included, triggers a fresh, uncached
// database query on every single hit. This page doesn't need
// live-trading-level freshness, it's an honest, recent snapshot of a
// real track record, not a live tool — a real, several-minute cache
// is genuinely fine here, and cuts database load from exactly the
// kind of unpredictable, un-rate-limited traffic this route is most
// exposed to.
const CACHE_MS = 5 * 60 * 1000; // v19.46: was 3 minutes; the win-rate numbers barely move, and every refresh woke the database

// ?coins=BTC,XLM limits every number and list to those coins (Watch Live sends the viewer's own
// watchlist, or BTC alone when there is none). No param means every coin, as before.
const COIN_OK = /^[A-Z0-9]{2,10}$/;
function parseCoins(url) {
  const raw = new URL(url).searchParams.get("coins");
  if (!raw) return null;
  const list = [...new Set(raw.split(",").map((c) => c.trim().toUpperCase()).filter((c) => COIN_OK.test(c)))].slice(0, 12).sort();
  return list.length ? list : ["BTC"];
}

export async function GET(req) {
  const coins = parseCoins(req.url);
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [] }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const data = await withCache("public-stats:" + (coins ? coins.join(",") : "all"), CACHE_MS, () => computeStats(conn, coins));
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ verifiedWinRate: null, verifiedTotal: 0, recent: [], error: String(e.message || e).slice(0, 150) }, { headers: { "cache-control": "no-store" } });
  }
}

function toCard(r) {
  const entry = parseFloat(r.entry);
  const exit = exitPrice(r);
  const pctMove = r.dir === "bull" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
  return {
    coin: r.coin,
    tf: r.tf,
    name: brandName(r.label),
    dir: r.dir,
    outcome: r.outcome,
    entry, exit,
    pctMove, r: resultR(r),
    firedAt: r.fired_at,
    resolvedAt: r.resolved_at,
  };
}

async function computeStats(conn, coins) {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
  const { gate: liveGate, regimeGate } = await getLiveVerifiedGate();

  await ensureSignalTrack(sql);
  const labels = ALL_SIGNALS.map((s) => s.name);
  const rows = await sql`
    SELECT coin, tf, label, dir, outcome, entry, stop, target, exit_price, r, fired_at, resolved_at, regime, verified_at_fire
    FROM signal_track
    WHERE outcome IN ('win', 'loss') AND label = ANY(${labels})
      AND (${!coins} OR coin = ANY(${coins || []}))
    ORDER BY resolved_at DESC
  `;

  // ---- Verified record: the headline number and the cards under it ----
  let wins = 0, losses = 0, sumR = 0;
  const recent = [];
  const seenPerCombo = {};
  // Which setups are behind the headline right now, with their own
  // record and last trade date. Added Oct 7: the page used to say "all
  // 7 verified setups, all-time" while only 3 were actually verified,
  // and nothing on it explained why a month could show one trade.
  const verifiedSetups = new Map();
  // Whether a setup clears the bar today, by the shared definition: its
  // overall record, or any market condition where it currently does.
  // A setup can have verified-at-fire trades here and still be under
  // the bar now. It stays on the list, marked, rather than vanishing.
  const isVerifiedNow = (label, tf, dir) => {
    if (provenContext(label, tf, dir, liveGate, null, regimeGate).tag === "proven") return true;
    const prefix = `${label}|${tf}|${dir}|`;
    return Object.entries(regimeGate || {}).some(([k, g]) => k.startsWith(prefix) && g.n >= REGIME_ONLY_MIN_SAMPLE && g.rate >= PROVEN_THRESHOLD);
  };
  // When the stamp started being written. Everything fired after this
  // is locked in at fire time, everything before is judged by today's
  // status.
  const verifiedRows = [];
  let stampedSince = null;
  for (const r of rows) {
    if (r.verified_at_fire !== null && r.verified_at_fire !== undefined && (!stampedSince || new Date(r.fired_at) < new Date(stampedSince))) stampedSince = r.fired_at;
  }
  for (const r of rows) {
    // Real, direct fix, found live (Oct 4): a combo that's been
    // deliberately killed can never fire again, but its old, frozen
    // rows logged before the kill still sit in signal_track forever
    // and would keep counting toward the customer-facing win rate.
    if (KILLED_COMBOS.includes(`${r.label}|${r.tf}|${r.dir}`)) continue;
    // v19.20: trades whose target was under the minimum size never count,
    // including ones logged before the minimum existed.
    // (A public test sets its own target size, so the minimum doesn't apply to it. It never counts toward the verified win rate anyway.)
    if (!PUBLIC_TESTING.includes(r.label) && belowTargetFloor(r.tf, r.entry, r.target)) continue;
    // Focus mode (v19.21): hidden signals never appear on Watch Live.
    if (!isSignalVisible(r.label)) continue;
    // Oct 9: a trade is judged by whether it was verified WHEN IT FIRED
    // (verified_at_fire, stamped from the one shared provenContext at
    // that moment). That's what a customer actually saw, and it stops
    // history from rewriting itself when a setup is later promoted or
    // demoted. Trades logged before the stamp existed (null) fall back
    // to the old rule: verified today, by the same shared definition.
    let comboKey;
    if (r.verified_at_fire === true) {
      comboKey = `${r.label}|${r.tf}|${r.dir}`;
    } else if (r.verified_at_fire === false) {
      continue; // wasn't verified when it fired, so it never reached a customer as verified
    } else {
      const pc = provenContext(r.label, r.tf, r.dir, liveGate, r.regime, regimeGate);
      if (pc.tag !== "proven") continue;
      // Rolling window scoped to how this row earned its verification: a
      // statically-proven row rolls up with every row of its (label, tf,
      // dir), a regime-only-proven row only with rows from that regime.
      comboKey = pc.verifiedVia === "regime" ? `${r.label}|${r.tf}|${r.dir}|${r.regime}` : `${r.label}|${r.tf}|${r.dir}`;
    }
    seenPerCombo[comboKey] = (seenPerCombo[comboKey] || 0) + 1;
    if (seenPerCombo[comboKey] > LIVE_GATE_WINDOW) continue;

    r.outcome === "win" ? wins++ : losses++;
    sumR += resultR(r);
    verifiedRows.push(r);
    const sKey = `${r.label}|${r.tf}|${r.dir}`;
    const s = verifiedSetups.get(sKey) || { name: brandName(r.label), tf: r.tf, dir: r.dir, wins: 0, losses: 0, lastAt: r.resolved_at, sumR: 0, verifiedNow: isVerifiedNow(r.label, r.tf, r.dir) };
    r.outcome === "win" ? s.wins++ : s.losses++;
    s.sumR += resultR(r);
    verifiedSetups.set(sKey, s);
    if (recent.length < 40) recent.push(toCard(r));
  }

  // Average result per trade in R (R = the amount risked), read from each
  // trade's stored result (lib/results.js).
  const verifiedTotal = wins + losses;
  const verifiedWinRate = verifiedTotal > 0 ? wins / verifiedTotal : null;

  // ---- Emerging: real results, under the verified bar ----
  // Oct 7: the verified list is deliberately strict, which is why only
  // a few slow setups clear it. Setups that are working lately but
  // haven't earned the badge (the tiered confidence system's
  // "emerging" tier: at least 5 real trades, 55% or better) now show
  // here, clearly separated, and are NEVER counted in the headline
  // win rate. Same exclusions as everywhere else: retired labels are
  // already filtered out of rows, killed combos are skipped below.
  const { gate: fullGate, regimeGate: fullRegimeGate } = buildGatesFromRows(rows);
  const comboKeys = new Set(rows.map((r) => `${r.label}|${r.tf}|${r.dir}`));
  const emergingSetups = [];
  const emergingTrades = [];
  for (const key of comboKeys) {
    if (KILLED_COMBOS.includes(key)) continue;
    if (!isSignalVisible(key.split("|")[0]) || PUBLIC_TESTING.includes(key.split("|")[0])) continue; // focus mode, and public tests have their own group below
    if (verifiedSetups.has(key)) continue; // already shown as verified
    const [label, tf, dir] = key.split("|");
    const ct = confidenceTier(label, tf, dir, liveGate, null, regimeGate, fullGate, fullRegimeGate);
    if (ct.tier !== "emerging") continue;
    const scoped = rows
      .filter((r) => `${r.label}|${r.tf}|${r.dir}` === key && (ct.verifiedVia !== "regime" || r.regime === ct.regimeStage))
      .slice(0, LIVE_GATE_WINDOW);
    if (!scoped.length) continue;
    const w = scoped.filter((r) => r.outcome === "win").length;
    emergingSetups.push({
      name: brandName(label), tf, dir,
      wins: w, losses: scoped.length - w,
      rate: w / scoped.length,
      avgR: avgResult(scoped),
      regime: ct.verifiedVia === "regime" ? ct.regimeStage : null,
      lastAt: scoped[0].resolved_at,
    });
    for (const r of scoped.slice(0, 6)) emergingTrades.push(toCard(r));
  }
  // ---- Public tests: signals shown to everyone while they prove themselves ----
  // Never counted in the verified win rate. Their own group, with the
  // real record per timeframe and direction and the average result per
  // trade (the number to watch when a signal's target isn't the usual 2R).
  const testingRows = rows.filter((r) => PUBLIC_TESTING.includes(r.label) && isSignalVisible(r.label));
  const testingMap = new Map();
  for (const r of testingRows) {
    const key = `${r.label}|${r.tf}|${r.dir}`;
    const t = testingMap.get(key) || { name: brandName(r.label), tf: r.tf, dir: r.dir, rows: [], lastAt: r.resolved_at };
    t.rows.push(r);
    testingMap.set(key, t);
  }
  const testingSetups = [...testingMap.values()]
    .map((t) => {
      const w = t.rows.filter((r) => r.outcome === "win").length;
      return { name: t.name, tf: t.tf, dir: t.dir, wins: w, losses: t.rows.length - w, avgR: avgResult(t.rows), lastAt: t.lastAt };
    })
    .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
  const testingRecent = testingRows.slice(0, 24).map(toCard);
  // ---- Live: everything running right now, one record (v19.36) ----
  // Na's call (Oct 13): show the win rate of whatever is live, tested or not.
  // Verified trades plus public tests, one headline, one row per signal
  // (with its timeframes underneath) and one history list.
  const liveRows = verifiedRows.concat(testingRows).sort((a, b) => new Date(b.resolved_at) - new Date(a.resolved_at));
  const tally = (list) => { const w = list.filter((r) => r.outcome === "win").length; return { wins: w, losses: list.length - w, rate: list.length ? w / list.length : null, avgR: list.length ? avgResult(list) : null }; };
  const liveSignals = [...new Set(liveRows.map((r) => r.label))].map((label) => {
    const mine = liveRows.filter((r) => r.label === label);
    const tfs = [...new Set(mine.map((r) => r.tf))].map((tf) => ({ tf, ...tally(mine.filter((r) => r.tf === tf)) }));
    return { name: brandName(label), ...tally(mine), tfs, lastAt: mine[0].resolved_at };
  }).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
  const live = { ...tally(liveRows), total: liveRows.length, names: ALL_SIGNALS.filter((x) => isSignalVisible(x.name)).map((x) => brandName(x.name)), signals: liveSignals, recent: liveRows.slice(0, 60).map(toCard) };
  emergingSetups.sort((a, b) => b.rate - a.rate || (b.wins + b.losses) - (a.wins + a.losses));
  emergingTrades.sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)));

  return {
    verifiedWinRate, verifiedTotal, wins, losses, recent,
    avgR: verifiedTotal > 0 ? sumR / verifiedTotal : null,
    activeSetups: verifiedSetups.size,
    setups: [...verifiedSetups.values()].map(({ sumR: setupR, ...s }) => ({ ...s, avgR: setupR / (s.wins + s.losses) })),
    lastTradeAt: recent[0]?.resolvedAt ?? null,
    stampedSince,
    focusMode: FOCUS_MODE,
    live,
    coins: coins || null,
    emerging: { setups: emergingSetups.slice(0, 8), recent: emergingTrades.slice(0, 24) },
    testing: { names: PUBLIC_TESTING.filter(isSignalVisible).map(brandName), setups: testingSetups, recent: testingRecent },
  };
}
