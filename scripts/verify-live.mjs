// scripts/verify-live.mjs
//
// After a push: wait for the deploy to match the pushed commit, then check
// the live site. Run: node scripts/verify-live.mjs [commitSha] (default HEAD)
// Exits 1 on failure. See memory/review/README.md.
import { execSync } from "child_process";

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

if (bad.length) { console.error("LIVE CHECK FAILED\n" + bad.map((b) => " - " + b).join("\n")); process.exit(1); }
console.log(`live ok: deploy ${sha.slice(0, 7)} serving, homepage + watch up, stats healthy, fake trade rejected.`);
