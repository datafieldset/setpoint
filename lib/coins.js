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
export const MAX_COINS = 6;
