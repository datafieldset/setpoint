// app/api/cron/check-promotions/route.js
//
// Real, direct fix (Oct 2) for the recurring root cause behind almost
// every bug found this whole session: something only ever got caught
// when a human happened to notice it in chat, not a real system.
// Whale Flow's retirement sat unrecorded in memory for two versions.
// RSI oversold and Reversal watch quietly earned real, current edges
// nobody saw until a confusing push notification prompted a direct
// question. This runs on its own, infrequent schedule (see
// signals-promotion-cron.yml) and checks every real signal, every
// timeframe, every direction, for anything that's newly, genuinely
// qualifying for established or emerging tier but doesn't have a
// static SIGNAL_RATES entry yet — then sends a real, direct, admin-
// only push, so a genuine, current edge gets surfaced on its own,
// instead of waiting for someone to think to look.
//
// Deliberately does NOT touch SIGNAL_RATES itself — this surfaces a
// real, honest candidate, it never auto-promotes one. A promotion
// still means a real, deliberate decision, same discipline as every
// other promotion this whole project, just no longer gated behind
// someone happening to notice first.
import { checkKey } from "../../../../lib/access.js";
import { neon } from "@neondatabase/serverless";
import webpush from "web-push";
import { TF } from "../../../../lib/timeframes.js";
import { ALL_SIGNALS, SIGNAL_RATES, PROVEN_THRESHOLD, getFullSignalGate, confidenceTier } from "../../../../lib/signals.js";
import { brandName } from "../../../../lib/brand.js";

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

  try {
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await sql`
      CREATE TABLE IF NOT EXISTS promotion_alerts (
        combo_key TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        rate DOUBLE PRECISION,
        n INTEGER,
        alerted_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    // Default cache is fine here — this cron runs every few hours at
    // most, nothing about that needs to-the-second freshness, and
    // reusing the existing cache keeps this consistent with every
    // other real caller of this same function.
    const { gate: fullGate, regimeGate: fullRegimeGate } = await getFullSignalGate();

    const tfLabels = Object.values(TF).map((t) => t.label);
    const dirs = ["bull", "bear"];
    const newlyQualifying = [];

    for (const { name } of ALL_SIGNALS) {
      for (const tf of tfLabels) {
        for (const dir of dirs) {
          const staticKey = `${name}|${tf}|${dir}`;
          const alreadyStaticallyPromoted = !!SIGNAL_RATES[staticKey] && SIGNAL_RATES[staticKey].rate != null && SIGNAL_RATES[staticKey].rate >= PROVEN_THRESHOLD;
          if (alreadyStaticallyPromoted) continue; // already a real, deliberate promotion, nothing new to surface

          const ct = confidenceTier(name, tf, dir, {}, null, {}, fullGate, fullRegimeGate);
          if (ct.tier !== "established" && ct.tier !== "emerging") continue;

          const comboKey = `${staticKey}${ct.regimeStage ? `|${ct.regimeStage}` : ""}`;
          newlyQualifying.push({ name, tf, dir, comboKey, ...ct });
        }
      }
    }

    // Real, direct dedup — only a genuinely new finding, or one whose
    // tier has actually changed, or one it's been a real, full day
    // since the last alert on, gets a fresh push. Otherwise this
    // would nag every single run on the same, already-seen candidate
    // until someone acts on it.
    const existingAlerts = await sql`SELECT combo_key, tier, alerted_at FROM promotion_alerts`;
    const alertMap = new Map(existingAlerts.map((r) => [r.combo_key, r]));
    const toNotify = newlyQualifying.filter((c) => {
      const prior = alertMap.get(c.comboKey);
      if (!prior) return true;
      if (prior.tier !== c.tier) return true;
      const hoursSince = (Date.now() - new Date(prior.alerted_at).getTime()) / 3600000;
      return hoursSince >= 24;
    });

    if (toNotify.length === 0) {
      return Response.json({ checked: newlyQualifying.length, notified: 0, sent: 0 });
    }

    for (const c of toNotify) {
      await sql`
        INSERT INTO promotion_alerts (combo_key, tier, rate, n, alerted_at)
        VALUES (${c.comboKey}, ${c.tier}, ${c.rate}, ${c.n}, now())
        ON CONFLICT (combo_key) DO UPDATE SET tier = ${c.tier}, rate = ${c.rate}, n = ${c.n}, alerted_at = now()
      `;
    }

    const pushReady = configureWebPush();
    let sent = 0;
    if (pushReady) {
      const admins = await sql`
        SELECT DISTINCT ps.endpoint, ps.subscription
        FROM push_subscriptions ps
        JOIN users u ON u.email = ps.email
        WHERE u.is_admin = true
      `;
      const title = toNotify.length === 1
        ? `${brandName(toNotify[0].name)} ${toNotify[0].dir === "bull" ? "long" : "short"} on ${toNotify[0].tf} is now ${toNotify[0].tier}`
        : `${toNotify.length} real signals just crossed into a new tier`;
      const body = toNotify.slice(0, 3).map((c) => `${brandName(c.name)} ${c.dir === "bull" ? "long" : "short"} ${c.tf}: ${Math.round(c.rate * 100)}% (${c.tier}, ${c.n} trades)`).join(" · ");
      const payload = JSON.stringify({ title, body, url: "/?view=guide", tag: "promotion-alert" });

      for (const sub of admins) {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          sent++;
        } catch {
          // a single, real, dead subscription failing here should
          // never block the rest of the real alerts from going out
        }
      }
    }

    return Response.json({ checked: newlyQualifying.length, notified: toNotify.length, sent });
  } catch (e) {
    return Response.json({ error: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
