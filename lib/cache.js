// lib/cache.js
//
// One, real, shared, in-memory cache, built Oct 2 as the first real
// piece of the caching overhaul. Before this, every route that needed
// to cache a real database query reinvented its own module-level
// variable and TTL check (getLiveVerifiedGate, getSignalBias, and
// getFullSignalGate in lib/signals.js and app/api/market/route.js all
// independently built the same, real pattern, each slightly
// differently), while several other, real, frequently-hit routes
// (/api/open-positions, polled every 60s by every active customer;
// /api/public-stats, genuinely public with no rate limit at all) had
// no caching whatsoever, every single call triggering a fresh,
// uncached database query. This is the one, shared, consistent
// pattern going forward.
//
// Real, honest, deliberate limitation, same one every cache already
// in this codebase already accepts: this is in-memory, scoped to a
// single serverless instance. A cold instance just recomputes fresh —
// never a correctness issue, only ever a cost one. Caching here
// reduces real, redundant database hits when the SAME warm instance
// handles multiple, close-together requests, which is genuinely most
// of the real, repeated traffic this app sees (many customers polling
// on the same, real 60-second cadence land on the same instance often
// enough to matter).
const store = new Map();

export async function withCache(key, ttlMs, fetchFn) {
  const now = Date.now();
  const entry = store.get(key);
  if (ttlMs > 0 && entry && now - entry.at < ttlMs) {
    return entry.data;
  }
  const data = await fetchFn();
  store.set(key, { data, at: now });
  return data;
}

export function clearCache(key) {
  store.delete(key);
}
