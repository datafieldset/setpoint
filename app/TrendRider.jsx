"use client";
// app/TrendRider.jsx
//
// Trend Rider pieces for the dashboard. There is no Trend Rider panel: it
// plugs into the existing coins-tab layout. app/page.jsx owns the timeframe
// buttons, "Open Alerts" and "Recently resolved"; this file supplies the
// data hook, the card for an open trade (same look as every signal card)
// and the row for a closed trade. The description lives in the Guide.
import { useEffect, useState } from "react";

const fmtPrice = (p) => (p == null || isNaN(p) ? "—" : Math.round(p).toLocaleString("en-US"));
const fmtR = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`);
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (iso, now) => {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  return h < 48 ? h + "h ago" : Math.floor(h / 24) + "d ago";
};
const EARLY = 10; // below this many closed trades a win rate is just an early read

// Same ladder look as every other card, minus the target: Trend Rider has no
// fixed target, the stop trails behind price and the trade ends when it's hit.
function TrailLadder({ entry, stop, price, dir, openR }) {
  const vals = [entry, stop, price];
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.2 || Math.abs(max) * 0.01 || 1;
  const lo = min - pad, hi = max + pad;
  const y = (p) => (1 - (p - lo) / (hi - lo)) * 100;
  const toStop = ((stop - price) / price) * 100;
  return (
    <div className="ladder">
      <div className="rail">
        <div className="rail-line" />
        <div className="mk mk-entry" style={{ top: y(entry) + "%" }}><span className="mk-dot" /><span className="mk-lab">ENTRY</span><span className="mk-val">{fmtPrice(entry)}</span></div>
        <div className="mk mk-stop" style={{ top: y(stop) + "%" }}><span className="mk-dot" /><span className="mk-lab">STOP</span><span className="mk-val">{fmtPrice(stop)}</span></div>
        <div className="mk mk-live" style={{ top: y(price) + "%" }}><span className="live-tri" /></div>
      </div>
      <div className="ladder-meta">
        <div className="rr" style={openR < 0 ? { color: "var(--red)" } : dir === "short" ? { color: "var(--green)" } : undefined}>{fmtR(openR)}</div>
        <div className="rr-sub">result right now</div>
        <div className="tgt-row"><span className={toStop < 0 === (dir === "long") ? "down" : "up"}>{(toStop > 0 ? "+" : "") + toStop.toFixed(2)}%</span><span className="lab">to trailing stop</span></div>
        <div className="tgt-row"><span className="lab">no target, stop follows price</span></div>
      </div>
    </div>
  );
}

export function TrendCard({ p, rec, tf, price, now }) {
  const bull = p.dir === "long";
  const n = rec.trades;
  return (
    <div className={`sig-card ${bull ? "bull" : "bear"}`}>
      <div className="sig-top">
        <div className="sig-id">
          <span className="sym">BTC</span>
          <span className="sig-type">{bull ? "Buy" : "Sell"} Trend Rider{n >= EARLY && rec.winPct != null ? ` ${rec.winPct}%` : ""}</span>
          {n > 0 ? (
            <span className="rate-src live" title="A real number from this timeframe's own closed paper trades">live, {n} trade{n === 1 ? "" : "s"}</span>
          ) : (
            <span className="testing-tag">testing, no results yet</span>
          )}
          <span className="open-pos-tag">still in motion</span>
        </div>
        <span className={`badge ${bull ? "up" : "down"}`}>{bull ? "LONG" : "SHORT"}</span>
      </div>
      <div className="sig-note">{bull ? "Price broke above the highest high of the last 20 candles." : "Price broke below the lowest low of the last 20 candles."} The stop trails behind it.</div>
      <div className="sig-price-row">
        <div><div className="k">Price</div><div className="v mono">{fmtPrice(price)}</div></div>
      </div>
      <TrailLadder entry={p.entry} stop={p.stop} price={price} dir={p.dir} openR={p.openR} />
      <div className="sig-foot">
        <span className="tf-pill">{tf}</span>
        <span className="fired">fired {ago(p.openedAt, now)} · still open</span>
      </div>
    </div>
  );
}

export function useTrend() {
  const [d, setD] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/trend", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
        .then((j) => { if (alive) { setD(j); setNow(Date.now()); } })
        .catch(() => { /* keep the last good data, retry on the next tick */ });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 30000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return { d, now };
}

export function TrendResolvedRow({ c, tf }) {
  const win = c.r > 0;
  return (
    <div className={`rr-row ${win ? "win" : "loss"}`}>
      <span className="rr-coin">BTC</span>
      <span className="rr-tf">{tf}</span>
      <span className="rr-name">{c.dir === "long" ? "Buy" : "Sell"} Trend Rider</span>
      <span className={`rr-outcome ${win ? "win" : "loss"}`}>{win ? "WIN" : "LOSS"}</span>
      <span className={`rr-pct ${win ? "win" : "loss"}`}>{fmtR(c.r)}</span>
      <span className="rr-when">{fmtPrice(c.entry)} to {fmtPrice(c.exit)} · resolved {when(c.closedAt)}</span>
    </div>
  );
}
