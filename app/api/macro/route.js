// app/api/macro/route.js
//
// The "outside forces" read. Everything else in this app derives its view of
// the market purely from price. This is the one piece that doesn't, it asks
// an AI to read actual news, broad market headlines, not filtered to any one
// coin, and give a plain read: does the story right now support bullish or
// bearish, and is there a scheduled event, a vote, a decision, coming that
// could flip things. Cached and slow-moving on purpose, same reasoning as
// the weekly 200 MA: this is background context, not a per-refresh number.

import { getRss, getReddit, getTelegram, TELEGRAM_CHANNELS } from "../news/route.js";
import { STYLE_GUIDE } from "../../../lib/style.js";

export const dynamic = "force-dynamic";

const CACHE_HOURS = 3;

const SYSTEM = `You read broad crypto market news and give a plain, honest read of the current macro mood. You are not looking at any one coin, you are looking at the overall story.

Rules:
- Base your read only on the headlines you are given. Never invent news or events.
- If the headlines are mixed or unclear, say so plainly, "neutral" and "low confidence" are honest answers, not failures.
- Separately from the current mood, note if any of the headlines mention a scheduled, not-yet-resolved event (a vote, a decision, a hearing, an approval date) that could move the market once it resolves. If none, say so.
- This is informational only. Never tell the reader to buy or sell.

${STYLE_GUIDE}

Return ONLY minified JSON, no markdown, no preamble:
{"stance":"bullish|bearish|neutral","confidence":"low|medium|high","headline":"<= 8 words","reasoning":"2-3 sentences citing what's actually in the headlines","catalyst":"one sentence on any pending scheduled event, or empty string if none"}`;

async function getBroadNews() {
  const [rss, reddit, tg] = await Promise.all([getRss(), getReddit(), getTelegram(TELEGRAM_CHANNELS)]);
  const all = [...rss, ...reddit, ...tg].filter((x) => x.title && x.title.length > 4);
  const seen = new Set();
  const deduped = all.filter((x) => {
    const k = x.title.slice(0, 60).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.sort((a, b) => (b.watched ? 1 : 0) - (a.watched ? 1 : 0) || b.when - a.when).slice(0, 20);
}

async function generateMacroRead(key) {
  if (!key) return { error: "no_key" };
  const headlines = await getBroadNews();
  if (!headlines.length) return { error: "no_news" };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.SETPOINT_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify({ headlines: headlines.map((h) => ({ title: h.title, source: h.source })) }) }],
      }),
    });
    if (!r.ok) return { error: "api" };
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const read = JSON.parse(text.replace(/```json|```/g, "").trim());
    return { read, generatedAt: Date.now(), headlineCount: headlines.length };
  } catch (e) {
    return { error: "exception", detail: String(e).slice(0, 150) };
  }
}

const NO_CACHE = { headers: { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } };

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;
  const conn = process.env.DATABASE_URL;

  if (!conn) {
    const fresh = await generateMacroRead(key);
    return Response.json(fresh, NO_CACHE);
  }

  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(conn, { fetchOptions: { cache: "no-store" } });
    await sql`
      CREATE TABLE IF NOT EXISTS macro_cache (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const rows = await sql`SELECT value, updated_at FROM macro_cache WHERE key = 'macro_read'`;
    const isFresh = rows.length && (Date.now() - new Date(rows[0].updated_at).getTime()) < CACHE_HOURS * 3600 * 1000;
    if (isFresh) return Response.json(rows[0].value, NO_CACHE);

    const fresh = await generateMacroRead(key);
    if (fresh.error) {
      // Generation failed, serve stale cache over nothing if we have it
      return Response.json(rows.length ? rows[0].value : fresh, NO_CACHE);
    }
    await sql`
      INSERT INTO macro_cache (key, value, updated_at) VALUES ('macro_read', ${JSON.stringify(fresh)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(fresh)}::jsonb, updated_at = now()
    `;
    return Response.json(fresh, NO_CACHE);
  } catch (e) {
    const fresh = await generateMacroRead(key);
    return Response.json(fresh, NO_CACHE);
  }
}
