"use client";
// app/watch/page.jsx
//
// The public Market Meter page (v25.7, Nov 23, Na: "the meter code is supposed to replace the live watch page"). It is the free lead magnet:
// anyone can open it, no account. It shows Bitcoin right now (the same Market Meter card and Price vs averages card the dashboard uses,
// drawn by the same components), then the honest record: scoreboard, the live signals and every finished trade, wins and losses.
//
// Signed out: Mood + Heavy volume, three of the four chart tabs, and each trade's entry and exit are blurred behind "free account", and a
// sign-up card closes the page. Signed in: the same page with everything open. The old Watch Live content (WatchLiveContent.jsx) still
// serves the paid dashboard.
//
// Nothing here names a signal: the list reads ALL_SIGNALS (name, tfs, blurb, ready) and /api/public-stats, so a new signal appears by data.
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { ALL_SIGNALS, isSignalVisible } from "../../lib/signals.js";
import { brandName } from "../../lib/brand.js";
import { signalReadiness, readyTf } from "../../lib/readiness.js";
import { fmtPrice } from "../../lib/format.js";
import { LongTermLines, MeterCore, LockIcon } from "../components/MeterParts.jsx";
import { METER_VARS, METER_CSS, METER_LOCK_CSS } from "../components/meterCss.js";
import { useMarketMeter } from "../useMarketMeter.js";
import { useVisibleInterval } from "../useVisibleInterval.js";

// Round first, then pick the sign, so a tiny negative never prints as "−0.00".
const signed = (v, unit) => { if (!Number.isFinite(v)) return "—"; const t = Math.abs(v).toFixed(2); return `${Number(t) === 0 ? "" : v < 0 ? "−" : "+"}${t}${unit}`; };
const fmtR = (r) => signed(r, "R");
const fmtMove = (p) => signed(p, "%");
const dayOf = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const whenOf = (t) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const toUnlock = () => { try { document.getElementById("unlock")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* ignore */ } };

