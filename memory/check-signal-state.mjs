#!/usr/bin/env node
// memory/check-signal-state.mjs
//
// Real, direct ground truth about signal state, pulled straight from
// the live code, not from memory. Run this before trusting anything
// signal-roster.md says about counts, names, or current promotions —
// that file deliberately avoids asserting these as fact for exactly
// this reason, since they've already drifted out of sync once (Sep
// 24-26: Whale Flow was fully retired in v19.7, but the memory update
// that should have gone with it never happened, and signal-roster.md
// sat wrong for two real versions before anyone noticed).
//
// Usage: node memory/check-signal-state.mjs
// (run from the repo root, or anywhere — the import path below is
// relative to this file's own location)
import { ALL_SIGNALS, SIGNAL_RATES, PROVEN_THRESHOLD, KILLED_COMBOS, TESTING_SIGNALS } from "../lib/signals.js";

console.log(`Total real signals (ALL_SIGNALS): ${ALL_SIGNALS.length}`);
console.log(ALL_SIGNALS.map((s) => s.name).join(", "));

console.log(`\nCurrently, statically promoted (SIGNAL_RATES >= ${Math.round(PROVEN_THRESHOLD * 100)}%):`);
const promoted = Object.entries(SIGNAL_RATES).filter(([, v]) => v.rate != null && v.rate >= PROVEN_THRESHOLD);
for (const [key, v] of promoted) console.log(`  ${key} — ${Math.round(v.rate * 100)}%`);
console.log(`(${promoted.length} total — remember: static promotion isn't the same as currently showing as verified, the live gate can demote these in real time; check /api/market's liveGate/regimeGate for that)`);

console.log(`\nIn TESTING_SIGNALS (logged + shown admin-only even while unproven): ${TESTING_SIGNALS.join(", ")}`);

console.log(`\nKILLED_COMBOS (${KILLED_COMBOS.length} total, never fire again):`);
for (const c of KILLED_COMBOS) console.log(`  ${typeof c === "string" ? c : c}`);

const promotedNames = new Set(promoted.map(([key]) => key.split("|")[0]));
const darkNames = ALL_SIGNALS.map((s) => s.name).filter((n) => !promotedNames.has(n) && !TESTING_SIGNALS.includes(n));
console.log(`\nCurrently dark / collecting-only (no STATIC entry, not in TESTING_SIGNALS):`);
console.log(darkNames.length ? `  ${darkNames.join(", ")}` : "  (none)");
console.log(`(a name here can still be genuinely, dynamically verified right now via the regime-only path — check /api/market's regimeGate directly for any of these before assuming it's truly invisible)`);
