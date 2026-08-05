// app/api/admin/test-whale/route.js
//
// Both the live dashboard's whale panel and the backtest page's whale
// direction tracking read from the exact same source: scraping Telegram's
// public web preview of @whale_alert_io (no official API, this is the
// free substitute). That kind of scraping is exactly the sort of thing
// that can silently break, Telegram changes their page's HTML, adds bot
// detection, rate-limits, and this fetch fails quietly, wrapped in a
// try/catch that just returns an empty array with zero visibility into
// why. This route calls the exact same fetch directly and returns real
// detail instead of a guess: the HTTP status, how many message blocks it
// found, and a sample of the raw HTML if nothing matched, so we can see
// definitively whether Telegram is blocking the request entirely or just
// changed the page structure the parser expects.
import { auth } from "../../../../auth.js";

export const dynamic = "force-dynamic";

const UA = { "User-Agent": "setpointalerts/1.1 (+https://setpointalerts.com)" };

export async function GET() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return Response.json({ error: "not_admin" }, { status: 403 });
  }

  try {
    const r = await fetch("https://t.me/s/whale_alert_io", { headers: UA, cache: "no-store" });
    const html = await r.text();
    const blocks = html.split("js-message_text").slice(1);
    return Response.json({
      httpStatus: r.status,
      httpOk: r.ok,
      htmlLength: html.length,
      messageBlocksFound: blocks.length,
      // A short raw sample so we can see exactly what came back if the
      // block count is 0, without needing server log access to check.
      htmlSample: blocks.length === 0 ? html.slice(0, 500) : null,
    });
  } catch (e) {
    return Response.json({ error: "fetch_failed", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
