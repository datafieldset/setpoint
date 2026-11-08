// scripts/pull-trades.mjs
//
// One way to get every resolved trade out of the live database for analysis, reviews and replays (v22.0, Nov 7).
// Read-only. Pages through /api/resolved-positions. Run: node scripts/pull-trades.mjs [coin=BTC] [out=trades-live.json]
// Writes an array of { coin, tf, label, dir, firedAt, resolvedAt, entry, stop, target, exit, r, outcome, shadow } sorted oldest first.
import fs from "fs";
const BASE = process.env.SETPOINT_URL || "https://setpointalerts.com";
const KEY = process.env.SETPOINT_KEY || "verified2026"; // lib/access.js
const coin = process.argv[2] || "BTC";
const out = process.argv[3] || "trades-live.json";
const all = [];
let before = null;
for (let page = 0; page < 200; page++) {
  const url = `${BASE}/api/resolved-positions?key=${KEY}&coin=${coin}&limit=2000&include=quiet${before ? `&before=${before}` : ""}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`resolved-positions ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  if (!j.resolved.length) break;
  all.push(...j.resolved);
  before = Math.min(...j.resolved.map((x) => x.resolvedAt));
  if (j.resolved.length < 2000) break;
}
const seen = new Set();
const rows = all.filter((x) => { const k = `${x.tf}|${x.label}|${x.dir}|${x.firedAt}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.firedAt - b.firedAt);
fs.writeFileSync(out, JSON.stringify(rows));
const by = {};
for (const t of rows) { const k = `${t.label} ${t.tf}`; (by[k] ??= { n: 0, w: 0, R: 0 }); by[k].n++; by[k].w += t.r > 0; by[k].R += t.r; }
console.log(`${rows.length} trades for ${coin}, ${new Date(rows[0]?.firedAt).toISOString().slice(0, 10)} to ${new Date(rows.at(-1)?.firedAt).toISOString().slice(0, 10)} -> ${out}`);
for (const [k, v] of Object.entries(by).sort()) console.log(`  ${k}: ${v.n} trades, ${(v.w / v.n * 100).toFixed(0)}% wins, ${(v.R / v.n).toFixed(3)}R`);
