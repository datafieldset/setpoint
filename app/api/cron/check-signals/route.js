// app/api/cron/check-signals/route.js
//
// The real fix for a genuine gap: push notifications used to only ever
// trigger from inside a customer's own, actively-open browser tab, the
// exact same client-side loop that computes signals for display. If
// nobody had the dashboard open at the moment something fired, it fired
// and logged correctly on the backend, real, verified, resolved, but the
// push that was supposed to reach them never had anything to trigger it.
// On a phone specifically, where the OS aggressively suspends background
// tabs, that's close to the common case, not the edge case.
//
// This runs independently, on a real schedule (GitHub Actions cron, see
// .github/workflows/check-signals-cron.yml), and does the same real
// detection the dashboard does, for every account with alerts turned on,
// regardless of whether anyone's phone or browser is anywhere near it.
//
// Real, deliberate scope decision: this checks every real timeframe
// (5m/15m/30m/1h/4h) for every coin on every subscribed account's real
// watchlist, not just whichever tab happened to be open somewhere. A
// signal firing on a timeframe nobody's currently looking at is exactly
// the case the dashboard's own live view can never catch on its own.
//
// Requires ?key=<the shared key>, same protection every other
// semi-internal route already uses (close-alert, open-positions).
import { checkKey } from "../../../../lib/access.js";
import { neon } from "@neondatabase/serverless";
import webpush from "web-push";
import { TF } from "../../../../lib/timeframes.js";
import { computeSignals, thresholdsFor, getLiveVerifiedGate, marketRegime, PROVEN_THRESHOLD, reversalRisk, TESTING_SIGNALS, verifiedAtFire, FOCUS_MODE } from "../../../../lib/signals.js";
import { brandName } from "../../../../lib/brand.js";
import { checkBigMove } from "../../../../lib/bigMove.js";
import { runTrend } from "../../../../lib/trendRunner.js";
import { exportState, importState } from "../../../../lib/idleState.js";
import { ensureSignalTrack } from "../../../../lib/schema.js";
import { fetchCandles, getWeekly200MA, fetchFng, fetchBroadMarketBias, getRecentWhaleActivity } from "../../../../lib/marketContext.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function configureWebPush() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:nokanetmail@gmail.com", pub, priv);
  return true;
}

// The scan's memory travels with the cron loop (lib/idleState.js): every response carries it, signed,
// and the next call sends it back, so a quiet run needs no database call even when Vercel hands the
// call to a fresh server instance.
async function withState(res) {
  try {
    const out = exportState();
    if (!out) return res;
    return Response.json({ ...(await res.clone().json()), idleState: out.state, idleSig: out.sig }, { status: res.status });
  } catch { return res; }
}
export async function GET(req) { return withState(await run(req)); }
export async function POST(req) {
  if (checkKey(req)) return checkKey(req);
  try { const b = await req.json(); importState(b?.state, b?.sig, Date.now()); } catch { /* no carried memory, run as usual */ }
  return withState(await run(req));
}