export default function WatchPage() {
  const { status } = useSession(); // "loading" | "authenticated" | "unauthenticated"
  const signedIn = status === "authenticated";
  const settled = status !== "loading"; // until the session answers, show neither the locked nor the open version
  const locked = !signedIn;
  const m = useMarketMeter();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch("/api/track-visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/watch" }) }).catch(() => {});
  }, []);

  // The record is Bitcoin's (every live signal is tested on Bitcoin only).
  const loadStats = async () => {
    try {
      const r = await fetch("/api/public-stats?coins=BTC", { cache: "no-store" });
      if (r.ok) setStats(await r.json());
    } catch { /* keep what is showing */ }
  };
  useEffect(() => { loadStats(); }, []);
  useVisibleInterval(loadStats, 60000);

  // "How close is an alert" badge per live signal (lib/readiness.js), Bitcoin only, same as the dashboard's Guide.
  const readyByName = useMemo(() => {
    const out = {};
    if (!m.ready) return out;
    for (const x of ALL_SIGNALS) {
      if (!x.ready || !isSignalVisible(x.name)) continue;
      const tf = readyTf(x);
      const r = signalReadiness(x, { candles: m.ready.byTf[tf], sma: m.ready.sma, now: m.ready.at, tf, extra: m.ready.extra, open: false });
      if (r) out[brandName(x.name)] = r;
    }
    return out;
  }, [m.ready]);

  const live = stats?.live || null;
  const total = live ? live.wins + live.losses : 0;
  const signals = ALL_SIGNALS.filter((x) => isSignalVisible(x.name));

  return (
    <div className="wm-page">
      {/* dangerouslySetInnerHTML: React escapes "&" in a style tag's text ("&amp;"), which breaks the font URL below and makes the server and browser HTML differ */}
      {[FONT_CSS, METER_VARS, METER_CSS, METER_LOCK_CSS, PAGE_CSS].map((css, i) => <style key={i} dangerouslySetInnerHTML={{ __html: css }} />)}

      <div className="wm-wrap">
        <div className="wm-top">
          <a className="wm-brand" href="/"><span className="wm-logo" /><span className="wm-word">SETPOINT<b>ALERTS</b></span></a>
          <a className="wm-ghost" href="/">{signedIn ? "Dashboard" : "Sign in"}</a>
        </div>

        <header className="wm-hero">
          <div className="wm-eyebrow mono"><span className="wm-dot" />MARKET METER · LIVE</div>
          <h1>The whole market, <span>one glance.</span></h1>
          <p>The lines, the pressure, and the swings, all in one place, plus every alert, win or lose, with the price locked the second it fired.</p>
          {!settled ? null : locked ? (
            <>
              <a className="wm-cta" href="/?signup=watch">Unlock the Meter, free</a>
              <div className="wm-fine">Free account. No card. Upgrade only if you want live alerts on your own coins.</div>
            </>
          ) : (
            <a className="wm-cta" href="/">Open your dashboard</a>
          )}
        </header>

        {/* ---- Bitcoin right now ---- */}
        {m.loaded && settled ? (
          <>
            <div className="mm-panel">
              <div className="mm-head">
                <span className="mm-title">Market Meter</span>
                <span className="mm-sub wm-live"><span className="wm-dot" />Live · Bitcoin</span>
              </div>
              <MeterCore meter={m.meter} moves={m.moves} fng={m.fng} netFlow={m.netFlow} locked={locked} onLocked={toUnlock} />
            </div>
            <LongTermLines weekly200={m.weekly200} price={m.price} locked={locked} onLocked={toUnlock} />
            {m.fng && (
              <div className="wm-credit">Mood is the Fear &amp; Greed Index, via <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener noreferrer">Alternative.me</a></div>
            )}
          </>
        ) : (
          <div className="mm-panel wm-boot">{m.failed && !m.loaded ? "Couldn't read the market just now. It will try again in a minute." : "Reading the market…"}</div>
        )}

        {/* ---- the record ---- */}
        <section className="wm-sec">
          <h2>The scoreboard</h2>
          {!live ? (
            <div className="wm-note">Loading the record…</div>
          ) : total === 0 ? (
            <div className="wm-note">No finished trades yet. The first one will show here the moment it closes, win or lose.</div>
          ) : (
            <>
              <div className="wm-tiles">
                <div className="wm-tile"><div className="wm-big up">{live.wins}</div><div className="wm-lab">{live.wins === 1 ? "win" : "wins"}</div></div>
                <div className="wm-tile"><div className="wm-big down">{live.losses}</div><div className="wm-lab">{live.losses === 1 ? "loss" : "losses"}</div></div>
                <div className="wm-tile"><div className="wm-big">{live.avgR != null ? fmtR(live.avgR) : "—"}</div><div className="wm-lab">per trade</div></div>
              </div>
              <div className="wm-note">
                {total < 30 ? `${total === 1 ? "One finished trade is" : `${total} finished trades are`} too early to call anything. We're showing ${total === 1 ? "it" : "them"} anyway. ` : ""}
                R is the amount risked on a trade. For example, +1.00R means a trade made as much as it risked.
              </div>
            </>
          )}
        </section>

        <section className="wm-sec">
          <h2>{signals.length === 1 ? "One signal" : `${wordFor(signals.length)} signals`}, all on the clock</h2>
          {signals.map((x) => {
            const brand = brandName(x.name);
            const rec = live?.signals?.find((s) => s.name === brand) || null;
            const ready = readyByName[brand];
            const n = rec ? rec.wins + rec.losses : 0;
            return (
              <div className="wm-card" key={x.name}>
                <div className="wm-row">
                  <span className="wm-sname">{brand} <span className="wm-tf">{(x.tfs || []).join(", ")}</span></span>
                  {ready && <span className={`wm-pill ${ready.tone}`}>{ready.badge}</span>}
                </div>
                {x.blurb && <div className="wm-blurb">{x.blurb}</div>}
                {n > 0 ? (
                  <div className="wm-rec">
                    <span><b className="up">{rec.wins}</b> won</span>
                    <span><b className="down">{rec.losses}</b> lost</span>
                    {rec.avgR != null && <span className="mono">{fmtR(rec.avgR)} avg</span>}
                  </div>
                ) : (
                  <div className="wm-blurb">No finished trades yet.</div>
                )}
              </div>
            );
          })}
          {signedIn && <a className="wm-link" href="/">How close is each one to an alert? See the Guide in your dashboard →</a>}
        </section>

        <section className="wm-sec">
          <h2>Finished trades, newest first</h2>
          {!live ? (
            <div className="wm-note">Loading the record…</div>
          ) : live.recent.length === 0 ? (
            <div className="wm-note">None yet.</div>
          ) : (
            <>
              {live.recent.slice(0, 20).map((r, i) => (
                <div className="wm-card" key={`${r.firedAt}-${i}`}>
                  <div className="wm-row wrap">
                    <b className="wm-coin">{r.coin}</b>
                    <span className="wm-tname">{r.dir === "bull" ? "Buy" : "Sell"} {r.name}</span>
                    <span className="wm-tf">{r.tf}</span>
                    <span className={`wm-badge ${r.outcome}`}>{r.outcome === "win" ? "WIN" : "LOSS"}</span>
                  </div>
                  <div className="wm-result mono">
                    <span className={r.outcome === "win" ? "up" : "down"}>{fmtMove(r.pctMove)}</span>
                    {r.r != null && <span className="wm-r">({fmtR(r.r)})</span>}
                    <span className="wm-date">{dayOf(r.resolvedAt)}</span>
                  </div>
                  <div className="wm-detail">
                    <div className={`wm-prices mono ${locked ? "blur" : ""}`} aria-hidden={locked || undefined}>
                      <span>${fmtPrice(r.entry)}</span><span>→</span><span>${fmtPrice(r.exit)}</span>
                      {!locked && <span className="wm-times">{whenOf(r.firedAt)} → {whenOf(r.resolvedAt)}</span>}
                    </div>
                    {locked && <button type="button" className="wm-lockbtn" onClick={toUnlock}><LockIcon size={13} /> Free account</button>}
                  </div>
                </div>
              ))}
              <div className="wm-note">
                {live.recent.length > 20 ? "Showing the latest 20. " : ""}
                {locked
                  ? "The result of every trade is public. A free account shows the exact entry, exit and times in full, so you can lay each one over your own chart."
                  : "The result, entry, exit and times of each trade, so you can lay each one over your own chart."}
              </div>
            </>
          )}
        </section>

        {settled && locked ? (
          <section className="wm-unlock" id="unlock">
            <h2>Unlock the Meter. Free.</h2>
            <ul>
              <li><Tick />Mood and heavy volume, in full</li>
              <li><Tick />All four price-vs-averages charts</li>
              <li><Tick />Entry, exit and times on every trade, to check against your own chart</li>
            </ul>
            <a className="wm-cta" href="/?signup=watch">Create a free account</a>
            <a className="wm-alt" href="/">Already have an account? Sign in →</a>
            <div className="wm-fine">No card. Want live alerts on your own coins? Upgrade any time from the same account.</div>
          </section>
        ) : null}

        <div className="wm-foot">Updates every minute. Context, not financial advice. Setpoint does not execute trades.</div>
      </div>
    </div>
  );
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
const wordFor = (n) => WORDS[n] || String(n);

