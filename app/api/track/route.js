// app/api/track/route.js
//
// Logs a live signal the moment it genuinely fires. This is the raw data
// the scoreboard and open-positions read: what actually happened, not
// another backtest replay.
//
// Real bug found and fixed here: the ONLY dedup protection used to live
// in browser memory (page.jsx's `fired` ref), which resets on every page
// load. Any signal still genuinely active at the moment of a refresh got
// logged again as a "new" fire, creating duplicate open rows for what was
// really the same ongoing trade. Same category of problem whale_track
// already solved correctly elsewhere in this app (a real UNIQUE
// constraint), just never applied here. Fixed with a partial unique
// index: only one 'open' row allowed per (coin, tf, label, dir) at a
// time, enforced by Postgres itself, not by anything client-side. Once
// that row resolves, a genuinely new fire can create a fresh one.
import { neon } from "@neondatabase/serverless";
import { getLiveVerifiedGate, verifiedAtFire, ALL_SIGNALS, SERVER_ONLY_SIGNALS, isSignalVisible } from "../../../lib/signals.js";
import { TF } from "../../../lib/timeframes.js";
import { fetchCandles } from "../../../lib/marketContext.js";
import { ensureSignalTrack } from "../../../lib/schema.js";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const conn = process.env.DATABASE_URL;
  if (!conn) return Response.json({ error: "no_database" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const { coin, tf, label, dir, entry, stop, target, firedAt, regime } = body || {};
  if (!coin || !tf || !label || !dir || entry == null || stop == null || target == null) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  // v19.20: this route is public, so nothing in the body is trusted.
  // The label, timeframe and direction must be real, the numbers must be
  // numbers, and the entry must sit near the coin's actual current price.
  // The target is then rebuilt on the server as exactly 2x the risk, so a
  // caller can never hand us a made-up payoff.
  // Signals the server logs itself (Trend Rider) are refused here: this
  // route is public, and a made-up trade must never reach a public record.
  if (!TF[tf] || (dir !== "bull" && dir !== "bear") || !ALL_SIGNALS.some((x) => x.name === label) || SERVER_ONLY_SIGNALS.includes(label) || !/^[A-Z0-9]{2,10}$/.test(String(coin))) {
    return Response.json({ error: "invalid_signal" }, { status: 400 });
  }
  // Focus mode (v19.41): a hidden signal is not logged at all (no candle fetch, no database call).
  if (!isSignalVisible(label)) return Response.json({ inserted: false, skipped: "hidden" });
  const e = Number(entry), st = Number(stop);
  if (![e, st].every((x) => Number.isFinite(x) && x > 0)) return Response.json({ error: "invalid_numbers" }, { status: 400 });
  const risk = Math.abs(e - st);
  if ((dir === "bull" ? st >= e : st <= e) || risk / e < 0.0005 || risk / e > 0.15) {
    return Response.json({ error: "invalid_levels" }, { status: 400 });
  }
  let lastClose;
  try {
    const cs = await fetchCandles(String(coin), tf);
    lastClose = cs[cs.length - 1].close;
  } catch { return Response.json({ error: "price_unavailable" }, { status: 503 }); }
  if (Math.abs(e - lastClose) / lastClose > 0.02) return Response.json({ error: "entry_off_market" }, { status: 400 });
  const target2 = dir === "bull" ? e + 2 * risk : e - 2 * risk;

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await ensureSignalTrack(sql);
    // Stamped here on the server from the server's own gate, never from
    // anything the browser sends, so it can't be faked. NULL if the
    // check can't run, which readers treat as "judge by today's status".
    let verified = null;
    try {
      const { gate, regimeGate } = await getLiveVerifiedGate();
      verified = verifiedAtFire(label, tf, dir, regime || null, gate, regimeGate, { entry: e, target: target2 });
    } catch { /* leave null */ }
    const result = await sql`
      INSERT INTO signal_track (coin, tf, label, dir, fired_at, entry, stop, target, regime, verified_at_fire)
      VALUES (${coin}, ${tf}, ${label}, ${dir}, ${firedAt ? new Date(firedAt) : new Date()}, ${e}, ${st}, ${target2}, ${regime || null}, ${verified})
      ON CONFLICT (coin, tf, label, dir) WHERE outcome = 'open' DO NOTHING
      RETURNING id
    `;
    return Response.json({ ok: true, inserted: result.length > 0 });
  } catch (e) {
    return Response.json({ error: "server_error", detail: String(e).slice(0, 200) }, { status: 500 });
  }
}
