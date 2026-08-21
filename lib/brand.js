// lib/brand.js
//
// Customer-facing names for each signal type. Internal labels ("RSI
// oversold", "Volume spike") point at specific, real technical concepts,
// which matters for us building and improving them, but customers aren't
// here to become signal experts, they're paying for the signal itself.
// This is the one, single place that translation happens, so the public
// Watch Live page and any future customer-facing surface stay consistent
// with each other automatically.
//
// Only the signal types that have actually earned a verified brand name
// so far are listed here. Anything not yet named falls back to its raw
// internal label, that's a real, visible gap, a signal showing up
// unnamed on the live page is a genuine prompt to go name it, not a bug
// to hide.
export const BRAND_NAMES = {
  "Volume spike": "Surge",
  "Quiet accumulation": "Quiet Build",
  "RSI oversold": "Snapback",
  "RSI overbought": "Fade",
  "Volume building early": "Early Push",
  "Whale Flow": "Undertow",
};

export function brandName(label) {
  return BRAND_NAMES[label] || label;
}