async function run(req) {
  const authFail = checkKey(req);
  if (authFail) return authFail;

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });
  const hasVapid = configureWebPush();

  const sql = neon(conn, { fetchOptions: { cache: "no-store" } });

  try {
    // Fails loudly (caught below as server_error) instead of letting
    // every insert quietly fail on a missing column.
    await ensureSignalTrack(sql);
    // Server-side trade logging comes first and never depends on push
    // being configured: a trade must open and close whether or not
    // anyone can be notified. A hung feed is cut off after 20 seconds.
    let trend = null;
    try { trend = await Promise.race([runTrend(sql, hasVapid ? webpush : null), new Promise((_, rej) => setTimeout(() => rej(new Error("trend timed out")), 38000))]); } catch (e) { trend = { error: String(e.message || e).slice(0, 80) }; }
    if (!hasVapid) return Response.json({ error: "not_configured", checked: 0, sent: 0, trend });
    // Real accounts with a real, active subscription, joined against
    // their own real, saved watchlist. Nothing here about coins nobody's
    // account actually watches. watchlist is stored as JSON text (same
    // as my-watchlist/route.js), not a real Postgres array, so it's
    // parsed here rather than filtered in SQL.
    // Independent of any watchlist: a plain heads-up when BTC has made a
    // big, fast move. Must never break the signal run itself.
    let bigMove = null;
    try { bigMove = await checkBigMove(sql, webpush); } catch (e) { bigMove = { error: String(e.message || e).slice(0, 80) }; }
    // Focus mode (v19.41): the original signals are hidden from everyone, so detecting, logging and pushing
    // them only kept the database awake. Trend Rider and Rebound Rider run above (lib/trendRunner.js).
    // Turning FOCUS_MODE off in lib/signals.js brings all of this back as it was.
    if (FOCUS_MODE) return Response.json({ checked: 0, sent: 0, reason: "focus_mode_originals_off", bigMove, trend });
    const rawSubs = await sql`
      SELECT DISTINCT u.email, u.watchlist, u.is_admin, ps.endpoint, ps.subscription
      FROM push_subscriptions ps
      JOIN users u ON u.email = ps.email
      WHERE u.watchlist IS NOT NULL
    `;
    const subs = rawSubs
      .map((r) => {
        let watchlist = [];
        try { watchlist = JSON.parse(r.watchlist) || []; } catch { watchlist = []; }
        return { ...r, watchlist: Array.isArray(watchlist) ? watchlist : [] };
      })
      .filter((r) => r.watchlist.length > 0);
    if (!subs.length) return Response.json({ checked: 0, sent: 0, reason: "no_subscribers_with_watchlists", bigMove, trend });

    // Real market context, fetched once, shared across every coin and
    // every account checked this run, same real inputs the dashboard
    // itself uses so a signal detected here matches what would have
    // shown there.
    const [fng, bias, weekly200, whaleActivity, liveGateResult] = await Promise.all([
      fetchFng().catch(() => null),
      fetchBroadMarketBias().catch(() => null),
      getWeekly200MA().catch(() => null),
      getRecentWhaleActivity().catch(() => ({ outflowOversold: false, inflowOverbought: false })),
      getLiveVerifiedGate(),
    ]);
    const { gate: liveGate, regimeGate } = liveGateResult;
    const recentWhaleOutflowOversold = whaleActivity.outflowOversold;
    const recentWhaleInflowOverbought = whaleActivity.inflowOverbought;
    const risk = reversalRisk(bias, fng?.value);

    // The database itself (the unique index in lib/schema.js) guarantees the cron and a
    // browser tab can never both log the same fire.

    const now = Date.now();
    let checked = 0;
    let sent = 0;
    const deadEndpoints = [];

    // The real, structural fix, not a special case for fast timeframes.
    // Checking only "what does the current bar look like right now" is a
    // pure snapshot, and a bar whose entire real lifetime is close to how
    // often anything checks (a 5m bar closing every 5 minutes, the same
    // interval this cron runs on) can become true and revert back to
    // false between two checks, with nothing ever noticing. That's not a
    // one-off bug in one signal, it's the same real gap for every fast
    // timeframe, on every signal type that depends on a single bar
    // (Momentum, Volume spike, RSI). The real fix: replay every real bar
    // that closed since a safe, generous lookback window, not just
    // whichever one happens to be current at this exact instant. This
    // treats every timeframe identically, on a slow timeframe like 4h
    // there's naturally only ever one real bar in this window anyway, so
    // nothing changes there, this only adds real coverage where the gap
    // actually exists.
    const LOOKBACK_MS = 30 * 60 * 1000; // generous, real buffer over the cron's own 5-minute interval and GitHub's documented possible delay

    const neededCoins = new Set();
    for (const s of subs) for (const c of s.watchlist || []) neededCoins.add(c);
    const timeframes = Object.keys(TF);

    // "coin:tf" -> real candidate signals from every bar in the lookback
    // window, oldest first, so the earliest real occurrence of a given
    // (label,dir) is the one that gets logged if more than one bar in
    // this window happened to trigger it.
    const computed = new Map();
    const fetchErrors = [];
    for (const coin of neededCoins) {
      for (const tf of timeframes) {
        checked++;
        try {
          const candles = await fetchCandles(coin, tf);
          const th2 = thresholdsFor(tf);
          const barMsLen = TF[tf].gran * TF[tf].aggFactor * 1000;
          const cutoff = now - LOOKBACK_MS;
          const results = [];
          for (let i = 30; i < candles.length; i++) {
            if (candles[i].time < cutoff) continue; // outside the real lookback window
            const slice = candles.slice(0, i + 1);
            const { signals } = computeSignals(slice, tf, th2, {
              now: slice[slice.length - 1].time + barMsLen,
              marketBias: bias, reversalRisk: risk, fngValue: fng?.value, recentWhaleOutflowOversold, recentWhaleInflowOverbought, liveGate, regimeGate,
            });
            const regimeHere = marketRegime(slice, tf);
            for (const s of signals) results.push({ ...s, regimeStage: regimeHere?.stage || null });
          }
          computed.set(`${coin}:${tf}`, results);
        } catch (e) {
          computed.set(`${coin}:${tf}`, []);
          fetchErrors.push(`${coin}:${tf}: ${String(e.message || e).slice(0, 100)}`);
        }
        // A real, deliberate pause between real Coinbase requests. This
        // loop can fire many requests back to back across several coins
        // and every timeframe, easily faster than Coinbase's own
        // confirmed 3-requests-per-second sustained limit, especially
        // early in the run before the shared cache has anything to
        // reuse.
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // For each real, currently-verified signal found, the database
    // itself decides whether this is genuinely new. RETURNING id comes
    // back empty on a real conflict, meaning something else, the client
    // or a prior tick of this same cron, already logged this exact
    // alert, so it's correctly skipped, no duplicate log, no duplicate
    // push, no race window at all.
    for (const coin of neededCoins) {
      for (const tf of timeframes) {
        const signals = computed.get(`${coin}:${tf}`) || [];
        for (const s of signals) {
          // Real, important change (Sep 21): logging itself no longer
          // requires a signal to already be proven or in the testing
          // list — every real signal that fires now gets logged,
          // period, so nothing ever again builds up months of real,
          // silent history with zero record behind it (found after
          // Momentum genuinely caught a real, fast market move and we
          // had no data to even know it, since it was never promoted
          // or added to testing). Visibility stays exactly as careful
          // as it's always been — the push notification gate further
          // below is untouched in spirit, still requires a genuine,
          // current verified status or the admin-only isCoilTest
          // exception, so this change is purely about never losing
          // data again, not about who ever sees an alert.
          const isCoilTest = TESTING_SIGNALS.includes(s.label) && s.tier !== "proven";
          const gateKey = `${s.label}|${TF[tf].label}|${s.dir}`;

          // Moved above the insert (Oct 9): the same fresh gate now also
          // decides the verified_at_fire stamp written with the row, so
          // the stamp and the push decision read identical data. The
          // 90 second cache makes repeating this per signal free.
          // Real, direct fix (Sep 22): re-fetch the freshest possible
          // live and regime gate data right here, right before the
          // actual push decision, instead of trusting the single
          // snapshot fetched once at the very start of this whole run.
          // Found after a real, direct case: a signal pushed as
          // verified through a real, current regime edge, but by the
          // time the dashboard was checked minutes later, that same
          // regime's real, rolling record had already shifted below
          // the bar — the push wasn't wrong when it used that data,
          // the data itself was already stale by the time this
          // specific check, deep into a run covering many coins and
          // timeframes, actually got here. This keeps the push
          // decision itself as current as the moment it's actually
          // made, not a snapshot from however long ago this run
          // started. Real, direct note (Sep 25): getLiveVerifiedGate
          // now caches its result for a real, moderate stretch by
          // default, to cut real database load. Real, second, direct
          // finding (Sep 28): this call originally bypassed that
          // cache entirely (passed 0), which directly, meaningfully
          // contributed to Neon's free-tier compute-hour quota
          // getting exhausted, confirmed from the account's own usage
          // numbers — a full, uncached scan on every single push
          // decision, potentially many times within one long-running
          // cron invocation, adds up fast. A short, real cache (90
          // real seconds) keeps this close enough to genuinely fresh
          // for the real problem it was built to solve (a push
          // reflecting a regime status that's already shifted by the
          // time it's seen), without forcing a full database scan on
          // every single push within the same run.
          const PUSH_CHECK_CACHE_MS = 90 * 1000;
          let freshGate = liveGate, freshRegimeGate = regimeGate;
          try {
            const fresh = await getLiveVerifiedGate(PUSH_CHECK_CACHE_MS);
            freshGate = fresh.gate;
            freshRegimeGate = fresh.regimeGate;
          } catch {
            // a real, live re-check failing here should never block an
            // otherwise-valid push — fall back to the run's own,
            // already-fetched snapshot rather than losing the alert
          }
          let inserted;
          try {
            const result = await sql`
              INSERT INTO signal_track (coin, tf, label, dir, fired_at, entry, stop, target, regime, verified_at_fire)
              VALUES (${coin}, ${TF[tf].label}, ${s.label}, ${s.dir}, now(), ${s.entry}, ${s.stop}, ${s.target}, ${s.regimeStage || null}, ${verifiedAtFire(s.label, tf, s.dir, s.regimeStage || null, freshGate, freshRegimeGate, { entry: s.entry, target: s.target })})
              ON CONFLICT (coin, tf, label, dir) WHERE outcome = 'open' DO NOTHING
              RETURNING id
            `;
            inserted = result.length > 0;
          } catch {
            continue; // a real logging failure here should never crash the whole run
          }
          if (!inserted) continue; // the database itself says this isn't actually new

          const freshGateEntry = freshGate[gateKey];
          const freshOverallVerified = !freshGateEntry || freshGateEntry.rate >= PROVEN_THRESHOLD;
          const freshRGate = s.regimeStage ? freshRegimeGate[`${gateKey}|${s.regimeStage}`] : null;
          const freshRegimeVerified = freshRGate && freshRGate.rate >= PROVEN_THRESHOLD;
          const currentlyVerifiedFresh = !s.belowFloor && s.tier === "proven" && (freshOverallVerified || freshRegimeVerified);
          if (!currentlyVerifiedFresh && !isCoilTest) continue; // anything else reaches here only once genuinely, currently verified

          const verb = s.dir === "bull" ? "Buy" : "Sell";
          const payload = JSON.stringify({
            title: `${verb} ${isCoilTest ? `${brandName(s.label)} (testing)` : brandName(s.label)}`,
            body: `${coin} · ${TF[tf].label}, just fired.`,
            url: "/",
            tag: `${coin}-${s.label}-${s.dir}`,
          });

          for (const sub of subs) {
            if (!(sub.watchlist || []).includes(coin)) continue;
            // Real, temporary, named exception (Sep 6): Coil is brand
            // new and unverified, so unlike every other signal here, it
            // only ever reaches the admin subscriber, never a real,
            // paying customer, while it's still being tested.
            if (isCoilTest && !sub.is_admin) continue;
            try {
              await webpush.sendNotification(sub.subscription, payload);
              sent++;
            } catch (e) {
              if (e.statusCode === 404 || e.statusCode === 410) deadEndpoints.push(sub.endpoint);
            }
          }
        }
      }
    }

    if (deadEndpoints.length) {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ANY(${deadEndpoints})`;
    }

    return Response.json({ checked, sent, coinsChecked: neededCoins.size, accountsWithAlerts: subs.length, fetchErrors: fetchErrors.slice(0, 20), bigMove, trend });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
