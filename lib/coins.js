// lib/coins.js
// One coin list, one name map. Import this everywhere instead of redefining it,
// so the watchlist presets and display names never drift between files.

export const COIN_PRESETS = [
  { sym: "BTC", name: "Bitcoin" },
  { sym: "SOL", name: "Solana" },
  { sym: "XLM", name: "Stellar" },
  { sym: "ETH", name: "Ethereum" },
  { sym: "XRP", name: "XRP" },
  { sym: "DOGE", name: "Dogecoin" },
  { sym: "ADA", name: "Cardano" },
  { sym: "AVAX", name: "Avalanche" },
  { sym: "LINK", name: "Chainlink" },
  { sym: "SUI", name: "Sui" },
];

export const NAME = Object.fromEntries(COIN_PRESETS.map((c) => [c.sym, c.name]));

// Coin limit now depends on which plan a user's actually paying for,
// Starter/Trader/Pro scale by coin count, that's the entire real
// difference between them. "watch" kept at 1 for any legacy free
// accounts that might still exist, never offered as a new signup choice
// anymore. Falls back to the tightest real limit for anything
// unrecognized, safer than accidentally granting more than paid for.
export const PLAN_COIN_LIMITS = { starter: 1, trader: 3, desk: 10, watch: 1 };
export function maxCoinsForPlan(plan) {
  return PLAN_COIN_LIMITS[plan] ?? 1;
}
