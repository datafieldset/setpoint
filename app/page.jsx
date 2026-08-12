"use client";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { COIN_PRESETS, NAME, MAX_COINS } from "../lib/coins.js";
import { TF } from "../lib/timeframes.js";
import { computeSignals, DEFAULT_TH, volatilityMeter, SIGNAL_RATES } from "../lib/signals.js";

/* =========================================================================
   SETPOINT — crypto market terminal
   Live price signals + entry/exit ladders.
   Data: Coinbase (no key). Not financial advice.
   ========================================================================= */


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

function SignalCard({ s, sym, price, firedAt, now, demo, read, loading, onAssess, isOpenPosition }) {
  return (
    <div className={`sig-card ${s.dir} ${s.isConfluence ? "confluence" : ""}`}>
      <div className="sig-top">
        <div className="sig-id">
          <span className="sym">{sym}</span>
          <span className="sig-type">{s.label}</span>
          {s.isConfluence && <span className="confluence-tag">⚡ extreme read</span>}
          {isOpenPosition && <span className="open-pos-tag">still in motion</span>}
          {s.volTag && <span className={`vol-tag ${s.volTag}`}>{s.volTag === "confirmed" ? "vol confirmed" : s.volTag === "rising" ? "vol rising" : "light volume"}</span>}
          {s.trendTag && <span className={`trend-tag ${s.trendTag}`}>{s.trendTag === "with" ? "with trend" : "against trend"}</span>}
          {s.biasTag && <span className={`bias-tag ${s.biasTag}`}>{s.biasTag === "with" ? "with market" : "against market"}</span>}
          {s.tier && <span className={`tier-tag ${s.tier}`}>{s.tier === "proven" ? `verified ${Math.round((s.tierRate || 0) * 100)}%` : `tested ${Math.round((s.tierRate || 0) * 100)}%`}</span>}
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
        <span className="fired">{demo ? "triggered 3m ago" : isOpenPosition ? "fired " + timeAgo(firedAt, now) + " · still open" : "triggered " + timeAgo(firedAt, now)}</span>
      </div>
      {!demo && !isOpenPosition && (
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
function Landing({ onPickPlan, onSignIn }) {
  const demoSig = { label: "Momentum", dir: "bull", strength: 0.72, note: "+2.14% in one 15m bar", entry: 61840, stop: 60960, target: 63600, rr: 2, tf: "15m" };
  const tiers = [
    { id: "watch", name: "Watch", price: "$0", per: "free", pop: false, feats: ["3 coins", "15m & 1h price alerts", "Momentum · Volume · RSI · EMA cross"], cta: "Start free" },
    { id: "trader", name: "Trader", price: "$19", per: "/mo", pop: true, feats: ["Up to 6 coins", "Everything in Watch", "Entry / stop / target on every alert", "Whale & exchange-flow signals", "Hourly digest"], cta: "Get Trader" },
    { id: "desk", name: "Pro", price: "$49", per: "/mo", pop: false, feats: ["Everything in Trader", "Whale-flow alerts with size thresholds", "Custom thresholds & webhooks", "Hourly + daily digests", "Multiple watchlists"], cta: "Get Pro" },
  ];
  return (
    <div className="landing">
      <nav className="nav">
        <div className="brand"><span className="logo-dot" />Setpoint</div>
        <div className="nav-r">
          <a className="watch-live-link" href="/watch"><span className="live-dot" />Watch it live</a>
          <button className="ghost" onClick={onSignIn}>Sign in</button>
          <button className="solid" onClick={() => onPickPlan("watch")}>Get started</button>
        </div>
      </nav>

      <div className="testing-band"><span className="tb-dot" />Signals are live. Pick a plan below to get started, no card needed on Watch.</div>

      <header className="hero">
        <div className="hero-l">
          <div className="eyebrow">SIGNALS, NOT AUTOPILOT</div>
          <h1>See the alert, the price, and where to get in, <em>all on one card.</em></h1>
          <p className="sub">Setpoint watches the coins you pick and sends you a card the moment something real happens, with the entry, stop, and target already drawn on it. You make every call. It never places a trade.</p>
          <div className="hero-cta">
            <button className="solid lg" onClick={() => onPickPlan("watch")}>Start free, no card needed</button>
            <a className="watch-live-link lg" href="/watch"><span className="live-dot" />Watch it live</a>
          </div>
          <div className="hero-tags"><span>No API keys</span><span>No execution</span><span>No overnight risk</span></div>
        </div>
        <div className="hero-r">
          <div className="float-card"><SignalCard s={demoSig} sym="BTC" price={62180} demo now={Date.now()} /></div>
        </div>
      </header>

      <section className="strip">
        <div className="strip-item"><span className="si-k">The gap</span><span className="si-v">Most tools send you a ping and leave you to work out the levels yourself. Setpoint puts the entry, stop, and target right on the alert.</span></div>
        <div className="strip-item"><span className="si-k">The bar</span><span className="si-v">Setpoint only surfaces setups that have already backtested well, not just any indicator crossing a line. Fewer alerts, on purpose.</span></div>
      </section>

      <section className="feat">
        <h2>What fires an alert</h2>
        <div className="feat-grid">
          {[["Momentum", "A real percentage move inside a 15m or 1h bar, instead of a fixed price line you set weeks ago and forgot about."],
            ["Volume spike", "Volume jumps well past its recent average, which often happens right before price makes its move."],
            ["Early pace", "Volume on the bar that is still forming already running hot for how far in we are, so you see it before the bar even closes."],
            ["Quiet accumulation", "Volume climbing while price holds flat, the kind of quiet build-up that often comes before a real move."],
            ["RSI stretch", "Overbought or oversold readings, on the timeframe you actually trade, weighed against whether volume actually backs it."],
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

      <section className="pricing" id="pricing">
        <h2>Pricing at launch</h2>
        <p className="pricing-sub">Cancel anytime. Setpoint only sends alerts. It never holds your funds or places a trade.</p>
        <div className="tiers">
          {tiers.map((t) => (
            <div className={`tier ${t.pop ? "pop" : ""}`} key={t.id}>
              {t.pop && <div className="pop-tag">Most popular</div>}
              <div className="tier-name">{t.name}</div>
              <div className="tier-price"><span className="tp-num">{t.price}</span><span className="tp-per">{t.per}</span></div>
              <ul className="tier-feats">{t.feats.map((f) => <li key={f}>{f}</li>)}</ul>
              <button className={t.pop ? "solid full" : "ghost full"} onClick={() => onPickPlan(t.id)}>{t.cta}</button>
            </div>
          ))}
        </div>
        <p className="pricing-foot">All plans include the entry, stop, and target on every alert. Upgrade or cancel any time from your dashboard.</p>
      </section>

      <footer className="foot">
        <div className="brand sm"><span className="logo-dot" />Setpoint</div>
        <div className="disc">Setpoint sends informational alerts only. It is not a broker, does not execute trades, and does not provide financial advice. Levels shown are computed reference points, not recommendations. Crypto is volatile, so do your own research.</div>
      </footer>
    </div>
  );
}

/* ================================= AUTH ================================= */
function Auth({ mode, plan, onBack }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const planName = { watch: "Watch (free)", trader: "Trader, $19/mo", desk: "Pro, $49/mo" }[plan] || "Watch (free)";

  const ERR_MSG = {
    email_taken: "That email already has an account. Try signing in instead.",
    weak_password: "Password needs to be at least 8 characters.",
    invalid_email: "That doesn't look like a valid email.",
    CredentialsSignin: "Wrong email or password.",
  };

  const go = async () => {
    setErr("");
    if (!email || !pw) { setErr("Enter an email and password."); return; }
    setBusy(true);
    try {
      if (mode !== "signin") {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: pw }),
        });
        const json = await res.json();
        if (!res.ok) { setErr(ERR_MSG[json.error] || "Could not create the account. Try again."); setBusy(false); return; }
      }
      const result = await signIn("credentials", { email, password: pw, redirect: false });
      if (result?.error) { setErr(ERR_MSG[result.error] || "Wrong email or password."); setBusy(false); return; }

      // A paid plan on signup means real Stripe checkout next, not instant
      // access. Someone signing in to an existing account, or choosing the
      // free Watch tier, just lands in the dashboard as usual.
      if (mode !== "signin" && (plan === "trader" || plan === "desk")) {
        const co = await fetch("/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const coJson = await co.json();
        if (co.ok && coJson.url) { window.location.href = coJson.url; return; }
        setErr("Account created, but checkout couldn't start. Try again from the dashboard.");
        setBusy(false);
        return;
      }
      // useSession() in the App root picks up the new session automatically.
    } catch {
      setErr("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <button className="auth-back" onClick={onBack}>← back</button>
      <div className="auth-card">
        <div className="brand"><span className="logo-dot" />Setpoint</div>
        <h3>{mode === "signin" ? "Welcome back" : "Create your account"}</h3>
        {mode !== "signin" && <div className="plan-chip">{planName}</div>}
        <label className="fld"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="you@email.com" type="email" autoComplete="email" /></label>
        <label className="fld"><span>Password</span><input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="••••••••" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} /></label>
        {mode !== "signin" && plan && plan !== "watch" && (
          <div className="pay-note">You'll go to Stripe's real checkout next to complete payment, this creates your account first, nothing is charged until you finish there.</div>
        )}
        {err && <div className="auth-err">{err}</div>}
        <button className="solid full lg" onClick={go} disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account and continue"}</button>
        <div className="auth-alt">{mode === "signin" ? "New here? Use the plans on the homepage to create an account." : "Your password is stored hashed, never in plain text."}</div>
      </div>
    </div>
  );
}

/* ================================= GUIDE =================================== */
// Plain-English descriptions per signal label, same trigger logic as the
// real note templates in lib/signals.js, just simplified. The proven list
// itself is never hardcoded, it's built live from SIGNAL_RATES below, so
// this page can never drift out of sync with what's actually proven.
const GUIDE_DESC = {
  "Volume spike": "A sudden burst of trading, way more than usual, in the direction shown.",
  "Quiet accumulation": "Trading volume is quietly climbing while the price barely moves at all. Often the calm before a real move starts.",
  "RSI oversold": "Price dropped fast enough that it's statistically stretched, and stretched moves tend to snap back.",
  "RSI overbought": "Price climbed fast enough that it's statistically stretched, and stretched moves tend to snap back.",
  "Volume building early": "Volume is already unusually heavy before the current candle has even finished forming, an early heads-up.",
  "EMA cross up": "A short-term average crossed above a longer-term one, an early signal of a shift toward an uptrend.",
  "EMA cross down": "A short-term average crossed below a longer-term one, an early signal of a shift toward a downtrend.",
  "Momentum": "Price moved a large amount in a single bar, a burst of one-sided pressure.",
};

function Guide({ onBack }) {
  const proven = Object.entries(SIGNAL_RATES)
    .map(([key, v]) => {
      const [label, tf, dir] = key.split("|");
      return { label, tf, dir, rate: v.rate };
    })
    .filter((s) => s.rate != null && s.rate >= 0.58)
    .sort((a, b) => b.rate - a.rate);

  return (
    <div className="dash">
      <button className="guide-back" onClick={onBack}>← Back to dashboard</button>

      <div className="guide-hero">
        <div className="guide-mark">S</div>
        <h1>How Setpoint Works</h1>
        <p>A plain-English guide to the three things you'll see on your dashboard: alerts, the lean meter, and the news read.</p>
      </div>

      <div className="guide-section">
        <div className="guide-eyebrow">Part 1</div>
        <h2>Alerts you can actually trust</h2>
        <p className="guide-lede">Setpoint tests every alert type against real, historical price data before it ever shows up on your screen. Only setups that have verified themselves right more often than not, at least 58 times out of 100, show up by default. Here's what's currently verified, best track record first.</p>

        {proven.length ? proven.map((s, i) => (
          <div className="guide-card" key={i}>
            <div className="guide-card-top">
              <span className="guide-card-name">{s.label}</span>
              <span className="guide-card-tier">{s.dir === "bull" ? "LONG" : "SHORT"} · {Math.round(s.rate * 100)}% · {TF[s.tf]?.label || s.tf}</span>
            </div>
            <div className="guide-card-desc">{GUIDE_DESC[s.label] || "A setup that's backtested well historically."}</div>
          </div>
        )) : (
          <div className="guide-card"><div className="guide-card-desc">Nothing's currently verified at 58% or higher. This updates automatically as the data changes.</div></div>
        )}

        <div className="guide-glossary">
          <b>The percentage is a real batting average, not a guarantee.</b> It means this exact setup has actually happened many times before, and that share of the time it played out the way the alert expected. It doesn't mean this specific alert will win, just that the odds have leaned that way historically. Anything that hasn't verified itself yet stays hidden by default, you can still see it by tapping "show anyway," it just comes with an honest, lower number attached.
        </div>
      </div>

      <div className="guide-section">
        <div className="guide-eyebrow">Part 2</div>
        <h2>The lean meter</h2>
        <p className="guide-lede">Under each coin's price, you'll see a small bar with a dot on it. This isn't an alert, it never fires or logs anything. Think of it like a mood thermometer: it's just telling you how stretched a coin's recent move looks right now.</p>

        <div className="guide-meter-row">
          <div className="guide-meter-label"><b>Near bottom</b>−40 or lower</div>
          <div className="guide-meter-track"><div className="guide-meter-dot" style={{ left: "15%" }} /></div>
        </div>
        <div className="guide-meter-row">
          <div className="guide-meter-label"><b>Neutral</b>near 0</div>
          <div className="guide-meter-track"><div className="guide-meter-dot" style={{ left: "50%" }} /></div>
        </div>
        <div className="guide-meter-row">
          <div className="guide-meter-label"><b>Near top</b>+40 or higher</div>
          <div className="guide-meter-track"><div className="guide-meter-dot" style={{ left: "85%" }} /></div>
        </div>

        <div className="guide-field"><div className="guide-field-k">Middle of the bar (0)</div><div className="guide-field-v">The coin's been quiet, moving sideways in a tight range. Nothing big happening either way yet.</div></div>
        <div className="guide-field"><div className="guide-field-k">Leaning green, toward +50</div><div className="guide-field-v">Price has been climbing, and that climb has real strength behind it, not just noise.</div></div>
        <div className="guide-field"><div className="guide-field-k">Leaning red, toward −50</div><div className="guide-field-v">Same idea, mirrored, price has been dropping with real force behind it.</div></div>
        <div className="guide-field"><div className="guide-field-k">The important part: hitting a hard edge</div><div className="guide-field-v">The dot only swings all the way to an extreme when a move was strong <i>and</i> is now visibly running out of energy. A strong move by itself isn't the signal, a strong move that's fading is.</div></div>
      </div>

      <div className="guide-section">
        <div className="guide-eyebrow">Part 3</div>
        <h2>The news read</h2>
        <p className="guide-lede">Everything else on your dashboard comes purely from price. This one piece doesn't, it's an AI reading real, current crypto headlines and giving you a plain summary of the overall mood, refreshed every few hours.</p>

        <div className="guide-news">
          <div className="guide-news-top"><span className="guide-news-stance">Bearish</span><span className="guide-news-conf">Medium confidence</span></div>
          <div className="guide-news-headline">Security fears and regulatory friction weigh on crypto</div>
          <div className="guide-news-body">Large whale transfers are moving both directions with no clear signal. Liquidations picked up. Regulatory headlines add friction.</div>
        </div>

        <div className="guide-field"><div className="guide-field-k">Stance</div><div className="guide-field-v">Bullish, bearish, or neutral. Does today's overall news story lean positive, negative, or is it too mixed to call?</div></div>
        <div className="guide-field"><div className="guide-field-k">Confidence</div><div className="guide-field-v">Low, medium, or high. How clear-cut the headlines actually are. "Bearish, medium confidence" means the news genuinely leans negative, but it's not overwhelming.</div></div>
        <div className="guide-field"><div className="guide-field-k">Reasoning</div><div className="guide-field-v">The short explanation underneath, always tied to real headlines from that day. Never invented, never guessed.</div></div>
      </div>

      <div className="guide-foot">Nothing on Setpoint tells you to buy or sell anything. Every number here is context pulled from real, historical data, meant to help you think it through yourself, not a recommendation.</div>
      <button className="guide-back" onClick={onBack}>← Back to dashboard</button>
    </div>
  );
}

/* =============================== ADMIN PANEL ============================== */
function AdminPanel({ onBack }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [confirmingEmail, setConfirmingEmail] = useState(null);
  const [deletingEmail, setDeletingEmail] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [whaleResult, setWhaleResult] = useState(null);
  const [testingWhale, setTestingWhale] = useState(false);

  const loadUsers = () => {
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("failed")))
      .then((json) => setUsers(json.users || []))
      .catch(() => setError("Couldn't load the registration list."));
  };

  useEffect(() => { loadUsers(); }, []);

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/test-email", { method: "POST" });
      const json = await res.json();
      setTestResult(json);
    } catch {
      setTestResult({ ok: false, reason: "request_failed" });
    }
    setTesting(false);
  };

  const doDelete = async (email) => {
    setDeletingEmail(email);
    try {
      const res = await fetch("/api/admin/users", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.email !== email));
      }
    } catch { /* leave the row as-is, they can try again */ }
    setDeletingEmail(null);
    setConfirmingEmail(null);
  };

  const testWhale = async () => {
    setTestingWhale(true);
    setWhaleResult(null);
    try {
      const res = await fetch("/api/admin/test-whale", { cache: "no-store" });
      const json = await res.json();
      setWhaleResult(json);
    } catch {
      setWhaleResult({ error: "request_failed" });
    }
    setTestingWhale(false);
  };

  return (
    <div className="dash">
      <button className="guide-back" onClick={onBack}>← Back to dashboard</button>

      <div className="guide-hero">
        <div className="guide-mark">S</div>
        <h1>Registrations</h1>
        <p>Everyone who's signed up, and what's actually captured today: email, plan, and signup date. Name and phone aren't collected yet, they're not asked for at signup.</p>
      </div>

      <div className="guide-section">
        <h2 style={{ fontSize: 15 }}>Test the welcome email</h2>
        <p className="guide-lede">Sends a real test email to your own address, {" "}and shows exactly what Resend says back, so a failed send doesn't have to stay a guess.</p>
        <button className="ghost sm" onClick={sendTest} disabled={testing}>{testing ? "Sending…" : "Send test email"}</button>
        {testResult && (
          <div className="guide-glossary" style={{ marginTop: 12 }}>
            {testResult.ok ? (
              <span><b>Sent successfully.</b> Check your inbox (and spam folder).</span>
            ) : (
              <span><b>Failed: {testResult.reason}.</b> {testResult.detail || (testResult.reason === "no_api_key" ? "RESEND_API_KEY isn't set." : "")}</span>
            )}
          </div>
        )}
      </div>

      <div className="guide-section">
        <h2 style={{ fontSize: 15 }}>Test the whale flow scrape</h2>
        <p className="guide-lede">Both the live dashboard's whale panel and the backtest page's whale tracking read from the same source, a scrape of Telegram's public @whale_alert_io page, no official API. That kind of scrape can silently break. This checks it directly and shows the real result.</p>
        <button className="ghost sm" onClick={testWhale} disabled={testingWhale}>{testingWhale ? "Checking…" : "Test whale scrape"}</button>
        {whaleResult && (
          <div className="guide-glossary" style={{ marginTop: 12 }}>
            {whaleResult.error ? (
              <span><b>Failed: {whaleResult.error}.</b> {whaleResult.detail}</span>
            ) : whaleResult.messageBlocksFound > 0 ? (
              <span><b>Working.</b> HTTP {whaleResult.httpStatus}, found {whaleResult.messageBlocksFound} real messages on the page.</span>
            ) : (
              <span><b>Broken: HTTP {whaleResult.httpStatus}, but 0 messages found.</b> {whaleResult.httpOk ? "The page loaded fine, but the parser found nothing in it, likely Telegram changed the page's structure." : "The request itself failed, likely blocked or rate-limited."}</span>
            )}
          </div>
        )}
      </div>

      <div className="guide-section">
        <div className="guide-card-top" style={{ marginBottom: 14 }}>
          <span className="guide-card-name">{users ? `${users.length} total` : "Loading…"}</span>
          <a className="ghost sm" href="/api/admin/users?csv=1">Download CSV</a>
        </div>

        {error && <div className="guide-card"><div className="guide-card-desc">{error}</div></div>}

        {users && users.map((u, i) => (
          <div className="guide-card" key={i}>
            <div className="guide-card-top">
              <span className="guide-card-name mono" style={{ fontSize: 13 }}>{u.email}</span>
              <span className="guide-card-tier">{u.plan}{u.isAdmin ? " · admin" : ""}</span>
            </div>
            <div className="guide-card-desc">Signed up {new Date(u.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            <div style={{ marginTop: 10 }}>
              {confirmingEmail === u.email ? (
                <span className="admin-confirm-row">
                  <span className="admin-confirm-text">Delete this account? This can't be undone.</span>
                  <button className="admin-danger-btn" onClick={() => doDelete(u.email)} disabled={deletingEmail === u.email}>{deletingEmail === u.email ? "Deleting…" : "Yes, delete"}</button>
                  <button className="ghost sm" onClick={() => setConfirmingEmail(null)}>Cancel</button>
                </span>
              ) : (
                <button className="admin-danger-link" onClick={() => setConfirmingEmail(u.email)}>Delete user</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button className="guide-back" onClick={onBack}>← Back to dashboard</button>
    </div>
  );
}

/* =============================== DASHBOARD =============================== */
// DEFAULT_TH now comes from lib/signals.js, imported above.

function Dashboard({ account, onSignOut, justUpgraded }) {
  const [showGuide, setShowGuide] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminStats, setAdminStats] = useState(null);
  const [adminUsers, setAdminUsers] = useState(null);
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
  const [bias, setBias] = useState(null);
  const [signalBias, setSignalBias] = useState(null);
  const [risk, setRisk] = useState(null);
  const [weekly200, setWeekly200] = useState(null);
  const [macroRead, setMacroRead] = useState(null);
  const [news, setNews] = useState({});         // sym -> [items]
  const [netFlow, setNetFlow] = useState(null);     // aggregate whale flow, not per-coin
  const [openPositions, setOpenPositions] = useState([]); // signals fired and still unresolved, from signal_track
  const [dashTab, setDashTab] = useState("opps"); // "opps" | "open" — which panel shows in the main column
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
      setNetFlow(json.netFlow || null);
    } catch { /* non-fatal */ }
  }, [watchlist]);

  // Open positions: signals that fired and haven't hit target or stop yet.
  // The Opportunities feed below only shows conditions that are true right
  // now, so a fired signal disappears from it the moment that condition
  // changes, even though the trade itself is still open. This keeps it
  // visible until it actually resolves, same source of truth as the
  // scoreboard.
  const loadOpenPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/open-positions?key=honolulupup", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setOpenPositions(json.positions || []);
    } catch { /* non-fatal */ }
  }, []);

  // The macro read is slow-moving on purpose, cached server-side for hours,
  // so it rides the same slow cadence as news rather than the fast 60s
  // price poll.
  const loadMacro = useCallback(async () => {
    try {
      const res = await fetch("/api/macro", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.error) setMacroRead(json);
    } catch { /* non-fatal */ }
  }, []);

  const runAssess = useCallback(async (sym, signal) => {
    const id = `${sym}:${signal.key}`;
    setAssessing((a) => ({ ...a, [id]: true }));
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coin: sym, name: NAME[sym] || sym, timeframe: TF[tfKey].label,
          snap: data[sym]?.snap, signal, news: news[sym] || [], marketBias: bias, reversalRisk: risk,
        }),
      });
      const json = await res.json();
      setAssess((a) => ({ ...a, [id]: json.error ? { error: json.error } : json.read }));
    } catch {
      setAssess((a) => ({ ...a, [id]: { error: "exception" } }));
    } finally {
      setAssessing((a) => ({ ...a, [id]: false }));
    }
  }, [data, news, tfKey, bias, risk]);

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
          snap: data[sym]?.snap, signal: null, news: news[sym] || [], mode: "chatter", marketBias: bias, reversalRisk: risk,
        }),
      });
      const json = await res.json();
      setCoinNote((a) => ({ ...a, [id]: json.error ? { error: json.error } : json.read }));
    } catch {
      setCoinNote((a) => ({ ...a, [id]: { error: "exception" } }));
    } finally {
      setCoinNoteLoading((a) => ({ ...a, [id]: false }));
    }
  }, [coinNote, coinNoteLoading, noteId, data, news, tfKey, bias, risk]);

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
    // Fire-and-forget: check open positions against real price on the same
    // always-on cycle as this refresh, not tied to how often new alerts
    // happen to fire. Doesn't block or slow this function, and doesn't
    // need its own success/failure handling here, it's allowed to just
    // quietly retry next cycle if it fails.
    fetch("/api/close-alert?key=honolulupup", { cache: "no-store" }).catch(() => {});
    try {
      const res = await fetch(`/api/market?symbols=${watchlist.join(",")}&tf=${tfKey}`, { cache: "no-store" });
      if (!res.ok) throw new Error("api " + res.status);
      const json = await res.json();
      const coins = json.coins || [];

      // Bias and reversal-risk are now computed server-side in /api/market,
      // from an independent broad-market basket, not from the watchlist.
      // See app/api/market/route.js: fetchBroadMarketBias().
      const currentBias = json.bias || null;
      const currentRisk = json.risk || null;
      setBias(currentBias);
      setRisk(currentRisk);
      setWeekly200(json.weekly200 || null);
      setSignalBias(json.signalBias || null);

      const next = {};
      let anyOk = false;
      const t = Date.now();
      coins.forEach((c) => {
        if (c.error || !c.candles || !c.candles.length) {
          next[c.sym] = { signals: [], snap: null, warming: false, error: c.error || "no data", stats: c.stats || null, meter: null };
          return;
        }
        const { signals, snap, warming } = computeSignals(c.candles, tfKey, th2, { now: t, marketBias: currentBias, reversalRisk: currentRisk, fngValue: json.fng?.value });
        const meter = volatilityMeter(c.candles);
        const tagged = signals.map((s) => {
          const key = `${c.sym}:${tfKey}:${s.type}:${s.dir}`;
          const rec = fired.current[key];
          const isNew = !rec || t - rec.lastSeen > TF[tfKey].cooldownMs;
          if (isNew) fired.current[key] = { firstFired: t, lastSeen: t };
          else fired.current[key] = { firstFired: rec.firstFired, lastSeen: t };
          if (isNew) {
            // Log to the rolling scoreboard (now part of /api/backtest, the standalone /api/scoreboard page is retired). Fire-and-forget,
            // a logging hiccup should never block the dashboard from working.
            fetch("/api/track", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ coin: c.sym, tf: tfKey, label: s.label, dir: s.dir, entry: s.entry, stop: s.stop, target: s.target, firedAt: t }),
            }).catch(() => {});
          }
          return { ...s, tf: TF[tfKey].label, firedAt: fired.current[key].firstFired, key };
        });
        next[c.sym] = { signals: tagged, snap, warming, error: null, stats: c.stats || null, meter };
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
  useEffect(() => { loadOpenPositions(); }, [loadOpenPositions]);
  useEffect(() => { const id = setInterval(loadOpenPositions, 60000); return () => clearInterval(id); }, [loadOpenPositions]);
  useEffect(() => { loadMacro(); }, [loadMacro]);
  useEffect(() => { const id = setInterval(loadNews, 300000); return () => clearInterval(id); }, [loadNews]);
  useEffect(() => { const id = setInterval(loadMacro, 300000); return () => clearInterval(id); }, [loadMacro]);
  useEffect(() => { const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const secsToRefresh = lastUpdate ? Math.max(0, 60 - Math.floor((now - lastUpdate) / 1000)) : null;

  const [showWeak, setShowWeak] = useState(false);

  const allSignals = useMemo(() => {
    const out = [];
    watchlist.forEach((sym) => (data[sym]?.signals || []).forEach((s) => {
      const meter = data[sym]?.meter;
      // Confluence: a proven signal firing at the same moment the meter
      // independently agrees this coin is genuinely stretched in that
      // direction, not just leaning, at a real extreme. Two separate reads
      // landing on the same answer is the rare moment worth flagging
      // louder, not every fire. Proven-only on purpose, an unproven signal
      // getting the same visual weight would teach trusting the flag
      // itself over the underlying data.
      const isConfluence = s.tier === "proven" && meter && (
        (s.dir === "bull" && meter.score <= 15) ||
        (s.dir === "bear" && meter.score >= 85)
      );
      out.push({ ...s, sym, price: data[sym]?.snap?.price, isConfluence });
    }));
    return out.sort((a, b) => (b.isConfluence - a.isConfluence) || (b.strength - a.strength));
  }, [data, watchlist]);

  const hiddenCount = useMemo(() => allSignals.filter((s) => s.tier !== "proven").length, [allSignals]);
  const visibleSignals = useMemo(() => (showWeak ? allSignals : allSignals.filter((s) => s.tier === "proven")), [allSignals, showWeak]);
  // Open positions still resolve correctly in the background for any coin,
  // watchlisted or not, close-alert doesn't care about the watchlist at
  // all. This just controls what's actually shown, once a coin's removed
  // from the watchlist, its open trades stop showing here too, even
  // though they're still quietly tracking to a real win or loss.
  const visibleOpenPositions = useMemo(() => openPositions.filter((p) => watchlist.includes(p.coin)), [openPositions, watchlist]);

  const saveWatchlist = useCallback((list) => {
    fetch("/api/my-watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watchlist: list }),
    }).catch(() => {}); // fire-and-forget, a failed save just means it falls back to defaults on next visit, not worth blocking the UI over
  }, []);

  const addCoin = (raw) => {
    const sym = (raw || "").trim().toUpperCase();
    if (!sym || watchlist.includes(sym) || watchlist.length >= MAX_COINS) return;
    const next = [...watchlist, sym];
    setWatchlist(next); setAddText(""); setShowAdd(false);
    saveWatchlist(next);
  };
  const removeCoin = (sym) => {
    if (watchlist.length <= 1) return;
    const next = watchlist.filter((s) => s !== sym);
    setWatchlist(next);
    saveWatchlist(next);
  };

  // Load whatever this account last saved, once, on sign-in. Falls back to
  // the BTC/SOL/XLM default already in useState above if nothing's saved
  // yet (new account, or saving previously failed).
  useEffect(() => {
    fetch("/api/my-watchlist", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.watchlist && Array.isArray(json.watchlist) && json.watchlist.length > 0) {
          setWatchlist(json.watchlist);
        }
      })
      .catch(() => {}); // no saved watchlist yet, or a fetch hiccup, either way the default stands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Eager, lightweight: just the counts, so the new-signups badge shows
  // immediately without needing to open the panel. The full list (and any
  // CSV download) only loads once the panel's actually opened.
  useEffect(() => {
    if (!account.isAdmin) return;
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if (json) setAdminStats({ total: json.total, newLast24h: json.newLast24h }); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (showGuide) {
    return (
      <div className="dash">
        <div className="topbar">
          <div className="brand"><span className="logo-dot" />Setpoint</div>
        </div>
        <Guide onBack={() => setShowGuide(false)} />
      </div>
    );
  }

  if (showAdminPanel) {
    return (
      <div className="dash">
        <div className="topbar">
          <div className="brand"><span className="logo-dot" />Setpoint</div>
        </div>
        <AdminPanel onBack={() => setShowAdminPanel(false)} />
      </div>
    );
  }

  return (
    <div className="dash">
      <div className="topbar">
        <div className="brand"><span className="logo-dot" />Setpoint</div>
        <div className="tf-toggle">
          {Object.keys(TF).map((k) => <button key={k} className={tfKey === k ? "on" : ""} onClick={() => setTfKey(k)}>{TF[k].label}</button>)}
        </div>
        <div className="top-r">
          <div className="refresh">{loading ? <span className="dot-pulse" /> : <span className="dot-ok" />}<span className="refresh-t">{secsToRefresh != null ? `refresh ${secsToRefresh}s` : "…"}</span></div>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
          <div className="acct">
            {account.isAdmin && (
              <button className="admin-badge" onClick={() => setShowAdminPanel(true)}>
                ADMIN{adminStats?.newLast24h > 0 ? ` · ${adminStats.newLast24h} new` : ""}
              </button>
            )}
            <span className="plan-badge">{{ watch: "WATCH", trader: "TRADER", desk: "PRO" }[account.plan] || "WATCH"}</span>
            <button className="ghost sm" onClick={() => setShowGuide(true)}>GUIDE</button>
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
          const meter = data[sym]?.meter;
          const up = snap && snap.pct >= 0;
          const tr = snap?.trend;
          const trendState = !tr || tr.adx < 20 ? { label: "RANGE", cls: "range" } : tr.plusDI > tr.minusDI ? { label: "UP", cls: "up" } : { label: "DOWN", cls: "down" };
          return (
            <div className={`tk ${selectedCoin === sym ? "sel" : ""}`} key={sym} onClick={() => selectCoin(sym)} role="button" tabIndex={0}>
              <div className="tk-l">
                <span className="tk-sym">{sym}</span>
                <span className="tk-name">{NAME[sym] || ""}</span>
                {snap && <span className={`tk-trend ${trendState.cls}`}>{trendState.label}</span>}
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
              {meter && (() => {
                const signed = meter.score - 50; // -50 (full bottom) to +50 (full top), 0 = neutral
                return (
                  <div className="tk-meter" title="Volatility read: not a trade signal, a continuous top/bottom lean">
                    <div className="tk-meter-track">
                      <div className="tk-meter-dot" style={{ left: `${meter.score}%`, "--dot-glow": signed < -5 ? "rgba(255,92,108,.55)" : signed > 5 ? "rgba(0,209,121,.55)" : "transparent" }} />
                    </div>
                    <div className="tk-meter-ticks">
                      <span>-50</span><span>-25</span><span>0</span><span>+25</span><span>+50</span>
                    </div>
                    <span className="tk-meter-label">{meter.label} <span className="tk-meter-value mono">{signed > 0 ? "+" : ""}{signed}</span></span>
                  </div>
                );
              })()}
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
      {justUpgraded && <div className="banner success">Payment confirmed. Your plan is now {{ trader: "Trader", desk: "Pro" }[account.plan] || account.plan}.</div>}

      <div className="dash-body">
        <div className="opps">
          <div className="dash-tabs">
            <button className={`dash-tab ${dashTab === "opps" ? "active" : ""}`} onClick={() => setDashTab("opps")}>
              Opportunities <span className="dash-tab-n">{visibleSignals.length}</span>
            </button>
            <button className={`dash-tab ${dashTab === "open" ? "active" : ""}`} onClick={() => setDashTab("open")}>
              Open positions {visibleOpenPositions.length > 0 && <span className="dash-tab-n">{visibleOpenPositions.length}</span>}
            </button>
          </div>

          {dashTab === "opps" ? (
            <>
              <div className="section-head">
                <span className="sh-sub">{visibleSignals.length} active · {watchlist.length} coins · {TF[tfKey].label}</span>
                {hiddenCount > 0 && (
                  <button className="weak-toggle" onClick={() => setShowWeak((v) => !v)}>
                    {showWeak ? `hide ${hiddenCount} not yet verified` : `${hiddenCount} not yet verified hidden, show anyway`}
                  </button>
                )}
              </div>
              {visibleSignals.length === 0 ? (
                <div className="empty">
                  <div className="empty-h">{allSignals.length > 0 ? "Nothing verified right now." : "Nothing firing right now."}</div>
                  <div className="empty-d">
                    {allSignals.length > 0
                      ? `${allSignals.length} signal${allSignals.length === 1 ? "" : "s"} fired, but none matched a setup that's backtested well twice yet. That's the point, not a bug, only verified setups show by default. Use the toggle above to see the rest.`
                      : `This is normal. Setpoint only shows setups verified by backtest, and it stays quiet until one of those exact conditions shows up on ${watchlist.join(", ")}. Currently watching on the ${TF[tfKey].label}.`}
                  </div>
                </div>
              ) : (
                <div className="cards-grid">
                  {visibleSignals.map((s) => <SignalCard key={s.sym + s.key} s={s} sym={s.sym} price={s.price} firedAt={s.firedAt} now={now} read={assess[`${s.sym}:${s.key}`]} loading={assessing[`${s.sym}:${s.key}`]} onAssess={() => runAssess(s.sym, s)} />)}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="section-head">
                <span className="sh-sub">{visibleOpenPositions.length} still in motion, not resolved yet</span>
              </div>
              {visibleOpenPositions.length === 0 ? (
                <div className="empty">
                  <div className="empty-h">Nothing open right now.</div>
                  <div className="empty-d">Fires here stay visible until they actually hit target or stop, this fills in the moment something's live. Only shows coins on your current watchlist, if you've removed one, anything still open for it keeps tracking quietly in the background, it just won't show here anymore.</div>
                </div>
              ) : (
                <div className="cards-grid">
                  {visibleOpenPositions.map((p) => (
                    <SignalCard
                      key={`open:${p.coin}:${p.tf}:${p.label}:${p.dir}:${p.firedAt}`}
                      s={{ dir: p.dir, label: p.label, note: "Fired and still open, tracking toward target or stop.", strength: 0.5, entry: p.entry, stop: p.stop, target: p.target, tf: p.tf, tier: p.tier, tierRate: p.tierRate }}
                      sym={p.coin}
                      price={data[p.coin]?.snap?.price}
                      firedAt={p.firedAt}
                      now={now}
                      isOpenPosition
                    />
                  ))}
                </div>
              )}
            </>
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

          {signalBias && (
            <div className="sb-panel">
              <div className="sb-head">
                <span className="sb-label">{signalBias.label} <span className="sb-score mono">{signalBias.score - 50 > 0 ? "+" : ""}{signalBias.score - 50}</span></span>
              </div>
              <div className="sb-track-row">
                <div className="tk-meter-track sb-track">
                  <div className="tk-meter-dot" style={{ left: `${signalBias.score}%` }} />
                </div>
              </div>
              <div className="tk-meter-ticks sb-ticks"><span>Shorts</span><span>Even</span><span>Longs</span></div>
              <div className="sb-sub">
                {signalBias.bullRate != null
                  ? `Longs: ${Math.round(signalBias.bullRate * 100)}% (${signalBias.bullN}) · Shorts: ${Math.round(signalBias.bearRate * 100)}% (${signalBias.bearN}), real win rate, last ${signalBias.bullN + signalBias.bearN} resolved trades.`
                  : `Longs: ${signalBias.bullN} resolved · Shorts: ${signalBias.bearN} resolved, needs at least 5 on each side to show a real lean.`}
              </div>
            </div>
          )}

          <div className="mc-top-row">
            {fng && (
              <div className="fng fng-compact">
                <div className="fng-val" style={{ color: fngColor(fng.value) }}>{fng.value}</div>
                <div className="fng-meta"><div className="fng-lab">{fng.label}</div><div className="fng-sub">Fear &amp; Greed Index</div></div>
              </div>
            )}
            <div className="mc-vol-block">
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
            </div>
          </div>

          {weekly200 && (() => {
            const btcPrice = data.BTC?.snap?.price;
            const distPct = btcPrice ? ((btcPrice - weekly200.sma) / weekly200.sma) * 100 : null;
            const near = distPct != null && Math.abs(distPct) <= 10;
            return (
              <div className={`w200-panel ${near ? "near" : ""}`}>
                <div className="w200-head">BTC 200-week MA</div>
                <div className="w200-row"><span className="w200-val mono">${fmtPrice(weekly200.sma)}</span>{distPct != null && <span className={`w200-dist ${distPct >= 0 ? "up" : "down"}`}>{distPct >= 0 ? "+" : ""}{distPct.toFixed(1)}% away</span>}</div>
                <div className="w200-note">Long-run structural line, weeks not minutes. Every prior Bitcoin bear market has bottomed at or near this level. Not a trading signal, background context only.</div>
              </div>
            );
          })()}

          {macroRead && macroRead.read && (
            <div className={`macro-panel ${macroRead.read.stance}`}>
              <div className="macro-head">News read <span className="macro-tag">outside the price data</span></div>
              <div className="macro-row"><span className="macro-stance">{macroRead.read.stance}</span><span className="macro-conf">{macroRead.read.confidence} confidence</span></div>
              <div className="macro-headline">{macroRead.read.headline}</div>
              <div className="macro-reason">{macroRead.read.reasoning}</div>
              {macroRead.read.catalyst && <div className="macro-catalyst">⏳ {macroRead.read.catalyst}</div>}
            </div>
          )}

          {bias && bias.dir && (() => {
            // pctUp is always "percent of the basket currently up," regardless
            // of direction. That's correct for a bullish reading, backwards for
            // a bearish one, since a falling pctUp during a real bearish move
            // means MORE coins agree with the drop, not fewer. Show agreement
            // with whichever direction is actually being displayed.
            const agreePct = bias.dir === "bull" ? bias.pctUp : (bias.pctUp != null ? 1 - bias.pctUp : null);
            return (
              <div className={`bias-panel ${bias.dir}`}>
                <div className="bias-row">
                  <span className="bias-dir">{bias.dir === "bull" ? "▲ BULLISH" : "▼ BEARISH"}</span>
                  <span className="bias-pct">{agreePct != null ? Math.round(agreePct * 100) : "—"}% of the market agrees</span>
                </div>
                {risk && risk.level !== "low" && (
                  <div className={`risk-note ${risk.level}`}>{risk.level === "high" ? "⚠ " : ""}{risk.note}</div>
                )}
              </div>
            );
          })()}

          {netFlow ? (() => {
            const total = netFlow.toExchange + netFlow.fromExchange;
            const netDir = netFlow.net > 0 ? "sell" : "buy"; // net = sellUsd - buyUsd
            const netPct = total > 0 ? Math.round((Math.abs(netFlow.net) / total) * 100) : 0;
            return (
              <div className={`netflow-panel ${netDir}`}>
                <div className="netflow-head">Large trade flow <span className="netflow-tag">{netFlow.txCount} large trades tracked</span></div>
                <div className="netflow-row">
                  <span className="netflow-dir">{netDir === "buy" ? "▲ net buying" : "▼ net selling"}</span>
                  <span className="netflow-amt mono">{fmtVol(Math.abs(netFlow.net))} ({netPct}%)</span>
                </div>
                {netFlow.recent && netFlow.recent[0]?.when && (
                  <div className="netflow-ts">Most recent: {new Date(netFlow.recent[0].when).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                )}
                <div className="netflow-note">Real, unusually large individual trades on Coinbase (BTC, $500k+), net buy vs. sell pressure from the taker side. Direct buy/sell pressure, not a proxy, more buying pushes price up, more selling pushes it down.</div>
              </div>
            );
          })() : (
            // Used to just silently disappear when there's nothing to
            // show, easy to mistake for a real bug instead of genuinely
            // having nothing large enough to report right now.
            <div className="netflow-panel sell">
              <div className="netflow-head">Large trade flow</div>
              <div className="netflow-note">No unusually large trades detected right now. This reads directly from Coinbase's own trade feed, the same source every signal on this dashboard already depends on.</div>
            </div>
          )}
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
            <div className="set-row"><label>Early volume pace</label><input type="range" min="1.5" max="4" step="0.1" value={th.paceMult} onChange={(e) => setTh({ ...th, paceMult: parseFloat(e.target.value) })} /><span className="mono">{th.paceMult.toFixed(1)}×</span></div>
            <div className="set-hint">Flags volume running hot on the bar that is still forming, before it closes.</div>
            <div className="set-row"><label>Accumulation sensitivity</label><input type="range" min="1.2" max="2.5" step="0.1" value={th.accumVolTrend} onChange={(e) => setTh({ ...th, accumVolTrend: parseFloat(e.target.value) })} /><span className="mono">{th.accumVolTrend.toFixed(1)}×</span></div>
            <div className="set-hint">Flags volume climbing while price stays flat, a possible quiet build-up before a move.</div>
            <div className="set-foot">A cooldown holds each signal for one full bar so you are not pinged twice for the same condition. Aim for an alert-to-action ratio of roughly one in three. If you act on fewer than that, tighten these.</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================= ROOT ================================= */
export default function App() {
  const { data: session, status, update } = useSession(); // "loading" | "authenticated" | "unauthenticated"
  const [view, setView] = useState("landing"); // landing | auth
  const [authMode, setAuthMode] = useState("signup");
  const [plan, setPlan] = useState(null);
  const [justUpgraded, setJustUpgraded] = useState(false);

  const isAuthed = status === "authenticated";
  const account = isAuthed ? { email: session.user.email, plan: session.user.plan, isAdmin: !!session.user.isAdmin } : null;

  // Returning from a real Stripe checkout. A JWT session doesn't re-check
  // the database on its own, that's what makes it fast, so it still shows
  // whatever plan was true when the person originally signed in, until told
  // to refresh. This is that: pull the URL flag Stripe's success_url sends
  // back, force a real session refresh so the new plan actually shows up,
  // then clean the URL so a page reload doesn't refresh it a second time.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutResult = params.get("checkout");
    if (!checkoutResult) return;
    if (checkoutResult === "success") {
      // Stripe's webhook and this redirect land at roughly the same moment,
      // not in a guaranteed order. If the webhook is a beat behind, one
      // refresh could still show the old plan. Try a few times over a few
      // seconds rather than accepting whichever one happens to land first.
      let attempts = 0;
      const tryRefresh = async () => {
        attempts++;
        const fresh = await update();
        const stillOld = !fresh?.user?.plan || fresh.user.plan === "watch";
        if (stillOld && attempts < 4) {
          setTimeout(tryRefresh, 1500);
        } else {
          setJustUpgraded(true);
          setTimeout(() => setJustUpgraded(false), 6000);
        }
      };
      tryRefresh();
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", url.toString());
  }, [update]);

  const handleSignOut = () => {
    signOut({ redirect: false });
    setView("landing");
  };

  if (status === "loading") {
    return (
      <div className="app">
        <style>{CSS}</style>
        <div className="boot-screen"><span className="logo-dot" />Setpoint</div>
      </div>
    );
  }

  return (
    <div className="app">
      <style>{CSS}</style>
      {!account && view === "landing" && (
        <Landing
          onPickPlan={(p) => { setAuthMode("signup"); setPlan(p); setView("auth"); }}
          onSignIn={() => { setAuthMode("signin"); setPlan(null); setView("auth"); }}
        />
      )}
      {!account && view === "auth" && (
        <Auth mode={authMode} plan={plan} onBack={() => setView("landing")} />
      )}
      {account && (
        <Dashboard account={account} onSignOut={handleSignOut} justUpgraded={justUpgraded} />
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
.app{min-height:100vh;background:var(--ink);color:var(--text);font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;max-width:100vw}
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
.watch-live-link{display:inline-flex;align-items:center;gap:8px;color:var(--green-soft);border:1px solid rgba(0,209,121,.35);background:rgba(0,209,121,.08);border-radius:9px;padding:9px 16px;font-size:14px;font-weight:600;text-decoration:none;transition:background .15s,border-color .15s}
.watch-live-link:hover{background:rgba(0,209,121,.16);border-color:rgba(0,209,121,.55)}
.watch-live-link.lg{padding:13px 22px;font-size:15px}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;animation:live-pulse 1.6s ease-in-out infinite}
@keyframes live-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(0,209,121,.5)}50%{opacity:.6;box-shadow:0 0 0 4px rgba(0,209,121,0)}}
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

.strip{border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);padding:22px 0;margin-bottom:12px;display:flex;flex-direction:column;gap:14px}
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
.auth-err{background:var(--red-dim);border:1px solid rgba(255,92,108,.3);color:var(--red-soft);font-size:12.5px;padding:10px 13px;border-radius:10px;margin-top:14px;line-height:1.5}
button:disabled{opacity:.6;cursor:not-allowed}
.boot-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;gap:9px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:20px;color:var(--text)}
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
.admin-badge{font-size:10.5px;font-weight:700;letter-spacing:.08em;color:var(--amber);background:var(--amber-dim);border:1px solid var(--amber);padding:4px 9px;border-radius:6px;cursor:pointer;font-family:inherit}

.ticker{display:flex;gap:10px;flex-wrap:wrap;padding:16px 0}
.tk{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:10px 14px;display:flex;flex-direction:column;gap:5px;min-width:180px;flex:1}
.tk-l{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tk-sym{font-family:'Bricolage Grotesque';font-weight:700;font-size:15px}
.tk-name{color:var(--dim);font-size:11.5px}
.tk-trend{font-size:9px;font-weight:700;letter-spacing:.05em;padding:2px 6px;border-radius:5px;margin-left:2px}
.tk-trend.up{color:var(--green);background:var(--green-dim)}
.tk-trend.down{color:var(--red);background:var(--red-dim)}
.tk-trend.range{color:var(--muted);background:var(--panel3)}
.tk-meter{display:flex;flex-direction:column;gap:2px;margin-top:2px}
.tk-meter-track{position:relative;height:6px;border-radius:4px;background:linear-gradient(90deg,var(--red) 0%,var(--muted) 50%,var(--green) 100%);opacity:.7}
.tk-meter-dot{position:absolute;top:50%;width:13px;height:13px;border-radius:50%;background:var(--text);border:2.5px solid var(--panel);transform:translate(-50%,-50%);box-shadow:0 0 0 1.5px var(--border),0 0 8px 1px var(--dot-glow,transparent)}
.tk-meter-ticks{display:flex;justify-content:space-between;font-size:8.5px;color:var(--dim);line-height:1}
.tk-meter-label{font-size:10px;color:var(--muted);white-space:nowrap;display:flex;justify-content:space-between;align-items:baseline}
.tk-meter-value{color:var(--text)}
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
.banner.success{background:var(--green-dim);border-color:rgba(0,209,121,.3);color:var(--green)}

.dash-body{display:grid;grid-template-columns:1fr 300px;gap:20px;margin-top:6px}
.section-head{display:flex;align-items:baseline;gap:12px;margin-bottom:16px}
.weak-toggle{margin-left:auto;font-size:11px;color:var(--red-soft);background:var(--red-dim);border:1px solid rgba(255,92,108,.3);padding:4px 10px;border-radius:20px;white-space:nowrap}
.dash-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:14px}
.dash-tab{background:none;border:none;padding:9px 4px;margin-right:22px;font-size:14px;font-weight:600;color:var(--dim);cursor:pointer;border-bottom:2px solid transparent}
.dash-tab.active{color:var(--text);border-bottom-color:var(--green)}
.dash-tab-n{color:var(--dim);font-weight:500;font-size:12px;margin-left:3px}
.dash-tab.active .dash-tab-n{color:var(--green-soft)}
.weak-toggle:hover{filter:brightness(1.1)}
.section-head h2{font-size:20px;font-weight:700}
.sh-sub{color:var(--dim);font-size:12.5px}
.sh-sub.sample{color:var(--amber)}

.empty{background:var(--panel);border:1px dashed var(--border);border-radius:14px;padding:44px 26px;text-align:center}
.empty-h{font-family:'Bricolage Grotesque';font-weight:600;font-size:18px;margin-bottom:8px}
.empty-d{color:var(--muted);font-size:14px;line-height:1.55;max-width:420px;margin:0 auto}

.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(288px,1fr));gap:14px}
.sig-card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-left-width:3px;border-radius:14px;padding:16px}
.sig-card.confluence{border-color:var(--amber);box-shadow:0 0 0 1px rgba(245,184,81,.35),0 0 18px rgba(245,184,81,.12)}
.confluence-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:5px;color:var(--amber);background:rgba(245,184,81,.14);border:1px solid rgba(245,184,81,.35)}
.sig-card.bull{border-left-color:var(--green)}
.sig-card.bear{border-left-color:var(--red)}
.sig-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.sig-id{display:flex;align-items:center;gap:6px;flex-wrap:wrap;row-gap:4px}
.sig-id .sym{font-family:'Bricolage Grotesque';font-weight:800;font-size:17px}
.sig-type{font-size:12.5px;color:var(--muted);font-weight:500}
.vol-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:5px}
.vol-tag.confirmed{color:var(--green);background:var(--green-dim)}
.vol-tag.rising{color:var(--green-soft);background:var(--green-dim)}
.vol-tag.light{color:var(--amber);background:var(--amber-dim)}
.trend-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:5px}
.trend-tag.with{color:var(--green);background:var(--green-dim)}
.trend-tag.against{color:var(--red);background:var(--red-dim)}
.bias-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:5px}
.bias-tag.with{color:var(--green-soft);background:var(--green-dim)}
.bias-tag.against{color:var(--red-soft);background:var(--red-dim)}
.open-pos-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:5px;color:var(--amber);background:var(--amber-dim);border:1px solid rgba(245,184,81,.35)}
.tier-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:5px}
.tier-tag.proven{color:#03110B;background:var(--green)}
.tier-tag.tested{color:var(--red-soft);background:var(--red-dim);border:1px solid rgba(255,92,108,.4)}
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
.bias-panel{padding:10px 12px;border-radius:10px;margin-bottom:12px;border:1px solid var(--border)}
.bias-panel.bull{background:var(--green-dim);border-color:rgba(0,209,121,.3)}
.bias-panel.bear{background:var(--red-dim);border-color:rgba(255,92,108,.3)}
.bias-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.bias-dir{font-family:'Bricolage Grotesque';font-weight:800;font-size:14px;letter-spacing:.02em}
.bias-panel.bull .bias-dir{color:var(--green)}
.bias-panel.bear .bias-dir{color:var(--red-soft)}
.bias-pct{font-size:11px;color:var(--muted);white-space:nowrap}
.risk-note{font-size:11px;line-height:1.5;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
.risk-note.high{color:var(--amber);font-weight:600}
.risk-note.elevated{color:var(--muted)}
.w200-panel{padding:10px 12px;border-radius:10px;margin-bottom:12px;border:1px solid var(--border);background:var(--panel)}
.w200-panel.near{border-color:rgba(245,184,81,.4);background:var(--amber-dim)}
.w200-head{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);font-weight:600;margin-bottom:6px}
.w200-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.w200-val{font-size:15px;font-weight:700}
.w200-dist{font-size:11.5px;font-weight:600}
.w200-dist.up{color:var(--muted)}
.w200-dist.down{color:var(--amber)}
.w200-note{color:var(--dim);font-size:10.5px;line-height:1.5;margin-top:7px}
.macro-panel{padding:10px 12px;border-radius:10px;margin-bottom:12px;border:1px solid var(--border)}
.macro-panel.bullish{background:var(--green-dim);border-color:rgba(0,209,121,.3)}
.macro-panel.bearish{background:var(--red-dim);border-color:rgba(255,92,108,.3)}
.macro-panel.neutral{background:var(--panel3)}
.macro-head{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.macro-tag{text-transform:none;letter-spacing:0;font-style:italic;color:var(--dim);font-weight:400}
.macro-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.macro-stance{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.macro-panel.bullish .macro-stance{color:var(--green)}
.macro-panel.bearish .macro-stance{color:var(--red-soft)}
.macro-panel.neutral .macro-stance{color:var(--muted)}
.macro-conf{font-size:10px;color:var(--dim);text-transform:uppercase}
.macro-headline{font-family:'Bricolage Grotesque';font-weight:600;font-size:13px;margin-bottom:5px}
.macro-reason{color:var(--muted);font-size:11.5px;line-height:1.5}
.macro-catalyst{color:var(--amber);font-size:11px;line-height:1.5;margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08)}
.fng{display:flex;align-items:center;gap:14px;padding:10px 0 16px;border-bottom:1px solid var(--hair);margin-bottom:12px}
.mc-top-row{display:flex;flex-direction:column;gap:6px;margin-bottom:6px}
.sb-panel{padding:10px 0 16px;border-bottom:1px solid var(--hair);margin-bottom:12px}
.sb-head{display:flex;justify-content:flex-end;align-items:baseline;margin-bottom:8px}
.sb-label{font-size:12px;font-weight:600}
.sb-score{color:var(--dim);font-weight:400;margin-left:2px}
.sb-track-row{margin-bottom:4px}
.sb-track{height:6px}
.sb-ticks{margin-top:4px;font-size:9px}
.sb-sub{color:var(--dim);font-size:10.5px;margin-top:6px;line-height:1.4}
.fng-compact{flex:0 0 auto;border-bottom:none;padding:6px 0;margin-bottom:0}
.mc-vol-block{flex:1;min-width:140px}
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
.netflow-panel{padding:10px 12px;border-radius:10px;margin-bottom:12px;border:1px solid var(--border)}
.netflow-panel.buy{background:var(--green-dim);border-color:rgba(0,209,121,.3)}
.netflow-panel.sell{background:var(--red-dim);border-color:rgba(255,92,108,.3)}
.netflow-head{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.netflow-tag{text-transform:none;letter-spacing:0;font-style:italic;font-weight:400}
.netflow-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.netflow-dir{font-size:12px;font-weight:700}
.netflow-panel.buy .netflow-dir{color:var(--green)}
.netflow-panel.sell .netflow-dir{color:var(--red-soft)}
.netflow-amt{font-size:13px;font-weight:700}
.netflow-note{color:var(--dim);font-size:10.5px;line-height:1.5;margin-top:7px}
.netflow-ts{color:var(--dim);font-size:10px;margin-top:4px;font-family:monospace}

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
@media(max-width:640px){
  .topbar{flex-wrap:wrap;gap:10px;padding:12px 0}
  .tf-toggle{order:3;width:100%;justify-content:space-between}
  .tf-toggle button{flex:1;text-align:center}
  .top-r{gap:10px}
  .plan-badge{display:none}
  .dash{padding:0 12px 40px}
  .cards-grid,.sig-grid{grid-template-columns:1fr}
  .landing,.dash{overflow-x:hidden}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

/* Guide view — reuses the same tokens as the rest of the dashboard on
   purpose, so recognizing something here means recognizing it for real. */
.guide-back{display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--green-soft);font-size:13px;font-weight:600;cursor:pointer;padding:10px 4px;margin-bottom:6px}
.guide-hero{padding:20px 4px 26px;text-align:center;border-bottom:1px solid var(--border);margin-bottom:26px}
.guide-hero h1{font-size:21px;margin:8px 0 6px;letter-spacing:-.01em}
.guide-hero p{color:var(--muted);font-size:13.5px;margin:0 auto;max-width:400px}
.guide-mark{width:36px;height:36px;border-radius:10px;background:var(--green);margin:0 auto;display:flex;align-items:center;justify-content:center;font-weight:800;color:#03110B;font-size:17px}
.guide-section{padding:0 4px 32px;margin-bottom:28px;border-bottom:1px solid var(--border)}
.guide-section:last-of-type{border-bottom:none}
.guide-eyebrow{color:var(--green-soft);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
.guide-section h2{font-size:18px;margin:0 0 8px}
.guide-lede{color:var(--muted);font-size:13.5px;margin-bottom:18px;line-height:1.5}
.guide-card{background:var(--panel2);border:1px solid var(--border);border-left:3px solid var(--green);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.guide-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px}
.guide-card-name{font-weight:700;font-size:14px}
.guide-card-tier{font-size:11px;font-weight:700;color:var(--green-soft);white-space:nowrap}
.guide-card-desc{color:var(--muted);font-size:12.5px;line-height:1.5}
.guide-glossary{background:var(--panel3);border:1px solid var(--border);border-radius:11px;padding:13px 15px;margin-top:16px;font-size:12px;color:var(--dim);line-height:1.5}
.guide-glossary b{color:var(--text)}
.guide-meter-row{display:flex;align-items:center;gap:12px;background:var(--panel2);border:1px solid var(--border);border-radius:11px;padding:12px 14px;margin-bottom:8px}
.guide-meter-label{width:104px;font-size:12px;color:var(--muted);flex-shrink:0}
.guide-meter-label b{color:var(--text);display:block;font-size:12.5px}
.guide-meter-track{position:relative;flex:1;height:6px;border-radius:4px;background:linear-gradient(90deg,var(--red) 0%,var(--dim) 50%,var(--green) 100%);opacity:.7}
.guide-meter-dot{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:var(--text);border:2px solid var(--panel2);transform:translate(-50%,-50%);box-shadow:0 0 0 1.5px var(--border)}
.guide-field{margin-top:14px}
.guide-field-k{font-size:11.5px;font-weight:700;color:var(--green-soft);margin-bottom:2px}
.guide-field-v{color:var(--muted);font-size:12.5px;line-height:1.5}
.guide-news{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.guide-news-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}
.guide-news-stance{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:6px;background:var(--red-dim);color:var(--red-soft)}
.guide-news-conf{font-size:10.5px;color:var(--dim)}
.guide-news-headline{font-weight:700;font-size:13.5px;margin-bottom:5px}
.guide-news-body{color:var(--muted);font-size:12.5px;line-height:1.5}
.guide-foot{padding:8px 4px 20px;text-align:center;color:var(--dim);font-size:11px;line-height:1.6}
.admin-danger-link{background:none;border:none;color:var(--red-soft);font-size:12px;font-weight:600;cursor:pointer;padding:0}
.admin-confirm-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.admin-confirm-text{color:var(--red-soft);font-size:12px}
.admin-danger-btn{background:var(--red-dim);border:1px solid var(--red);color:var(--red-soft);font-size:12px;font-weight:700;padding:6px 11px;border-radius:8px;cursor:pointer}
`;
