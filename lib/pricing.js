// lib/pricing.js
//
// The single, real source for every price shown anywhere on the site.
// This exists specifically because pricing used to be duplicated across
// six separate spots in page.jsx, and a real price change once missed
// one of them — the site displayed one number while Stripe charged
// another. Every place a price needs to show now imports from here.
// Change a number in exactly one place, it's correct everywhere.
//
// checkout/route.js's PRICE_IDS keys (starter/trader/desk) match these
// ids on purpose — one id, one price, one Stripe Price ID, all
// referenced by the same string everywhere.
export const PRICING = {
  starter: {
    id: "starter",
    name: "Starter",
    price: "$19.99",
    per: "/mo",
    coins: 1,
    feats: [
      "1 coin",
      "Every verified signal, checked live",
      "Locked entry / stop / target, never redrawn",
      "Full market context, whale flow, Fear & Greed, 200-week trend",
      "Volatility meter & extreme-read alerts",
    ],
  },
  trader: {
    id: "trader",
    name: "Trader",
    price: "$49.99",
    per: "/mo",
    coins: 3,
    feats: ["3 coins", "Everything in Starter"],
  },
  desk: {
    id: "desk",
    name: "Pro",
    price: "$99.99",
    per: "/mo",
    coins: 10,
    feats: ["10 coins", "Everything in Trader"],
  },
};

// Ordered list, for anywhere rendering all three tiers as a row/grid.
export const PRICING_LIST = [PRICING.starter, PRICING.trader, PRICING.desk];

// "Starter, $19.99/mo" — the exact format the plan-name chip during
// signup needs. Built here so a price change updates this text too,
// automatically, without a fourth hardcoded copy of the same numbers.
export function planLabel(planId) {
  const p = PRICING[planId];
  return p ? `${p.name}, ${p.price}${p.per}` : null;
}
