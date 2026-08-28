// app/api/assess/route.js
// The reasoning layer. Given the computed indicators and recent headlines for one
// coin, Claude returns a short grounded read: is an overbought RSI a fade or a
// breakout given the catalyst? It must cite the actual numbers and not invent data.
// Requires ANTHROPIC_API_KEY in the environment (set it in Vercel project settings).
// POST /api/assess  { coin, name, timeframe, snap, signal, news }

export const dynamic = "force-dynamic";

import { STYLE_GUIDE } from "../../../lib/style.js";

// --- Spend protection ---------------------------------------------------------
// This is the only route that costs money (it calls Claude). Guard it so a script
// hitting the URL in a loop cannot run up the Anthropic bill.
// 1) Per-IP rate limit (in-memory; soft cap, resets on cold start). For a hard,
//    shared limit across instances, swap in Upstash Ratelimit later.
// 2) Optional origin allowlist: set ALLOWED_ORIGIN to your site URL to reject
//    requests that do not come from your own frontend.
// 3) The real ceiling is the monthly spend cap in the Anthropic console. Set it.
const RL = new Map(); // ip -> [timestamps]
const RL_MAX = parseInt(process.env.ASSESS_RATE_MAX || "12", 10);
const RL_WINDOW = 60 * 1000;

function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}
function rateLimited(ip) {
  const now = Date.now();
  const arr = (RL.get(ip) || []).filter((t) => now - t < RL_WINDOW);
  if (arr.length >= RL_MAX) { RL.set(ip, arr); return true; }
  arr.push(now); RL.set(ip, arr);
  return false;
}
function originOk(req) {
  const allow = process.env.ALLOWED_ORIGIN;
  if (!allow) return true; // not enforced unless you set ALLOWED_ORIGIN
  const o = req.headers.get("origin") || req.headers.get("referer") || "";
  try { return !!o && new URL(o).host === new URL(allow).host; } catch { return false; }
}
// ------------------------------------------------------------------------------

const SYSTEM = `You are a crypto market analyst embedded in an alert tool. You are given computed indicators and recent headlines for ONE coin. Write a short, grounded read of the current setup.

Rules:
- Ground everything in the actual numbers you are given (price, RSI, volume ratio, recent % move), never invent data or prices. But write the reasoning in plain language, describing what those readings mean (stretched, thin trading, real momentum), not by naming the indicator or citing its raw value. Real price and real percent moves are the exception, state those directly.
- If a momentum/RSI/volume reading and a news catalyst point different directions, say so plainly, in plain language, not by naming which indicator disagrees.
- Distinguish "overbought during a breakout with rising volume or a real catalyst" (possible strength, do not blindly fade) from "overbought while stalling with no catalyst" (possible fade), described in plain language, not by naming RSI directly.
- You are also given the broader market's current bias (bullish/bearish/none, based on the whole watchlist, not just this coin) and a reversal-risk read. Weigh the signal against this. A bullish signal fighting a stretched, high-risk bearish market deserves real skepticism in your reasoning, not a free pass. If reversal risk is elevated or high, say so plainly, since a stretched move can turn without much warning.
- Be direct and useful. This is informational, not financial advice, and you never tell the user to buy or sell.

${STYLE_GUIDE}

Return ONLY minified JSON, no markdown, no preamble:
{"stance":"bullish|bearish|neutral","confidence":"low|medium|high","headline":"<= 8 words","reasoning":"2-3 sentences citing the numbers and any catalyst","caution":"one short risk note"}`;

const CHATTER_EXTRA = `

This request is a coin-level read, not a single signal. Summarize what the recent news and social chatter is actually saying about this coin right now, and what it implies for the timeframe given, weighed against the indicators. Lead with the chatter, then the read.`;

export async function POST(req) {
  if (!originOk(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (rateLimited(clientIp(req))) return Response.json({ error: "rate_limited" }, { status: 429 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "no_key" });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }); }
  const { coin, name, timeframe, snap, signal, news, mode, marketBias, reversalRisk } = body || {};
  const model = process.env.SETPOINT_MODEL || "claude-haiku-4-5-20251001";
  const system = mode === "chatter" ? SYSTEM + CHATTER_EXTRA : SYSTEM;

  const payload = {
    coin,
    name,
    timeframe,
    indicators: snap,
    activeSignal: signal ? { type: signal.type, direction: signal.dir, note: signal.note } : null,
    recentHeadlines: (news || []).slice(0, 6).map((n) => ({ title: n.title, source: n.source, kind: n.kind })),
    broaderMarket: marketBias && marketBias.dir ? { bias: marketBias.dir, pctOfWatchlistAgreeing: marketBias.pctUp } : { bias: "none" },
    reversalRisk: reversalRisk && reversalRisk.level !== "low" ? reversalRisk : { level: "low" },
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json({ error: "api", detail: t.slice(0, 240) });
    }
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    let read;
    try { read = JSON.parse(text.replace(/```json|```/g, "").trim()); }
    catch { read = { stance: "neutral", confidence: "low", headline: "Read unavailable", reasoning: text.slice(0, 300), caution: "" }; }
    return Response.json({ read, model });
  } catch (e) {
    return Response.json({ error: "exception", detail: String(e).slice(0, 240) });
  }
}
