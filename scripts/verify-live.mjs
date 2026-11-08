// scripts/verify-live.mjs
//
// After a push: wait for the deploy to match the pushed commit, then check
// the live site. Run: node scripts/verify-live.mjs [commitSha] (default HEAD)
// Exits 1 on failure. See memory/review/README.md.
import { execSync } from "child_process";
import { meterMovesFrom, meterHeadline, checkMeter, meterFreshLine } from "../lib/meter.js";

const BASE = process.env.SETPOINT_URL || "https://setpointalerts.com";
const sha = process.argv[2] || execSync("git rev-parse HEAD").toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = [];

async function getJson(path) {
  const r = await fetch(BASE + path, { cache: "no-store" });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// 1. deploy matches
let deployed = null;
for (let i = 0; i < 30; i++) {
  try { deployed = (await getJson("/api/version")).body?.id; } catch { /* retry */ }
  if (deployed === sha) break;
  await sleep(10000);
}
if (deployed !== sha) bad.push(`deploy not live yet: site is on ${String(deployed).slice(0, 7)}, expected ${sha.slice(0, 7)}`);

// 2. homepage and watch page
for (const p of ["/", "/watch"]) {
  try { const r = await fetch(BASE + p); if (r.status !== 200) bad.push(`${p} returned ${r.status}`); } catch (e) { bad.push(`${p} unreachable: ${e.message}`); }
}

// 3. public stats healthy and sane
try {
  const { status, body } = await getJson("/api/public-stats");
  if (status !== 200 || !body) bad.push(`public-stats status ${status}`);
  else {
    if (body.error) bad.push(`public-stats error: ${body.error}`);
    if (typeof body.verifiedTotal !== "number") bad.push("public-stats missing verifiedTotal");
    if (body.verifiedTotal > 0 && body.avgR == null) bad.push("public-stats missing avgR");
  }
} catch (e) { bad.push(`public-stats unreachable: ${e.message}`); }

// 4. the track route must reject a fake trade
try {
  const r = await fetch(BASE + "/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin: "BTC", tf: "1h", label: "Reversal watch", dir: "bull", entry: 1, stop: 0.5, target: 2 }) });
  if (r.status !== 400) bad.push(`/api/track accepted a fake trade (status ${r.status})`);
} catch (e) { bad.push(`/api/track unreachable: ${e.message}`); }

// 5. the Market Meter sentence must agree with the real candles the page uses (added Nov 6 after "flat this week" with the week at -1.7%)
let meterNote = "meter not checked";
try {
  const { body } = await getJson("/api/market?symbols=BTC&tf=1h");
  const cs = (body?.coins || []).find((c) => c.sym === "BTC")?.candles || [];
  const mv = meterMovesFrom(cs);
  if (!mv) bad.push("meter: not enough 1 hour candles from /api/market");
  else {
    for (const stage of ["sideways-ranging", "bullish-trending", "bearish-trending"]) {
      const m = { stage, phase: "building", level: 3, label: stage === "bullish-trending" ? "Real uptrend, room left to run" : stage === "bearish-trending" ? "Real downtrend, room left to fall" : "No real direction yet" };
      for (const e of checkMeter(m, { ...mv, vs50: -7 })) bad.push("meter: " + e);
    }
    // freshness (v22.7): decide independently from the raw candles whether a flush happened in the last 6 hours, then compare with the meter
    const n = cs.length; let expect = false;
    for (let j = n - 1; j >= n - 7 && j >= 50; j--) { const b = cs[j]; if ((b.open - b.low) / b.open >= 0.025 && b.low < Math.min(...cs.slice(j - 48, j).map((x) => x.low))) { expect = true; break; } }
    if (expect !== !!mv.fresh) bad.push(`meter freshness: raw candles say flush=${expect}, meter says ${!!mv.fresh}`);
    meterNote = `meter fresh line: ${meterFreshLine(mv) || "(none, no flush in the last 6 hours)"} | meter reads: ${meterHeadline({ stage: "sideways-ranging", phase: "building", level: 1 }, { ...mv, vs50: -7 })}`;
  }
} catch (e) { bad.push(`meter check failed: ${e.message}`); }

// 6. quietly logged background signals must never show up on a customer surface (v22.2)
try {
  const { QUIET_LOG } = await import("../lib/quietLog.js");
  const names = [...new Set(QUIET_LOG.map((q) => q.label))];
  const pub = await getJson("/api/public-stats?coins=BTC");
  const txt = JSON.stringify(pub.body?.live || {});
  for (const n of names) if (txt.includes(`"${n}"`)) bad.push(`quiet signal "${n}" is visible in public stats`);
} catch (e) { bad.push(`quiet-signal visibility check failed: ${e.message}`); }

if (bad.length) { console.error("LIVE CHECK FAILED\n" + bad.map((b) => " - " + b).join("\n")); process.exit(1); }
console.log(`live ok: deploy ${sha.slice(0, 7)} serving, homepage + watch up, stats healthy, fake trade rejected.\n${meterNote}`);