function Tick() {
  return (
    <svg aria-hidden="true" className="wm-tick" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
  );
}

const FONT_CSS = "@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');";

const PAGE_CSS = `
html,body{margin:0;background:#0A0F0D}
.wm-page{background:#0A0F0D;color:var(--text);font-family:Inter,system-ui,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
.wm-wrap{max-width:560px;margin:0 auto;padding:0 16px 48px;display:flex;flex-direction:column;gap:28px}
.wm-page h1,.wm-page h2{font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;margin:0;letter-spacing:-.02em}
.wm-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:16px}
.wm-brand{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--text)}
.wm-logo{width:22px;height:22px;border-radius:6px;background:var(--green);flex:none}
.wm-word{font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;font-size:17px;letter-spacing:.02em}
.wm-word b{color:var(--green);font-weight:800}
.wm-ghost{min-height:44px;padding:0 14px;display:flex;align-items:center;border:1px solid var(--border);border-radius:10px;font-size:14px;font-weight:500;color:var(--text);text-decoration:none}
.wm-ghost:hover{background:var(--panel2)}
.wm-hero{display:flex;flex-direction:column;gap:14px}
.wm-eyebrow{font-size:12px;letter-spacing:.14em;color:var(--green-soft);display:flex;align-items:center;gap:8px}
.wm-dot{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block}
.wm-hero h1{font-size:42px;line-height:1.04}
.wm-hero h1 span{color:var(--green)}
.wm-hero p{margin:0;font-size:16px;line-height:1.5;color:var(--muted)}
.wm-cta{min-height:48px;display:flex;align-items:center;justify-content:center;background:var(--green);color:#04130C;border-radius:12px;font-weight:600;font-size:16px;text-decoration:none}
.wm-cta:hover{background:#2BE595}
.wm-fine{font-size:13px;line-height:1.45;color:var(--muted)}
.wm-live{display:flex;align-items:center;gap:6px;color:var(--green-soft)}
.wm-live .wm-dot{width:6px;height:6px}
.wm-page .mm-panel{margin-bottom:0}
.wm-page .w200-panel{margin-bottom:0}
.wm-boot{color:var(--muted);font-size:14px}
.wm-credit{font-size:12px;color:var(--dim);margin-top:-16px}
.wm-credit a{color:var(--muted)}
.wm-sec{display:flex;flex-direction:column;gap:12px}
.wm-sec h2{font-size:24px}
.wm-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.wm-tile{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px;min-width:0}
.wm-big{font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;font-size:28px;line-height:1.1;white-space:nowrap}
.up{color:var(--green)}
.down{color:var(--red)}
.wm-lab{font-size:13px;color:var(--muted);margin-top:2px}
.wm-note{font-size:14px;line-height:1.5;color:var(--muted)}
.wm-card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px}
.wm-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.wm-row.wrap{flex-wrap:wrap;justify-content:flex-start;gap:8px}
.wm-sname{font-weight:600;font-size:17px}
.wm-tf{color:var(--muted);font-weight:400;font-size:13px}
.wm-pill{font-size:12px;padding:4px 10px;border-radius:999px;background:var(--panel2);color:var(--muted);white-space:nowrap}
.wm-pill.wait{background:var(--amber-dim);color:var(--amber)}
.wm-pill.go{background:var(--green-dim);color:var(--green-soft)}
.wm-blurb{font-size:14px;line-height:1.45;color:var(--muted)}
.wm-rec{display:flex;gap:14px;flex-wrap:wrap;font-size:14px}
.wm-link{font-size:14px;color:var(--green-soft);min-height:44px;display:flex;align-items:center;text-decoration:none}
.wm-coin{font-size:16px}
.wm-tname{font-size:14px}
.wm-badge{margin-left:auto;font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px}
.wm-badge.win{background:var(--green-dim);color:var(--green-soft)}
.wm-badge.loss{background:var(--red-dim);color:var(--red-soft)}
.wm-result{display:flex;align-items:baseline;gap:10px;font-size:15px}
.wm-result .up{color:var(--green-soft)}
.wm-result .down{color:var(--red-soft)}
.wm-r{color:var(--muted)}
.wm-date{margin-left:auto;font-family:Inter,system-ui,sans-serif;font-size:13px;color:var(--muted)}
.wm-detail{position:relative;display:flex;gap:10px;align-items:center;border-top:1px solid var(--border);padding-top:12px;min-height:44px}
.wm-prices{display:flex;gap:14px;flex-wrap:wrap;font-size:15px;color:var(--text)}
.wm-prices.blur{filter:blur(6px);user-select:none;pointer-events:none}
.wm-times{flex-basis:100%;font-family:Inter,system-ui,sans-serif;font-size:12.5px;color:var(--muted)}
.wm-lockbtn{margin-left:auto;display:flex;align-items:center;gap:6px;min-height:44px;padding:0 4px;background:none;border:0;color:var(--text);font:inherit;font-size:13px;cursor:pointer}
.wm-unlock{background:var(--panel);border:1px solid var(--green);border-radius:18px;padding:22px 18px;display:flex;flex-direction:column;gap:16px;scroll-margin-top:16px}
.wm-unlock h2{font-size:28px;line-height:1.1}
.wm-unlock ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px;font-size:15px;line-height:1.4}
.wm-unlock li{display:flex;gap:10px}
.wm-tick{flex:none;margin-top:1px}
.wm-alt{font-size:14px;color:var(--muted);text-decoration:none;text-align:center;min-height:44px;display:flex;align-items:center;justify-content:center}
.wm-foot{font-size:13px;line-height:1.5;color:var(--muted);text-align:center}
@media(max-width:380px){.wm-hero h1{font-size:36px}.wm-big{font-size:24px}}
`;
