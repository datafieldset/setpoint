// lib/bigMove.js
//
// "Big move underway" heads-up (v19.20). Not a trade signal. Our verified
// signals are short scalps, so a 48-hour run can happen with none of them
// firing. This just tells the admin that BTC has moved a lot, fast, so a
// human can look. Threshold picked from a year of BTC 1h data: 5% off the
// 12-hour low or high happens about 4 times a month.
import { fetchCandles } from "./marketContext.js";

export const BIG_MOVE_PCT = 5;
export const BIG_MOVE_WINDOW_H = 12;
export const BIG_MOVE_COOLDOWN_H = 12;

// Pure: given 1h candles, report the move or null.
export function detectBigMove(candles, pct = BIG_MOVE_PCT, windowH = BIG_MOVE_WINDOW_H) {
  if (!candles || candles.length < windowH + 1) return null;
  const w = candles.slice(-(windowH + 1));
  const last = w[w.length - 1].close;
  const lo = Math.min(...w.map((c) => c.low));
  const hi = Math.max(...w.map((c) => c.high));
  const up = (last / lo - 1) * 100;
  const down = (1 - last / hi) * 100;
  if (up >= pct && up >= down) return { dir: "up", pct: up, price: last };
  if (down >= pct) return { dir: "down", pct: down, price: last };
  return null;
}

// Checks BTC, and if a fresh big move is underway (not alerted for this
// direction in the last cooldown), sends one push to admins.
export async function checkBigMove(sql, webpush) {
  const candles = await fetchCandles("BTC", "1h");
  const move = detectBigMove(candles);
  if (!move) return { fired: false };
  await sql`CREATE TABLE IF NOT EXISTS big_move_alerts (id SERIAL PRIMARY KEY, dir TEXT NOT NULL, pct DOUBLE PRECISION, alerted_at TIMESTAMPTZ DEFAULT now())`;
  const recent = await sql`SELECT 1 FROM big_move_alerts WHERE dir = ${move.dir} AND alerted_at > now() - (${BIG_MOVE_COOLDOWN_H} * interval '1 hour') LIMIT 1`;
  if (recent.length) return { fired: false, cooling: true };
  await sql`INSERT INTO big_move_alerts (dir, pct) VALUES (${move.dir}, ${move.pct})`;
  const admins = await sql`
    SELECT DISTINCT ps.endpoint, ps.subscription
    FROM push_subscriptions ps JOIN users u ON u.email = ps.email
    WHERE u.is_admin = true
  `;
  const price = Math.round(move.price).toLocaleString("en-US");
  const payload = JSON.stringify({
    title: `Bitcoin is ${move.dir} ${move.pct.toFixed(1)}% in ${BIG_MOVE_WINDOW_H} hours`,
    body: `Now $${price}. Heads-up only, not a trade signal. Take a look at the chart.`,
    url: "/",
    tag: `big-move-${move.dir}`,
  });
  let sent = 0;
  for (const sub of admins) {
    try { await webpush.sendNotification(sub.subscription, payload); sent++; } catch { /* dead subscription, skip */ }
  }
  return { fired: true, dir: move.dir, pct: move.pct, sent };
}
