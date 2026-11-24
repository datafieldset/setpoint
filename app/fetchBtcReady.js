// app/fetchBtcReady.js
//
// v25.7: the data behind "How close is an alert" (lib/readiness.js), fetched the same way for the dashboard's Guide and the public /watch
// page. Takes Bitcoin's 1 hour candles and the 200-day line from the 1 hour /api/market call, loads the other charts the live signals
// read (from their own ALL_SIGNALS entries) plus the extra facts a row needs, and returns what signalReadiness() wants.
import { ALL_SIGNALS, isSignalVisible } from "../lib/signals.js";
import { readyTf, READY_EXTRA } from "../lib/readiness.js";

export async function fetchBtcReady(cs1h, sma) {
  const byTf = { "1h": cs1h || [] };
  const need = [...new Set(ALL_SIGNALS.filter((x) => x.ready && isSignalVisible(x.name)).map(readyTf).filter((t) => t && !byTf[t]))];
  await Promise.all(need.map(async (t) => {
    try {
      const r = await fetch(`/api/market?symbols=BTC&tf=${t}`, { cache: "no-store" });
      if (r.ok) byTf[t] = ((await r.json()).coins || []).find((c) => c.sym === "BTC")?.candles || null;
    } catch { /* that signal's row is left out */ }
  }));
  let extra = null; // facts a row needs beyond candles (Flow Rider's flow state), only fetched when a live signal asks for them
  if (ALL_SIGNALS.some((x) => x.ready && READY_EXTRA[x.ready] && isSignalVisible(x.name))) {
    try { const r = await fetch("/api/ready-state", { cache: "no-store" }); if (r.ok) extra = await r.json(); } catch { /* that signal's row is left out */ }
  }
  return { byTf, sma: sma || null, at: Date.now(), extra };
}
