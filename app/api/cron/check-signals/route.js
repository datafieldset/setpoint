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
import { computeSignals, DEFAULT_TH, getLiveVerifiedGate, marketRegime, PROVEN_THRESHOLD, reversalRisk } from "../../../../lib/signals.js";
import { brandName } from "../../../../lib/brand.js";
import { fetchCandles, getWeekly200MA, fetchFng, fetchBroadMarketBias, getRecentWhaleOutflow } from "../../../../lib/marketContext.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function configureWebPush() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:nokanetmail@gmail.com", pub, priv);
  return true;
}

export async function GET(req) {
  const authFail = checkKey(req);
  if (authFail) return authFail;

  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });
  const hasVapid = configureWebPush();
  if (!hasVapid) return Response.json({ error: "not_configured", checked: 0, sent: 0 });

  const sql = neon(conn, { fetchOptions: { cache: "no-store" } });

  try {
    // Real accounts with a real, active subscription, joined against
    // their own real, saved watchlist. Nothing here about coins nobody's
    // account actually watches. watchlist is stored as JSON text (same
    // as my-watchlist/route.js), not a real Postgres array, so it's
    // parsed here rather than filtered in SQL.
    const rawSubs = await sql`
      SELECT DISTINCT u.email, u.watchlist, ps.endpoint, ps.subscription
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
    if (!subs.length) return Response.json({ checked: 0, sent: 0, reason: "no_subscribers_with_watchlists" });

    // Real market context, fetched once, shared across every coin and
    // every account checked this run, same real inputs the dashboard
    // itself uses so a signal detected here matches what would have
    // shown there.
    const [fng, bias, weekly200, recentWhaleOutflow, liveGateResult] = await Promise.all([
      fetchFng().catch(() => null),
      fetchBroadMarketBias().catch(() => null),
      getWeekly200MA().catch(() => null),
      getRecentWhaleOutflow().catch(() => false),
      getLiveVerifiedGate(),
    ]);
    const { gate: liveGate, regimeGate } = liveGateResult;
    const risk = reversalRisk(bias, fng?.value);

    // Real, database-level protection, not an application-level guess.
    // The exact same partial unique index /api/track already relies on:
    // only one 'open' row allowed per (coin, tf, label, dir) at a time,
    // enforced by Postgres itself. This means the cron and a real,
    // actively-open browser tab can genuinely never both log or notify
    // about the same real fire, even if they both attempt it in the same
    // instant, the database itself is the single source of truth, not a
    // snapshot either side happened to read a moment earlier.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS signal_track_open_unique
      ON signal_track (coin, tf, label, dir)
      WHERE outcome = 'open'
    `;

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
          const th2 = { ...DEFAULT_TH, pctMin: TF[tf].pctMin };
          const barMsLen = TF[tf].gran * TF[tf].aggFactor * 1000;
          const cutoff = now - LOOKBACK_MS;
          const results = [];
          for (let i = 30; i < candles.length; i++) {
            if (candles[i].time < cutoff) continue; // outside the real lookback window
            const slice = candles.slice(0, i + 1);
            const { signals } = computeSignals(slice, tf, th2, {
              now: slice[slice.length - 1].time + barMsLen,
              marketBias: bias, reversalRisk: risk, fngValue: fng?.value, recentWhaleOutflow, liveGate,
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
          if (s.tier !== "proven") continue; // not statically verified at all
          const gateKey = `${s.label}|${TF[tf].label}|${s.dir}`;
          const gate = liveGate[gateKey];
          const overallVerified = !gate || gate.rate >= PROVEN_THRESHOLD;
          // Real, regime-specific check too — a signal can be genuinely
          // weak overall (blended across every market condition it's
          // ever fired in) while still earning a real, verified status
          // specific to the one condition it's actually good at. Only
          // trusted once it has the same, real minimum sample the
          // overall gate already requires; a regime bucket with too
          // little real, recent data defers to the overall number
          // rather than guessing.
          const rGate = s.regimeStage ? regimeGate[`${gateKey}|${s.regimeStage}`] : null;
          const regimeVerified = rGate && rGate.rate >= PROVEN_THRESHOLD;
          const currentlyVerified = overallVerified || regimeVerified;
          if (!currentlyVerified) continue;

          let inserted;
          try {
            const result = await sql`
              INSERT INTO signal_track (coin, tf, label, dir, fired_at, entry, stop, target, regime)
              VALUES (${coin}, ${TF[tf].label}, ${s.label}, ${s.dir}, now(), ${s.entry}, ${s.stop}, ${s.target}, ${s.regimeStage || null})
              ON CONFLICT (coin, tf, label, dir) WHERE outcome = 'open' DO NOTHING
              RETURNING id
            `;
            inserted = result.length > 0;
          } catch {
            continue; // a real logging failure here should never crash the whole run
          }
          if (!inserted) continue; // the database itself says this isn't actually new

          const verb = s.dir === "bull" ? "Buy" : "Sell";
          const payload = JSON.stringify({
            title: `${verb} ${brandName(s.label)}`,
            body: `${coin} · ${TF[tf].label}, just fired.`,
            url: "/",
            tag: `${coin}-${s.label}-${s.dir}`,
          });

          for (const sub of subs) {
            if (!(sub.watchlist || []).includes(coin)) continue;
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

    return Response.json({ checked, sent, coinsChecked: neededCoins.size, accountsWithAlerts: subs.length, fetchErrors: fetchErrors.slice(0, 20) });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
