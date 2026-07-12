"use client";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* =========================================================================
   SETPOINT — crypto alert terminal (placeholder name, easy to rename)
   Alerts-only. Live price signals + entry/exit ladders. On-chain panel = sample.
   Data: CryptoCompare (no key, light use). Not financial advice.
   ========================================================================= */

const COIN_PRESETS = [
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
const NAME = Object.fromEntries(COIN_PRESETS.map((c) => [c.sym, c.name]));
const MAX_COINS = 6;

const TF = {
  "5m": { label: "5m", pctMin: 0.7, gran: 300, cooldownMs: 5 * 60 * 1000 },
  "15m": { label: "15m", pctMin: 1.2, gran: 900, cooldownMs: 15 * 60 * 1000 },
  "30m": { label: "30m", pctMin: 1.7, gran: 1800, cooldownMs: 30 * 60 * 1000 },
  "1h": { label: "1h", pctMin: 2.5, gran: 3600, cooldownMs: 60 * 60 * 1000 },
};

/* ----------------------------- indicator math ---------------------------- */
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1), out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function atr(h, l, c, period = 14) {
  if (c.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < c.length; i++) trs.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}
function levels(price, atrv, dir) {
  const risk = 1.5 * atrv;
  return dir === "bull"
    ? { entry: price, stop: price - risk, target: price + 2 * risk, rr: 2 }
    : { entry: price, stop: price + risk, target: price - 2 * risk, rr: 2 };
}

function computeSignals(candles, tfKey, th) {
  const n = candles.length;
  if (n < 30) return { signals: [], warming: true, snap: null };
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const vols = candles.map((c) => c.volumeto);
  const price = closes[n - 1];
  const pct = ((price - closes[n - 2]) / closes[n - 2]) * 100;
  const volAvg = vols.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20;
  const volRatio = volAvg > 0 ? vols[n - 1] / volAvg : 1;
  const r = rsi(closes, 14);
  const e9 = emaSeries(closes, 9), e21 = emaSeries(closes, 21);
  const a = atr(highs, lows, closes, 14) || price * 0.01;
  const last = candles[n - 1];
  const signals = [];
  const clamp = (x) => Math.max(0, Math.min(1, x));

  if (Math.abs(pct) >= th.pctMin) {
    const dir = pct > 0 ? "bull" : "bear";
    signals.push({ type: "move", label: "Momentum", dir, strength: clamp((Math.abs(pct) - th.pctMin) / th.pctMin), note: `${pct > 0 ? "+" : ""}${pct.toFixed(2)}% in one ${TF[tfKey].label} bar`, ...levels(price, a, dir) });
  }
  if (volRatio >= th.volMult) {
    const dir = last.close >= last.open ? "bull" : "bear";
    signals.push({ type: "volume", label: "Volume spike", dir, strength: clamp((volRatio - th.volMult) / th.volMult), note: `${volRatio.toFixed(1)}× the 20-bar average volume`, ...levels(price, a, dir) });
  }
  if (r != null && r <= th.rsiLow) {
    signals.push({ type: "rsi", label: "RSI oversold", dir: "bull", strength: clamp((th.rsiLow - r) / th.rsiLow), note: `RSI ${r.toFixed(0)}, oversold reading`, ...levels(price, a, "bull") });
  } else if (r != null && r >= th.rsiHigh) {
    signals.push({ type: "rsi", label: "RSI overbought", dir: "bear", strength: clamp((r - th.rsiHigh) / (100 - th.rsiHigh)), note: `RSI ${r.toFixed(0)}, overbought reading`, ...levels(price, a, "bear") });
  }
  if (e9.length && e21.length) {
    const i = n - 1;
    const dNow = (e9[i] ?? 0) - (e21[i] ?? 0), dPrev = (e9[i - 1] ?? 0) - (e21[i - 1] ?? 0);
    if (dPrev <= 0 && dNow > 0) signals.push({ type: "cross", label: "EMA cross up", dir: "bull", strength: 0.65, note: "9 EMA crossed above 21 EMA", ...levels(price, a, "bull") });
    else if (dPrev >= 0 && dNow < 0) signals.push({ type: "cross", label: "EMA cross down", dir: "bear", strength: 0.65, note: "9 EMA crossed below 21 EMA", ...levels(price, a, "bear") });
  }
  return { signals, warming: false, snap: { price, pct, rsi: r, volRatio, atr: a } };
}

// Data is fetched from the server route /api/market (see app/api/market/route.js),
// which calls Coinbase server-side. The client never talks to an exchange directly.


