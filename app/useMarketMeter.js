"use client";
// app/useMarketMeter.js
//
// v25.7: everything the public /watch Market Meter page shows about Bitcoin right now, loaded with the same helpers the dashboard uses
// (marketRegime, meterMovesFrom + buildMeterMoves, fetchBtcReady). No account needed: /api/market and /api/news are public.
//   5 minute candles (every minute): the short-term read, the 15 minute move, the live price, the three lines and Mood.
//   1 hour candles + news (every 5 minutes): the 1h / 1d / 1w moves, the "how close is an alert" data, and Heavy volume.
import { useCallback, useEffect, useRef, useState } from "react";
import { marketRegime } from "../lib/signals.js";
import { meterMovesFrom, buildMeterMoves } from "../lib/meter.js";
import { fetchBtcReady } from "./fetchBtcReady.js";
import { useVisibleInterval } from "./useVisibleInterval.js";

export function useMarketMeter() {
  const [regime, setRegime] = useState(null);
  const [m15, setM15] = useState(null);
  const [price, setPrice] = useState(null);
  const [weekly200, setWeekly200] = useState(null);
  const [fng, setFng] = useState(null);
  const [btcMoves, setBtcMoves] = useState(null);
  const [ready, setReady] = useState(null);
  const [netFlow, setNetFlow] = useState(null);
  const [failed, setFailed] = useState(false);
  const slowAt = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market?symbols=BTC&tf=5m", { cache: "no-store" });
      if (!res.ok) throw new Error("api " + res.status);
      const json = await res.json();
      const btc = (json.coins || []).find((c) => c.sym === "BTC");
      const cs = btc && !btc.error ? btc.candles : null;
      if (!cs || !cs.length) throw new Error("no candles");
      setRegime(marketRegime(cs, "5m"));
      setPrice(cs[cs.length - 1].close);
      if (cs.length > 4) setM15((cs[cs.length - 1].close / cs[cs.length - 4].close - 1) * 100); // 3 five minute bars back = 15 minutes
      setWeekly200(json.weekly200 || null);
      setFng(json.fng || null);
      setFailed(false);
    } catch { setFailed(true); }

    if (Date.now() - slowAt.current < 5 * 60 * 1000) return;
    try {
      const r1 = await fetch("/api/market?symbols=BTC&tf=1h", { cache: "no-store" });
      if (r1.ok) {
        const j1 = await r1.json();
        const cs = ((j1.coins || []).find((c) => c.sym === "BTC") || {}).candles || [];
        const mv = meterMovesFrom(cs);
        if (mv) { setBtcMoves(mv); slowAt.current = Date.now(); } // only a success holds off the next try, so a failed first load retries in a minute
        setReady(await fetchBtcReady(cs, j1.trendSma));
      }
    } catch { /* the meter shows what it has */ }
    try {
      const rn = await fetch("/api/news?symbols=BTC", { cache: "no-store" });
      if (rn.ok) setNetFlow((await rn.json()).netFlow || null);
    } catch { /* the Heavy volume cell is left out */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibleInterval(load, 60000);

  const moves = buildMeterMoves(btcMoves, price, weekly200, m15);
  return { meter: regime, moves, price, weekly200, fng, netFlow, ready, failed, loaded: !!(regime && moves) };
}
