// app/api/assess/route.js
// The reasoning layer. Given the computed indicators and recent headlines for one
// coin, Claude returns a short grounded read: is an overbought RSI a fade or a
// breakout given the catalyst? It must cite the actual numbers and not invent data.
// Requires ANTHROPIC_API_KEY in the environment (set it in Vercel project settings).
// POST /api/assess  { coin, name, timeframe, snap, signal, news }

export const dynamic = "force-dynamic";

import { STYLE_GUIDE } from "../../../lib/style.js";

const SYSTEM = `You are a crypto market analyst embedded in an alert tool. You are given computed indicators and recent headlines for ONE coin. Write a short, grounded read of the current setup.

Rules:
- Reference the actual numbers you are given (price, RSI, volume ratio, recent % move). Never invent data or prices.
- If a momentum/RSI/volume reading and a news catalyst point different directions, say so plainly.
- Distinguish "overbought during a breakout with rising volume or a real catalyst" (possible strength, do not blindly fade) from "overbought while stalling with no catalyst" (possible fade).
- Be direct and useful. This is informational, not financial advice, and you never tell the user to buy or sell.

${STYLE_GUIDE}

Return ONLY minified JSON, no markdown, no preamble:
{"stance":"bullish|bearish|neutral","confidence":"low|medium|high","headline":"<= 8 words","reasoning":"2-3 sentences citing the numbers and any catalyst","caution":"one short risk note"}`;

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "no_key" });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }); }
  const { coin, name, timeframe, snap, signal, news } = body || {};
  const model = process.env.SETPOINT_MODEL || "claude-haiku-4-5-20251001";

  const payload = {
    coin,
    name,
    timeframe,
    indicators: snap,
    activeSignal: signal ? { type: signal.type, direction: signal.dir, note: signal.note } : null,
    recentHeadlines: (news || []).slice(0, 6).map((n) => ({ title: n.title, source: n.source, kind: n.kind })),
  };

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system: SYSTEM,
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
