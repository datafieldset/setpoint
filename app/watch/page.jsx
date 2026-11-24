"use client";
// app/watch/page.jsx
//
// The public Market Meter page (v25.7). The page itself is app/components/MarketMeterPage.jsx, shared with the dashboard's WATCH LIVE button.
import { useEffect } from "react";
import MarketMeterPage from "../components/MarketMeterPage.jsx";

export default function WatchPage() {
  useEffect(() => {
    fetch("/api/track-visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/watch" }) }).catch(() => {});
  }, []);
  return <MarketMeterPage />;
}