/* ------------------------------- formatting ------------------------------ */
const fmtPrice = (p) => {
  if (p == null || isNaN(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toLocaleString("en-US", { maximumFractionDigits: 5 });
};
const fmtPct = (x) => (x == null || isNaN(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(2) + "%");
const fmtVol = (v) => {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
  return "$" + v.toFixed(0);
};
const fngColor = (v) => (v >= 75 ? "#00D179" : v >= 55 ? "#5EE9AE" : v >= 45 ? "#93A69D" : v >= 25 ? "#F5B851" : "#FF5C6C");

// Notable = posts from watched sources (Watcher Guru, Whale Alert, curated accounts).
// The coin note is cached against this, so it only regenerates when something notable breaks.
function newsFingerprint(items) {
  const notable = (items || []).filter((n) => n.watched).slice(0, 5).map((n) => (n.title || "").slice(0, 50));
  return notable.join("|") || "none";
}
const timeAgo = (ts, now) => {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  return Math.floor(m / 60) + "h ago";
};

/* ================================ UI atoms =============================== */
function DirBadge({ dir }) {
  const map = { bull: ["LONG", "up"], bear: ["SHORT", "down"], warn: ["WATCH", "warn"] };
  const [t, cls] = map[dir] || map.warn;
  return <span className={`badge ${cls}`}>{t}</span>;
}

function Ladder({ entry, stop, target, price, dir }) {
  const vals = [entry, stop, target, price];
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.14 || Math.abs(max) * 0.01 || 1;
  const lo = min - pad, hi = max + pad;
  const y = (p) => (1 - (p - lo) / (hi - lo)) * 100;
  const toTarget = ((target - price) / price) * 100;
  const toStop = ((stop - price) / price) * 100;
  return (
    <div className="ladder">
      <div className="rail">
        <div className="rail-line" />
        <div className="mk mk-target" style={{ top: y(target) + "%" }}><span className="mk-dot" /><span className="mk-lab">TARGET</span><span className="mk-val">{fmtPrice(target)}</span></div>
        <div className="mk mk-entry" style={{ top: y(entry) + "%" }}><span className="mk-dot" /><span className="mk-lab">ENTRY</span><span className="mk-val">{fmtPrice(entry)}</span></div>
        <div className="mk mk-stop" style={{ top: y(stop) + "%" }}><span className="mk-dot" /><span className="mk-lab">STOP</span><span className="mk-val">{fmtPrice(stop)}</span></div>
        <div className="mk mk-live" style={{ top: y(price) + "%" }}><span className="live-tri" /></div>
      </div>
      <div className="ladder-meta">
        <div className="rr">{(2).toFixed(1)}R</div>
        <div className="rr-sub">reward : risk</div>
        <div className="tgt-row"><span className="up">{fmtPct(dir === "bull" ? Math.abs(toTarget) : -Math.abs(toTarget))}</span><span className="lab">to target</span></div>
        <div className="tgt-row"><span className="down">{fmtPct(dir === "bull" ? -Math.abs(toStop) : Math.abs(toStop))}</span><span className="lab">to stop</span></div>
      </div>
    </div>
  );
}

function SignalCard({ s, sym, price, firedAt, now, demo, read, loading, onAssess }) {
  return (
    <div className={`sig-card ${s.dir}`}>
      <div className="sig-top">
        <div className="sig-id">
          <span className="sym">{sym}</span>
          <span className="sig-type">{s.label}</span>
        </div>
        <DirBadge dir={s.dir} />
      </div>
      <div className="sig-note">{s.note}</div>
      <div className="sig-price-row">
        <div><div className="k">Price</div><div className="v mono">{fmtPrice(price)}</div></div>
        <div className="strength"><div className="strength-bar"><span style={{ width: Math.round(s.strength * 100) + "%" }} /></div><div className="k">strength</div></div>
      </div>
      <Ladder entry={s.entry} stop={s.stop} target={s.target} price={price} dir={s.dir} />
      <div className="sig-foot">
        <span className="tf-pill">{s.tf}</span>
        <span className="fired">{demo ? "triggered 3m ago" : "triggered " + timeAgo(firedAt, now)}</span>
      </div>
      {!demo && (
        <div className="ai-take">
          {read && read.error ? (
            <div className="ai-err">{read.error === "no_key" ? "Add ANTHROPIC_API_KEY in Vercel to enable AI reads." : "AI read unavailable right now."}</div>
          ) : read ? (
            <div className={`ai-read ${read.stance || "neutral"}`}>
              <div className="ai-head"><span className="ai-stance">{read.stance}</span><span className="ai-conf">{read.confidence} confidence</span></div>
              <div className="ai-headline">{read.headline}</div>
              <div className="ai-reason">{read.reasoning}</div>
              {read.caution ? <div className="ai-caution">{read.caution}</div> : null}
            </div>
          ) : loading ? (
            <div className="ai-loading"><span className="dot-pulse" /> Reading the setup and headlines…</div>
          ) : (
            <button className="ai-btn" onClick={onAssess}>AI take on this signal</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================== LANDING PAGE ============================= */
function Landing({ onPickPlan, onDemo }) {
  const onWaitlist = () => { const el = document.getElementById("waitlist"); if (el) el.scrollIntoView({ behavior: "smooth" }); };
  const demoSig = { label: "Momentum", dir: "bull", strength: 0.72, note: "+2.14% in one 15m bar", entry: 61840, stop: 60960, target: 63600, rr: 2, tf: "15m" };
  const tiers = [
    { id: "watch", name: "Watch", price: "$0", per: "free", pop: false, feats: ["3 coins", "15m & 1h price alerts", "Momentum · Volume · RSI · EMA cross", "Email delivery"], cta: "Start free" },
    { id: "trader", name: "Trader", price: "$19", per: "/mo", pop: true, feats: ["Up to 6 coins", "Everything in Watch", "Entry / stop / target on every alert", "Whale & exchange-flow signals", "Telegram + Discord + email", "Hourly digest"], cta: "Get Trader" },
    { id: "desk", name: "Desk", price: "$49", per: "/mo", pop: false, feats: ["Everything in Trader", "Whale-flow alerts with size thresholds", "Custom thresholds & webhooks", "Hourly + daily digests", "Multiple watchlists"], cta: "Get Desk" },
  ];
  return (
    <div className="landing">
      <nav className="nav">
        <div className="brand"><span className="logo-dot" />Setpoint<span className="brand-tag">ALERTS</span></div>
        <div className="nav-r">
          <button className="ghost" onClick={onDemo}>Live demo</button>
          <button className="solid" onClick={onWaitlist}>Early access</button>
        </div>
      </nav>

      <div className="testing-band"><span className="tb-dot" />Private testing. Setpoint is not live yet. Join the early access list to get notified at launch.</div>

      <header className="hero">
        <div className="hero-l">
          <div className="eyebrow">ALERTS, NOT AUTOPILOT</div>
          <h1>See the alert, the price, and where to get in, <em>all on one card.</em></h1>
          <p className="sub">Setpoint watches the coins you pick and sends you a card the moment something real happens, with the entry, stop, and target already drawn on it. You make every call. It never places a trade.</p>
          <div className="hero-cta">
            <button className="solid lg" onClick={onWaitlist}>Join early access</button>
            <button className="ghost lg" onClick={onDemo}>See the live demo</button>
          </div>
          <div className="hero-tags"><span>No API keys</span><span>No execution</span><span>No overnight risk</span></div>
        </div>
        <div className="hero-r">
          <div className="float-card"><SignalCard s={demoSig} sym="BTC" price={62180} demo now={Date.now()} /></div>
        </div>
      </header>

      <section className="strip">
        <div className="strip-item"><span className="si-k">The gap</span><span className="si-v">Most tools send you a ping and leave you to work out the levels yourself. Setpoint puts the entry, stop, and target right on the alert.</span></div>
      </section>

      <section className="feat">
        <h2>What fires an alert</h2>
        <div className="feat-grid">
          {[["Momentum", "A real percentage move inside a 15m or 1h bar, instead of a fixed price line you set weeks ago and forgot about."],
            ["Volume spike", "Volume jumps well past its recent average, which often happens right before price makes its move."],
            ["RSI stretch", "Overbought or oversold readings, on the timeframe you actually trade."],
            ["EMA cross", "The 9 EMA crosses the 21 EMA. A slower signal that flags a possible trend change and fires rarely."],
            ["Whale flow", "Large transfers moving to and from exchanges on your watchlist, the kind of on-chain activity a price chart never shows you."],
            ["AI read", "An LLM weighs the signal against live headlines and tells you fade or breakout, not just a ping."]].map(([t, d]) => (
            <div className="feat-item" key={t}><div className="feat-h">{t}</div><div className="feat-d">{d}</div></div>
          ))}
        </div>
      </section>

      <section className="how">
        <h2>How it works</h2>
        <div className="how-grid">
          <div className="how-step"><div className="how-n">01</div><div className="how-h">Pick your coins</div><div className="how-d">Start with three. Swap or add more whenever you want.</div></div>
          <div className="how-step"><div className="how-n">02</div><div className="how-h">Setpoint watches</div><div className="how-d">It runs in the background with cooldowns that keep it from spamming you, so you won't want to mute it by day two.</div></div>
          <div className="how-step"><div className="how-n">03</div><div className="how-h">You get the card</div><div className="how-d">Each alert arrives with the trigger, the current price, and the levels. You make the call.</div></div>
        </div>
      </section>

      <section className="pricing">
        <h2>Pricing at launch</h2>
        <p className="pricing-sub">This is where plans will land when Setpoint opens. Cancel anytime. Setpoint only sends alerts. It never holds your funds or places a trade.</p>
        <div className="tiers">
          {tiers.map((t) => (
            <div className={`tier ${t.pop ? "pop" : ""}`} key={t.id}>
              {t.pop && <div className="pop-tag">Most popular</div>}
              <div className="tier-name">{t.name}</div>
              <div className="tier-price"><span className="tp-num">{t.price}</span><span className="tp-per">{t.per}</span></div>
              <ul className="tier-feats">{t.feats.map((f) => <li key={f}>{f}</li>)}</ul>
              <button className={t.pop ? "solid full" : "ghost full"} onClick={onWaitlist}>Join early access</button>
            </div>
          ))}
        </div>
        <p className="pricing-foot">Early access members get first access and locked-in launch pricing. You can also <button className="linkish" onClick={onDemo}>try the live demo</button> right now.</p>
      </section>

      <section className="waitlist" id="waitlist">
        <Waitlist />
      </section>

      <footer className="foot">
        <div className="brand sm"><span className="logo-dot" />Setpoint<span className="brand-tag">ALERTS</span></div>
        <div className="disc">Setpoint sends informational alerts only. It is not a broker, does not execute trades, and does not provide financial advice. Levels shown are computed reference points, not recommendations. Crypto is volatile, so do your own research.</div>
      </footer>
    </div>
  );
}

/* =============================== WAITLIST =============================== */
function Waitlist() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const submit = () => {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!ok) { setErr("Enter a valid email address."); return; }
    setErr("");
    setDone(true);
  };
  if (done) {
    return (
      <div className="wl-inner">
        <div className="wl-check">✓</div>
        <h2>You are on the list</h2>
        <p className="wl-sub">Thanks. We will email {email.trim()} the moment Setpoint opens. No spam in the meantime.</p>
      </div>
    );
  }
  return (
    <div className="wl-inner">
      <div className="eyebrow center">EARLY ACCESS</div>
      <h2>Get notified when Setpoint opens</h2>
      <p className="wl-sub">It is still in private testing. Leave your email and we will let you know the day it goes live, plus locked-in launch pricing for early members.</p>
      <div className="wl-form">
        <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@email.com" type="email" aria-label="email" />
        <button className="solid lg" onClick={submit}>Notify me</button>
      </div>
      {err && <div className="wl-err">{err}</div>}
      <div className="wl-fine">We will only use your email to tell you about the launch.</div>
    </div>
  );
}

/* ================================= AUTH ================================= */
function Auth({ mode, plan, onDone, onBack }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const planName = { watch: "Watch (free)", trader: "Trader, $19/mo", desk: "Desk, $49/mo" }[plan] || "Watch (free)";
  const go = () => onDone({ email: email || "demo@setpoint.app", plan: plan || "watch" });
  return (
    <div className="auth-wrap">
      <button className="auth-back" onClick={onBack}>← back</button>
      <div className="auth-card">
        <div className="brand"><span className="logo-dot" />Setpoint<span className="brand-tag">ALERTS</span></div>
        <h3>{mode === "signin" ? "Welcome back" : "Create your account"}</h3>
        {mode !== "signin" && <div className="plan-chip">{planName}</div>}
        <label className="fld"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="you@email.com" type="email" /></label>
        <label className="fld"><span>Password</span><input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="••••••••" type="password" /></label>
        {mode !== "signin" && plan && plan !== "watch" && (
          <div className="pay-note">This is a demo build, so no card is charged. Checkout would go here in the real version.</div>
        )}
        <button className="solid full lg" onClick={go}>{mode === "signin" ? "Sign in" : "Create account and continue"}</button>
        <div className="auth-alt">{mode === "signin" ? "New here? Just continue, this is a demo." : "By continuing you agree this is a demo environment."}</div>
      </div>
    </div>
  );
}

/* =============================== DASHBOARD =============================== */
const DEFAULT_TH = { volMult: 2.0, rsiLow: 30, rsiHigh: 70 };

function Dashboard({ account, onSignOut }) {
  const [watchlist, setWatchlist] = useState(["BTC", "SOL", "XLM"]);
  const [tfKey, setTfKey] = useState("15m");
  const [th, setTh] = useState(DEFAULT_TH);
  const [data, setData] = useState({});        // sym -> {signals, snap, warming, error}
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addText, setAddText] = useState("");
  const [globalError, setGlobalError] = useState(null);
  const [fng, setFng] = useState(null);
  const [news, setNews] = useState({});         // sym -> [items]
  const [whales, setWhales] = useState({});     // sym -> [transfers]
  const [assess, setAssess] = useState({});     // "sym:key" -> read | {error}
  const [assessing, setAssessing] = useState({});
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [coinNote, setCoinNote] = useState({}); // "sym:tf" -> read | {error}
  const [coinNoteLoading, setCoinNoteLoading] = useState({});
  const fired = useRef({}); // key -> {firstFired, lastSeen}

  const th2 = useMemo(() => ({ ...th, pctMin: TF[tfKey].pctMin }), [th, tfKey]);

  const loadNews = useCallback(async () => {
    try {
      const res = await fetch(`/api/news?symbols=${watchlist.join(",")}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setNews(json.coins || {});
      setWhales(json.whales || {});
    } catch { /* non-fatal */ }
  }, [watchlist]);

  const runAssess = useCallback(async (sym, signal) => {
    const id = `${sym}:${signal.key}`;
    setAssessing((a) => ({ ...a, [id]: true }));
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coin: sym, name: NAME[sym] || sym, timeframe: TF[tfKey].label,
          snap: data[sym]?.snap, signal, news: news[sym] || [],
        }),
      });
      const json = await res.json();
      setAssess((a) => ({ ...a, [id]: json.error ? { error: json.error } : json.read }));
    } catch {
      setAssess((a) => ({ ...a, [id]: { error: "exception" } }));
    } finally {
      setAssessing((a) => ({ ...a, [id]: false }));
    }
  }, [data, news, tfKey]);

  const noteId = useCallback((sym) => `${sym}:${tfKey}:${newsFingerprint(news[sym])}`, [tfKey, news]);

  const runCoinNote = useCallback(async (sym) => {
    const id = noteId(sym);
    if (coinNote[id] || coinNoteLoading[id]) return; // held until notable news changes
    setCoinNoteLoading((a) => ({ ...a, [id]: true }));
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coin: sym, name: NAME[sym] || sym, timeframe: TF[tfKey].label,
          snap: data[sym]?.snap, signal: null, news: news[sym] || [], mode: "chatter",
        }),
      });
      const json = await res.json();
      setCoinNote((a) => ({ ...a, [id]: json.error ? { error: json.error } : json.read }));
    } catch {
      setCoinNote((a) => ({ ...a, [id]: { error: "exception" } }));
    } finally {
      setCoinNoteLoading((a) => ({ ...a, [id]: false }));
    }
  }, [coinNote, coinNoteLoading, noteId, data, news, tfKey]);

  const runCoinNoteRef = useRef(() => {});
  runCoinNoteRef.current = runCoinNote;

  const selectCoin = useCallback((sym) => {
    setSelectedCoin((cur) => (cur === sym ? null : sym));
  }, []);

  // Regenerate the note only when the coin, timeframe, or its notable-news fingerprint changes.
  const selFp = selectedCoin ? newsFingerprint(news[selectedCoin]) : "";
  useEffect(() => {
    if (selectedCoin) runCoinNoteRef.current(selectedCoin);
  }, [selectedCoin, selFp, tfKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setGlobalError(null);
    try {
      const res = await fetch(`/api/market?symbols=${watchlist.join(",")}&tf=${tfKey}`, { cache: "no-store" });
      if (!res.ok) throw new Error("api " + res.status);
      const json = await res.json();
      const next = {};
      let anyOk = false;
      const t = Date.now();
      (json.coins || []).forEach((c) => {
        if (c.error || !c.candles || !c.candles.length) {
          next[c.sym] = { signals: [], snap: null, warming: false, error: c.error || "no data", stats: c.stats || null };
          return;
        }
        const { signals, snap, warming } = computeSignals(c.candles, tfKey, th2);
        const tagged = signals.map((s) => {
          const key = `${c.sym}:${tfKey}:${s.type}:${s.dir}`;
          const rec = fired.current[key];
          if (!rec || t - rec.lastSeen > TF[tfKey].cooldownMs) fired.current[key] = { firstFired: t, lastSeen: t };
          else fired.current[key] = { firstFired: rec.firstFired, lastSeen: t };
          return { ...s, tf: TF[tfKey].label, firedAt: fired.current[key].firstFired, key };
        });
        next[c.sym] = { signals: tagged, snap, warming, error: null, stats: c.stats || null };
        anyOk = true;
      });
      setData(next);
      setFng(json.fng || null);
      setLastUpdate(Date.now());
      if (!anyOk && watchlist.length) setGlobalError("The server returned no usable price data. Check your server logs and that these symbols exist on Coinbase.");
    } catch (e) {
      setGlobalError("Could not reach /api/market. Make sure app/api/market/route.js is in place and the dev server is running. (" + (e.message || "error") + ")");
    } finally {
      setLoading(false);
    }
  }, [watchlist, tfKey, th2]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadNews(); }, [loadNews]);
  useEffect(() => { const id = setInterval(loadNews, 300000); return () => clearInterval(id); }, [loadNews]);
  useEffect(() => { const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const secsToRefresh = lastUpdate ? Math.max(0, 60 - Math.floor((now - lastUpdate) / 1000)) : null;

  const allSignals = useMemo(() => {
    const out = [];
    watchlist.forEach((sym) => (data[sym]?.signals || []).forEach((s) => out.push({ ...s, sym, price: data[sym]?.snap?.price })));
    return out.sort((a, b) => b.strength - a.strength);
  }, [data, watchlist]);

  const addCoin = (raw) => {
    const sym = (raw || "").trim().toUpperCase();
    if (!sym || watchlist.includes(sym) || watchlist.length >= MAX_COINS) return;
    setWatchlist([...watchlist, sym]); setAddText(""); setShowAdd(false);
  };
  const removeCoin = (sym) => { if (watchlist.length > 1) setWatchlist(watchlist.filter((s) => s !== sym)); };

  return (
    <div className="dash">
      <div className="topbar">
        <div className="brand"><span className="logo-dot" />Setpoint<span className="brand-tag">ALERTS</span></div>
        <div className="tf-toggle">
          {Object.keys(TF).map((k) => <button key={k} className={tfKey === k ? "on" : ""} onClick={() => setTfKey(k)}>{TF[k].label}</button>)}
        </div>
        <div className="top-r">
          <div className="refresh">{loading ? <span className="dot-pulse" /> : <span className="dot-ok" />}<span className="refresh-t">{secsToRefresh != null ? `refresh ${secsToRefresh}s` : "…"}</span></div>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
          <div className="acct">
            <span className="plan-badge">{(account.plan || "watch").toUpperCase()}</span>
            <button className="ghost sm" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>

      {/* ticker row */}
      <div className="ticker">
        <div className={`tk-all ${!selectedCoin ? "sel" : ""}`} onClick={() => setSelectedCoin(null)} role="button" tabIndex={0} title="Show all coins">
          <span className="tk-all-icon">▦</span>
          <span className="tk-all-label">All coins</span>
        </div>
        {watchlist.map((sym) => {
          const snap = data[sym]?.snap; const err = data[sym]?.error;
          const up = snap && snap.pct >= 0;
          return (
            <div className={`tk ${selectedCoin === sym ? "sel" : ""}`} key={sym} onClick={() => selectCoin(sym)} role="button" tabIndex={0}>
              <div className="tk-l">
                <span className="tk-sym">{sym}</span>
                <span className="tk-name">{NAME[sym] || ""}</span>
              </div>
              <div className="tk-r">
                {err ? <span className="tk-err">no feed</span> : snap ? (
                  <>
                    <span className="tk-price mono">${fmtPrice(snap.price)}</span>
                    <span className={`tk-pct ${up ? "up" : "down"}`}>{fmtPct(snap.pct)}</span>
                    <span className="tk-rsi">RSI {snap.rsi != null ? snap.rsi.toFixed(0) : "—"}</span>
                  </>
                ) : <span className="tk-warm">warming…</span>}
                {watchlist.length > 1 && <button className="tk-x" onClick={(e) => { e.stopPropagation(); removeCoin(sym); }} title="remove">×</button>}
              </div>
            </div>
          );
        })}
        {watchlist.length < MAX_COINS && (
          showAdd ? (
            <div className="tk add">
              <input autoFocus value={addText} onChange={(e) => setAddText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCoin(addText)} placeholder="SYMBOL" />
              <div className="add-presets">
                {COIN_PRESETS.filter((c) => !watchlist.includes(c.sym)).slice(0, 5).map((c) => <button key={c.sym} onClick={() => addCoin(c.sym)}>{c.sym}</button>)}
              </div>
              <button className="add-go" onClick={() => addCoin(addText)}>Add</button>
            </div>
          ) : <button className="tk-add-btn" onClick={() => setShowAdd(true)}>+ add coin</button>
        )}
      </div>

      {globalError && <div className="banner">{globalError}</div>}

      <div className="dash-body">
        <div className="opps">
          <div className="section-head"><h2>Opportunities</h2><span className="sh-sub">{allSignals.length} active · {watchlist.length} coins · {TF[tfKey].label}</span></div>
          {allSignals.length === 0 ? (
            <div className="empty">
              <div className="empty-h">Nothing firing right now.</div>
              <div className="empty-d">This is normal. Setpoint stays quiet until a real move shows up on {watchlist.join(", ")}. Currently watching on the {TF[tfKey].label}.</div>
            </div>
          ) : (
            <div className="cards-grid">
              {allSignals.map((s) => <SignalCard key={s.sym + s.key} s={s} sym={s.sym} price={s.price} firedAt={s.firedAt} now={now} read={assess[`${s.sym}:${s.key}`]} loading={assessing[`${s.sym}:${s.key}`]} onAssess={() => runAssess(s.sym, s)} />)}
            </div>
          )}

          <div className="signals-panel">
            <div className="section-head">
              <h2>Early signals</h2>
              {selectedCoin
                ? <button className="sh-clear" onClick={() => setSelectedCoin(null)}>{selectedCoin} · show all ×</button>
                : <span className="sh-sub">news &amp; social</span>}
            </div>

            {selectedCoin && (() => {
              const id = noteId(selectedCoin);
              const note = coinNote[id];
              const loadingNote = coinNoteLoading[id];
              return (
                <div className="coin-note">
                  <div className="cn-head">AI note on {selectedCoin} · {TF[tfKey].label}</div>
                  {note && note.error ? (
                    <div className="ai-err">{note.error === "no_key" ? "Add ANTHROPIC_API_KEY in Vercel to enable AI notes." : "AI note unavailable right now."}</div>
                  ) : note ? (
                    <div className={`ai-read ${note.stance || "neutral"}`}>
                      <div className="ai-head"><span className="ai-stance">{note.stance}</span><span className="ai-conf">{note.confidence} confidence</span></div>
                      <div className="ai-headline">{note.headline}</div>
                      <div className="ai-reason">{note.reasoning}</div>
                      {note.caution ? <div className="ai-caution">{note.caution}</div> : null}
                    </div>
                  ) : loadingNote ? (
                    <div className="ai-loading"><span className="dot-pulse" /> Reading the chatter on {selectedCoin}…</div>
                  ) : (
                    <button className="ai-btn" onClick={() => runCoinNote(selectedCoin)}>Write AI note</button>
                  )}
                </div>
              );
            })()}

            {(() => {
              const flat = [];
              const coins = selectedCoin ? [selectedCoin] : watchlist;
              coins.forEach((sym) => (news[sym] || []).forEach((n) => flat.push({ ...n, sym })));
              flat.sort((a, b) => (b.watched ? 1 : 0) - (a.watched ? 1 : 0) || b.when - a.when);
              const top = flat.slice(0, selectedCoin ? 12 : 10);
              if (!top.length) return <div className="sig-empty">{selectedCoin ? `No recent chatter found for ${selectedCoin} yet.` : `Tap a coin above for its AI note. Scanning news, Reddit, Bluesky, and Telegram…`}</div>;
              return (
                <>
                  {!selectedCoin && <div className="sig-hint">Tap a coin above for an AI note on just that coin.</div>}
                  <div className="sig-grid">
                    {top.map((n, i) => (
                      <a className="sig-item" href={n.link} target="_blank" rel="noreferrer" key={i}>
                        <div className="sig-item-top">
                          <span className={`sig-coin ${n.watched ? "watched" : ""}`}>{n.sym}</span>
                          <span className="sig-src">{n.source}</span>
                          <span className="sig-when">{timeAgo(n.when, now)}</span>
                        </div>
                        <div className="sig-title">{n.title}</div>
                      </a>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        <aside className="onchain">
          <div className="section-head"><h2>Market context</h2><span className="sh-sub">live</span></div>
          {fng && (
            <div className="fng">
              <div className="fng-val" style={{ color: fngColor(fng.value) }}>{fng.value}</div>
              <div className="fng-meta"><div className="fng-lab">{fng.label}</div><div className="fng-sub">Fear &amp; Greed Index</div></div>
            </div>
          )}
          <div className="oc-cols"><span>24h change</span><span>24h volume</span></div>
          {watchlist.map((sym) => {
            const st = data[sym]?.stats;
            const up = st && st.change24 >= 0;
            return (
              <div className="oc-row" key={sym}>
                <div className="oc-sym">{sym}</div>
                {st ? (
                  <>
                    <div className={`oc-chg ${up ? "up" : "down"}`}>{fmtPct(st.change24)}</div>
                    <div className="oc-vol mono">{fmtVol(st.volUsd)}</div>
                  </>
                ) : <div className="oc-chg quiet">no data</div>}
              </div>
            );
          })}
          <div className="whale-panel">
            <div className="section-head"><h2>Whale flow</h2><span className="sh-sub">Whale Alert</span></div>
            {(() => {
              const coins = selectedCoin ? [selectedCoin] : watchlist;
              const flat = [];
              coins.forEach((sym) => (whales[sym] || []).forEach((w) => flat.push({ ...w, sym })));
              flat.sort((a, b) => b.when - a.when);
              const top = flat.slice(0, selectedCoin ? 8 : 6);
              if (!top.length) return <div className="sig-empty">No large transfers reported{selectedCoin ? ` for ${selectedCoin}` : ""} recently.</div>;
              return top.map((w, i) => (
                <a className="whale-row" href={w.link} target="_blank" rel="noreferrer" key={i}>
                  <span className={`whale-dir ${w.dir}`}>{w.dir === "to_exchange" ? "▲ to exchange" : w.dir === "from_exchange" ? "▼ off exchange" : "↔ transfer"}</span>
                  <span className="whale-usd mono">{w.usd ? fmtVol(w.usd) : "—"}</span>
                  <span className="whale-coin">{w.sym}</span>
                  <span className="whale-when">{timeAgo(w.when, now)}</span>
                </a>
              ));
            })()}
            <div className="whale-note">Live from Whale Alert. To exchange can mean sell pressure, off exchange can mean accumulation.</div>
          </div>
        </aside>
      </div>

      <div className="dash-disc">Informational alerts only. Setpoint does not execute trades or provide financial advice. Levels are computed reference points (1.5x ATR stop, 2R target), not recommendations.</div>

      {showSettings && (
        <div className="modal-bg" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>Alert thresholds</h3><button className="icon-btn" onClick={() => setShowSettings(false)}>×</button></div>
            <div className="set-row"><label>Min move to fire ({TF[tfKey].label} bar)</label><span className="mono">{TF[tfKey].pctMin}%</span></div>
            <div className="set-hint">Momentum threshold is tuned per timeframe.</div>
            <div className="set-row"><label>Volume spike multiple</label><input type="range" min="1.5" max="4" step="0.1" value={th.volMult} onChange={(e) => setTh({ ...th, volMult: parseFloat(e.target.value) })} /><span className="mono">{th.volMult.toFixed(1)}×</span></div>
            <div className="set-row"><label>RSI oversold</label><input type="range" min="15" max="40" step="1" value={th.rsiLow} onChange={(e) => setTh({ ...th, rsiLow: parseInt(e.target.value) })} /><span className="mono">{th.rsiLow}</span></div>
            <div className="set-row"><label>RSI overbought</label><input type="range" min="60" max="85" step="1" value={th.rsiHigh} onChange={(e) => setTh({ ...th, rsiHigh: parseInt(e.target.value) })} /><span className="mono">{th.rsiHigh}</span></div>
            <div className="set-foot">A cooldown holds each signal for one full bar so you are not pinged twice for the same condition. Aim for an alert-to-action ratio of roughly one in three. If you act on fewer than that, tighten these.</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================= ROOT ================================= */
export default function App() {
  const [view, setView] = useState("landing"); // landing | auth | dashboard
  const [authMode, setAuthMode] = useState("signup");
  const [plan, setPlan] = useState(null);
  const [account, setAccount] = useState(null);

  return (
    <div className="app">
      <style>{CSS}</style>
      {view === "landing" && (
        <Landing
          onPickPlan={(p) => { setAuthMode("signup"); setPlan(p); setView("auth"); }}
          onDemo={() => { setAccount({ email: "demo@setpoint.app", plan: "trader" }); setView("dashboard"); }}
        />
      )}
      {view === "auth" && (
        <Auth mode={authMode} plan={plan} onBack={() => setView("landing")} onDone={(acc) => { setAccount(acc); setView("dashboard"); }} />
      )}
      {view === "dashboard" && account && (
        <Dashboard account={account} onSignOut={() => { setAccount(null); setView("landing"); }} />
      )}
    </div>
  );
}

/* ================================== CSS ================================= */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
:root{
  --green:#00D179; --green-soft:#5EE9AE; --green-dim:rgba(0,209,121,.14);
  --red:#FF5C6C; --red-soft:#FF9AA3; --red-dim:rgba(255,92,108,.13);
  --amber:#F5B851; --amber-dim:rgba(245,184,81,.13);
  --ink:#080B0A; --panel:#0F1513; --panel2:#151E1A; --panel3:#1A2621;
  --border:#223029; --hair:rgba(255,255,255,.06);
  --text:#EAF2EE; --muted:#93A69D; --dim:#5E7168;
}
*{box-sizing:border-box}
.app{min-height:100vh;background:var(--ink);color:var(--text);font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.mono{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
h1,h2,h3{font-family:'Bricolage Grotesque',sans-serif;margin:0;letter-spacing:-.02em}
.brand{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:20px;letter-spacing:-.03em;display:flex;align-items:center;gap:9px}
.brand.sm{font-size:16px}
.logo-dot{width:11px;height:11px;border-radius:3px;background:var(--green);box-shadow:0 0 14px var(--green);display:inline-block}
.solid{background:var(--green);color:#03110B;font-weight:600;border-radius:9px;padding:9px 16px;font-size:14px;transition:filter .15s}
.solid:hover{filter:brightness(1.08)}
.solid.lg{padding:13px 22px;font-size:15px}
.solid.full{width:100%}
.ghost{background:transparent;color:var(--text);border:1px solid var(--border);border-radius:9px;padding:9px 16px;font-size:14px;transition:border-color .15s,background .15s}
.ghost:hover{border-color:var(--green);background:var(--green-dim)}
.ghost.lg{padding:13px 22px;font-size:15px}
.ghost.full{width:100%}
.ghost.sm{padding:6px 11px;font-size:12.5px}
:focus-visible{outline:2px solid var(--green);outline-offset:2px}

/* ---- landing ---- */
.landing{max-width:1120px;margin:0 auto;padding:0 22px}
.nav{display:flex;justify-content:space-between;align-items:center;padding:20px 0}
.nav-r{display:flex;gap:10px}
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:40px;align-items:center;padding:40px 0 56px}
.eyebrow{font-size:12px;letter-spacing:.22em;color:var(--green);font-weight:600;margin-bottom:18px}
.hero h1{font-size:52px;line-height:1.03;font-weight:800}
.hero h1 em{font-style:normal;color:var(--green)}
.sub{color:var(--muted);font-size:16.5px;line-height:1.6;margin:22px 0 26px;max-width:520px}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap}
.hero-tags{display:flex;gap:8px;margin-top:24px;flex-wrap:wrap}
.hero-tags span{font-size:12px;color:var(--dim);border:1px solid var(--hair);padding:5px 11px;border-radius:20px}
.float-card{filter:drop-shadow(0 30px 60px rgba(0,0,0,.5))}

.strip{border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);padding:22px 0;margin-bottom:12px}
.strip-item{display:flex;gap:16px;align-items:baseline}
.si-k{font-size:12px;letter-spacing:.16em;color:var(--amber);font-weight:600;text-transform:uppercase;white-space:nowrap}
.si-v{color:var(--text);font-size:17px;font-weight:500}

.feat{padding:56px 0}
.feat h2,.how h2,.pricing h2{font-size:30px;font-weight:700;margin-bottom:6px}
.feat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px}
.feat-item{background:var(--panel);border:1px solid var(--border);border-radius:13px;padding:18px}
.feat-h{font-weight:600;font-size:15px;margin-bottom:7px}
.feat-h::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:8px;vertical-align:middle}
.feat-d{color:var(--muted);font-size:13.5px;line-height:1.55}

.how{padding:24px 0 56px}
.how-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px}
.how-step{padding:20px;border:1px solid var(--border);border-radius:13px;background:linear-gradient(180deg,var(--panel2),var(--panel))}
.how-n{font-family:'JetBrains Mono',monospace;color:var(--green);font-size:13px;font-weight:600;margin-bottom:12px}
.how-h{font-weight:600;font-size:16px;margin-bottom:6px}
.how-d{color:var(--muted);font-size:13.5px;line-height:1.55}

.pricing{padding:24px 0 40px}
.pricing-sub{color:var(--muted);font-size:14.5px;margin:6px 0 28px}
.tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.tier{position:relative;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:26px 22px;display:flex;flex-direction:column}
.tier.pop{border-color:var(--green);background:linear-gradient(180deg,var(--green-dim),var(--panel))}
.pop-tag{position:absolute;top:-11px;left:22px;background:var(--green);color:#03110B;font-size:11px;font-weight:700;padding:4px 11px;border-radius:20px;letter-spacing:.03em}
.tier-name{font-family:'Bricolage Grotesque';font-weight:700;font-size:19px}
.tier-price{margin:10px 0 18px;display:flex;align-items:baseline;gap:5px}
.tp-num{font-family:'Bricolage Grotesque';font-size:38px;font-weight:800;letter-spacing:-.03em}
.tp-per{color:var(--muted);font-size:14px}
.tier-feats{list-style:none;padding:0;margin:0 0 22px;flex:1;display:flex;flex-direction:column;gap:11px}
.tier-feats li{font-size:13.5px;color:var(--text);padding-left:22px;position:relative;line-height:1.4}
.tier-feats li::before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:700}
.pricing-foot{color:var(--muted);font-size:13.5px;margin-top:20px;text-align:center}
.linkish{color:var(--green);font-weight:600;text-decoration:underline;text-underline-offset:2px;font-size:inherit}

.testing-band{display:flex;align-items:center;gap:10px;background:var(--amber-dim);border:1px solid rgba(245,184,81,.28);color:var(--amber);font-size:13px;font-weight:500;padding:11px 16px;border-radius:11px;margin-bottom:6px}
.tb-dot{width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 10px var(--amber);flex-shrink:0}
.eyebrow.center{text-align:center}

.waitlist{padding:20px 0 8px}
.wl-inner{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--green);border-radius:20px;padding:44px 32px;text-align:center;box-shadow:0 0 60px rgba(0,209,121,.08)}
.wl-inner h2{font-size:30px;font-weight:800;margin-bottom:10px}
.wl-sub{color:var(--muted);font-size:15px;line-height:1.6;max-width:520px;margin:0 auto 24px}
.wl-form{display:flex;gap:10px;max-width:460px;margin:0 auto;flex-wrap:wrap;justify-content:center}
.wl-form input{flex:1;min-width:220px;background:var(--ink);border:1px solid var(--border);border-radius:10px;padding:14px 16px;color:var(--text);font-size:15px;font-family:inherit}
.wl-form input:focus{border-color:var(--green);outline:none}
.wl-err{color:var(--red-soft);font-size:13px;margin-top:12px}
.wl-fine{color:var(--dim);font-size:12px;margin-top:16px}
.wl-check{width:52px;height:52px;border-radius:50%;background:var(--green-dim);border:1px solid var(--green);color:var(--green);font-size:24px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 18px}

.foot{border-top:1px solid var(--hair);margin-top:40px;padding:28px 0 48px;display:flex;flex-direction:column;gap:14px}
.disc{color:var(--dim);font-size:12px;line-height:1.6;max-width:760px}

/* ---- auth ---- */
.auth-wrap{max-width:440px;margin:0 auto;padding:26px 22px;min-height:100vh;display:flex;flex-direction:column;justify-content:center}
.auth-back{color:var(--muted);font-size:13px;align-self:flex-start;margin-bottom:20px}
.auth-card{background:var(--panel);border:1px solid var(--border);border-radius:18px;padding:30px}
.auth-card h3{font-size:24px;font-weight:700;margin:20px 0 6px}
.plan-chip{display:inline-block;background:var(--green-dim);color:var(--green);border:1px solid var(--green);font-size:12px;font-weight:600;padding:5px 12px;border-radius:20px;margin-bottom:8px}
.fld{display:block;margin-top:16px}
.fld span{display:block;font-size:12.5px;color:var(--muted);margin-bottom:7px}
.fld input{width:100%;background:var(--ink);border:1px solid var(--border);border-radius:10px;padding:12px 14px;color:var(--text);font-size:15px;font-family:inherit}
.fld input:focus{border-color:var(--green);outline:none}
.pay-note{background:var(--amber-dim);border:1px solid rgba(245,184,81,.3);color:var(--amber);font-size:12.5px;padding:11px 13px;border-radius:10px;margin-top:16px;line-height:1.5}
.auth-card .solid{margin-top:20px}
.auth-alt{text-align:center;color:var(--dim);font-size:12.5px;margin-top:16px}

/* ---- dashboard ---- */
.dash{max-width:1280px;margin:0 auto;padding:0 18px 40px;min-height:100vh}
.topbar{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--hair);position:sticky;top:0;background:var(--ink);z-index:20}
.tf-toggle{display:flex;background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:3px}
.tf-toggle button{padding:6px 15px;font-size:13px;font-weight:600;border-radius:6px;color:var(--muted)}
.tf-toggle button.on{background:var(--green);color:#03110B}
.top-r{margin-left:auto;display:flex;align-items:center;gap:14px}
.refresh{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12.5px}
.dot-ok{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green)}
.dot-pulse{width:8px;height:8px;border-radius:50%;background:var(--amber);animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.icon-btn{font-size:17px;color:var(--muted);width:32px;height:32px;border-radius:8px;border:1px solid var(--border)}
.icon-btn:hover{color:var(--text);border-color:var(--green)}
.acct{display:flex;align-items:center;gap:9px}
.plan-badge{font-size:10.5px;font-weight:700;letter-spacing:.08em;color:var(--green);background:var(--green-dim);border:1px solid var(--green);padding:4px 9px;border-radius:6px}

.ticker{display:flex;gap:10px;flex-wrap:wrap;padding:16px 0}
.tk{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:10px 14px;display:flex;flex-direction:column;gap:5px;min-width:180px;flex:1}
.tk-l{display:flex;align-items:baseline;gap:8px}
.tk-sym{font-family:'Bricolage Grotesque';font-weight:700;font-size:15px}
.tk-name{color:var(--dim);font-size:11.5px}
.tk-r{display:flex;align-items:center;gap:10px}
.tk-price{font-size:15px;font-weight:600}
.tk-pct{font-size:12.5px;font-weight:600}
.tk-pct.up{color:var(--green)} .tk-pct.down{color:var(--red)}
.tk-rsi{font-size:11px;color:var(--dim);margin-left:auto}
.tk-x{color:var(--dim);font-size:16px;line-height:1;padding:0 2px}
.tk-x:hover{color:var(--red)}
.tk-err,.tk-warm{font-size:12px;color:var(--dim)}
.tk-add-btn{border:1px dashed var(--border);border-radius:11px;color:var(--muted);font-size:13px;padding:10px 16px;min-width:120px}
.tk-add-btn:hover{border-color:var(--green);color:var(--green)}
.tk.add{min-width:230px;gap:8px}
.tk.add input{background:var(--ink);border:1px solid var(--border);border-radius:7px;padding:7px 10px;color:var(--text);font-size:13px;width:100%;text-transform:uppercase}
.add-presets{display:flex;gap:5px;flex-wrap:wrap}
.add-presets button{font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:4px 8px}
.add-presets button:hover{border-color:var(--green);color:var(--green)}
.add-go{background:var(--green);color:#03110B;font-weight:600;font-size:12.5px;border-radius:7px;padding:7px}

.banner{background:var(--red-dim);border:1px solid rgba(255,92,108,.3);color:var(--red-soft);font-size:13px;padding:11px 14px;border-radius:10px;margin-bottom:14px}

.dash-body{display:grid;grid-template-columns:1fr 300px;gap:20px;margin-top:6px}
.section-head{display:flex;align-items:baseline;gap:12px;margin-bottom:16px}
.section-head h2{font-size:20px;font-weight:700}
.sh-sub{color:var(--dim);font-size:12.5px}
.sh-sub.sample{color:var(--amber)}

.empty{background:var(--panel);border:1px dashed var(--border);border-radius:14px;padding:44px 26px;text-align:center}
.empty-h{font-family:'Bricolage Grotesque';font-weight:600;font-size:18px;margin-bottom:8px}
.empty-d{color:var(--muted);font-size:14px;line-height:1.55;max-width:420px;margin:0 auto}

.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(288px,1fr));gap:14px}
.sig-card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-left-width:3px;border-radius:14px;padding:16px}
.sig-card.bull{border-left-color:var(--green)}
.sig-card.bear{border-left-color:var(--red)}
.sig-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.sig-id{display:flex;align-items:baseline;gap:8px}
.sig-id .sym{font-family:'Bricolage Grotesque';font-weight:800;font-size:17px}
.sig-type{font-size:12.5px;color:var(--muted);font-weight:500}
.badge{font-size:10.5px;font-weight:700;letter-spacing:.06em;padding:4px 9px;border-radius:6px}
.badge.up{color:var(--green);background:var(--green-dim)}
.badge.down{color:var(--red);background:var(--red-dim)}
.badge.warn{color:var(--amber);background:var(--amber-dim)}
.sig-note{color:var(--text);font-size:13px;line-height:1.4;margin-bottom:14px;min-height:36px}
.sig-price-row{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px}
.k{font-size:10.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
.v{font-size:20px;font-weight:700;margin-top:2px}
.strength{width:96px;text-align:right}
.strength-bar{height:5px;background:var(--panel3);border-radius:3px;overflow:hidden;margin-bottom:5px}
.strength-bar span{display:block;height:100%;background:var(--green);border-radius:3px}
.sig-card.bear .strength-bar span{background:var(--red)}

.ladder{display:flex;gap:14px;background:var(--ink);border:1px solid var(--hair);border-radius:11px;padding:14px 12px}
.rail{position:relative;width:118px;height:132px;flex-shrink:0}
.rail-line{position:absolute;left:9px;top:0;bottom:0;width:2px;background:linear-gradient(180deg,var(--green-dim),var(--panel3),var(--red-dim))}
.mk{position:absolute;left:0;right:0;transform:translateY(-50%);display:flex;align-items:center;gap:6px}
.mk-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-left:5px;z-index:2}
.mk-target .mk-dot{background:var(--green);box-shadow:0 0 8px var(--green)}
.mk-entry .mk-dot{background:var(--muted)}
.mk-stop .mk-dot{background:var(--red);box-shadow:0 0 8px var(--red)}
.mk-lab{font-size:8.5px;letter-spacing:.08em;color:var(--dim);font-weight:600;width:38px}
.mk-target .mk-lab{color:var(--green-soft)} .mk-stop .mk-lab{color:var(--red-soft)}
.mk-val{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;margin-left:auto}
.mk-live{left:1px;right:auto}
.live-tri{width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:8px solid var(--text);filter:drop-shadow(0 0 4px rgba(255,255,255,.5))}
.ladder-meta{display:flex;flex-direction:column;justify-content:center;gap:3px;flex:1}
.rr{font-family:'Bricolage Grotesque';font-size:26px;font-weight:800;color:var(--green);letter-spacing:-.02em}
.sig-card.bear .rr{color:var(--red)}
.rr-sub{font-size:10px;color:var(--dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
.tgt-row{display:flex;align-items:baseline;gap:6px}
.tgt-row .up{color:var(--green);font-family:'JetBrains Mono';font-size:13px;font-weight:600}
.tgt-row .down{color:var(--red);font-family:'JetBrains Mono';font-size:13px;font-weight:600}
.tgt-row .lab{font-size:10.5px;color:var(--dim)}
.sig-foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
.tf-pill{font-size:10.5px;font-weight:600;color:var(--muted);border:1px solid var(--border);border-radius:5px;padding:3px 8px}
.fired{font-size:11px;color:var(--dim)}

.onchain{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;align-self:start;position:sticky;top:70px}
.fng{display:flex;align-items:center;gap:14px;padding:10px 0 16px;border-bottom:1px solid var(--hair);margin-bottom:12px}
.fng-val{font-family:'Bricolage Grotesque';font-size:40px;font-weight:800;letter-spacing:-.03em;line-height:1}
.fng-lab{font-weight:600;font-size:14px}
.fng-sub{color:var(--dim);font-size:11px;margin-top:2px}
.oc-cols{display:grid;grid-template-columns:1fr auto auto;gap:12px;font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;padding:0 0 8px}
.oc-cols span:first-child{visibility:hidden}
.oc-row{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:9px 0;border-top:1px solid var(--hair)}
.oc-sym{font-family:'Bricolage Grotesque';font-weight:700;font-size:14px}
.oc-chg{font-family:'JetBrains Mono';font-size:12.5px;font-weight:600;text-align:right;min-width:64px}
.oc-chg.up{color:var(--green)} .oc-chg.down{color:var(--red)} .oc-chg.quiet{color:var(--dim);font-family:inherit}
.oc-vol{font-size:12px;color:var(--muted);text-align:right;min-width:56px}
.oc-foot{color:var(--dim);font-size:11px;line-height:1.55;margin-top:14px;padding-top:12px;border-top:1px solid var(--hair)}

.brand-tag{color:var(--red);font-family:'JetBrains Mono',monospace;font-size:.5em;font-weight:700;letter-spacing:.14em;margin-left:6px;vertical-align:top;position:relative;top:.15em}

.ai-take{margin-top:12px;padding-top:12px;border-top:1px solid var(--hair)}
.ai-btn{width:100%;background:var(--panel3);border:1px solid var(--border);color:var(--text);font-size:12.5px;font-weight:600;padding:9px;border-radius:9px;transition:border-color .15s,background .15s}
.ai-btn:hover{border-color:var(--green);background:var(--green-dim);color:var(--green)}
.ai-btn::before{content:"✦ ";color:var(--green)}
.ai-loading{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;padding:4px 0}
.ai-err{color:var(--dim);font-size:11.5px;line-height:1.5}
.ai-read{border-radius:10px;padding:11px;background:var(--ink);border:1px solid var(--border)}
.ai-read.bullish{border-left:3px solid var(--green)}
.ai-read.bearish{border-left:3px solid var(--red)}
.ai-read.neutral{border-left:3px solid var(--muted)}
.ai-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.ai-stance{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.ai-read.bullish .ai-stance{color:var(--green)}
.ai-read.bearish .ai-stance{color:var(--red)}
.ai-read.neutral .ai-stance{color:var(--muted)}
.ai-conf{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.ai-headline{font-family:'Bricolage Grotesque';font-weight:600;font-size:13.5px;margin-bottom:6px}
.ai-reason{color:var(--muted);font-size:12px;line-height:1.55}
.ai-caution{color:var(--amber);font-size:11px;line-height:1.5;margin-top:7px;padding-top:7px;border-top:1px solid var(--hair)}

.signals-panel{margin-top:22px;padding-top:18px;border-top:1px solid var(--border)}
.signals-panel .section-head{margin-bottom:12px}
.sig-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:0 22px}
.sig-empty{color:var(--dim);font-size:11.5px;line-height:1.5}
.sig-item{display:block;padding:9px 0;border-top:1px solid var(--hair);text-decoration:none;color:inherit}
.sig-item:hover .sig-title{color:var(--green)}
.sig-item-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.sig-coin{font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--muted);background:var(--panel3);padding:2px 6px;border-radius:5px}
.sig-coin.watched{color:var(--amber);background:var(--amber-dim)}
.sig-src{font-size:10.5px;color:var(--dim)}
.sig-when{font-size:10.5px;color:var(--dim);margin-left:auto}
.sig-title{font-size:12px;line-height:1.45;color:var(--text);transition:color .15s;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tk{cursor:pointer;transition:border-color .15s,background .15s}
.tk:hover{border-color:var(--dim)}
.tk.sel{border-color:var(--green);background:var(--green-dim)}
.tk-all{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:10px 16px;cursor:pointer;transition:border-color .15s,background .15s;flex-shrink:0}
.tk-all:hover{border-color:var(--dim)}
.tk-all.sel{border-color:var(--green);background:var(--green-dim)}
.tk-all-icon{color:var(--green);font-size:15px}
.tk-all-label{font-family:'Bricolage Grotesque';font-weight:700;font-size:13px;white-space:nowrap}
.sh-clear{font-size:11.5px;color:var(--green);font-weight:600;background:var(--green-dim);border:1px solid var(--green);padding:3px 9px;border-radius:6px}
.sh-clear:hover{filter:brightness(1.1)}
.sig-hint{font-size:11px;color:var(--dim);margin-bottom:10px;font-style:italic}
.coin-note{margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--hair)}
.cn-head{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--green);font-weight:700;margin-bottom:9px}
.whale-panel{margin-top:16px;padding-top:14px;border-top:1px solid var(--hair)}
.whale-panel .section-head{margin-bottom:10px}
.whale-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--hair);text-decoration:none;color:inherit}
.whale-row:first-of-type{border-top:none}
.whale-dir{font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:5px;white-space:nowrap}
.whale-dir.to_exchange{color:var(--red);background:var(--red-dim)}
.whale-dir.from_exchange{color:var(--green);background:var(--green-dim)}
.whale-dir.other,.whale-dir.exchange_move{color:var(--muted);background:var(--panel3)}
.whale-usd{font-size:12.5px;font-weight:600}
.whale-coin{font-family:'JetBrains Mono';font-size:10px;font-weight:700;color:var(--muted);background:var(--panel3);padding:2px 6px;border-radius:5px}
.whale-when{font-size:10.5px;color:var(--dim);margin-left:auto}
.whale-note{color:var(--dim);font-size:11px;line-height:1.5;margin-top:12px;padding-top:10px;border-top:1px solid var(--hair)}

.dash-disc{color:var(--dim);font-size:11px;line-height:1.6;margin-top:28px;padding-top:16px;border-top:1px solid var(--hair)}

/* ---- modal ---- */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px}
.modal{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:440px}
.modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.modal-head h3{font-size:19px;font-weight:700}
.set-row{display:flex;align-items:center;gap:12px;margin:14px 0}
.set-row label{font-size:13px;color:var(--text);flex:1}
.set-row input[type=range]{flex:1;accent-color:var(--green)}
.set-row .mono{font-size:13px;color:var(--green);min-width:42px;text-align:right}
.set-hint{font-size:11.5px;color:var(--dim);margin:-8px 0 4px}
.set-foot{font-size:12px;color:var(--muted);line-height:1.55;margin-top:18px;padding-top:14px;border-top:1px solid var(--hair)}

@media(max-width:900px){
  .hero{grid-template-columns:1fr;gap:28px}
  .hero h1{font-size:38px}
  .feat-grid,.how-grid,.tiers{grid-template-columns:1fr}
  .dash-body{grid-template-columns:1fr}
  .onchain{position:static}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
