// lib/format.js
//
// v25.7: the number formats the dashboard and the public Market Meter page both use (they used to live inside app/page.jsx).
export const fmtPrice = (p) => {
  if (p == null || isNaN(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toLocaleString("en-US", { maximumFractionDigits: 5 });
};
export const fmtPct = (x) => (x == null || isNaN(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(2) + "%");
export const fmtVol = (v) => {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
  return "$" + v.toFixed(0);
};
export const fngColor = (v) => (v >= 75 ? "#00D179" : v >= 55 ? "#5EE9AE" : v >= 45 ? "#93A69D" : v >= 25 ? "#F5B851" : "#FF5C6C");
