"use client";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { COIN_PRESETS, NAME, maxCoinsForPlan } from "../lib/coins.js";
import { TF } from "../lib/timeframes.js";
import { computeSignals, DEFAULT_TH, volatilityMeter, marketRegime, SIGNAL_RATES, PROVEN_THRESHOLD } from "../lib/signals.js";
import { brandName } from "../lib/brand.js";
import { PRICING_LIST, planLabel } from "../lib/pricing.js";
import WatchLiveContent from "./WatchLiveContent.jsx";

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

// A real, deliberately different visual from the horizontal volatility
// meter used everywhere else, this is vertical, and the center of the
// track IS the MA line itself, not a neutral midpoint of some abstract
// score. The dot moves up when price is genuinely above the line,
// down when it's genuinely below, clamped at the real, given range so
// an extreme reading doesn't run off the track.
// A real, simple line chart, no charting library, just plain SVG — two
// real lines over the last 120 real days, so the actual crossover
// moment is something you can see happen, not just infer from two
// separate numbers. Marks the real, most recent point where the lines
// actually crossed, when one exists inside this window.
// Real price history plotted as an actual line, with the MA itself
// drawn as a flat, horizontal reference across it — replaces a single,
// static gauge with something that shows how price has actually
// approached and moved away from this level over real time.
// Real, evenly-spaced date labels pulled directly from a series' own
// real timestamps, shared by both charts below rather than two separate
// copies of the same real logic. Positioned by percentage, not pixels,
// so they line up correctly regardless of how wide the chart actually
// renders.
function buildAxisLabels(series, count, withYear) {
  if (!series || series.length < 2) return [];
  const labels = [];
  const step = (series.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    const idx = Math.round(i * step);
    const d = new Date(series[idx].time);
    const text = withYear ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short" });
    labels.push({ pct: (idx / (series.length - 1)) * 100, text });
  }
  return labels;
}

function ChartAxis({ labels }) {
  if (!labels.length) return null;
  return (
    <div className="chart-axis">
      {labels.map((l, i) => (
        <span key={i} className="chart-axis-label" style={{ left: `${l.pct}%` }}>{l.text}</span>
      ))}
    </div>
  );
}

function PriceVsMaChart({ series, maValue }) {
  if (!series || series.length < 2 || maValue == null) return null;
  const W = 300, H = 110, PAD = 6;
  const closes = series.map((p) => p.close);
  const allVals = [...closes, maValue];
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const span = max - min || 1;
  const x = (i) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const priceLine = closes.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const maY = y(maValue);
  const above = closes[closes.length - 1] >= maValue;

  return (
    <div className="chart-wrap">
      <svg className="cross-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={PAD} y1={maY} x2={W - PAD} y2={maY} stroke="var(--amber)" strokeWidth="1.25" strokeDasharray="4,3" />
        <polyline points={priceLine} fill="none" stroke={above ? "var(--green-soft)" : "var(--red-soft)"} strokeWidth="1.5" />
      </svg>
      <ChartAxis labels={buildAxisLabels(series, 4, true)} />
    </div>
  );
}

function CrossoverChart({ series }) {
  if (!series || series.length < 2) return null;
  const W = 300, H = 110, PAD = 6;
  const allVals = series.flatMap((p) => [p.sma50, p.sma200]);
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const span = max - min || 1;
  const x = (i) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const line50 = series.map((p, i) => `${x(i)},${y(p.sma50)}`).join(" ");
  const line200 = series.map((p, i) => `${x(i)},${y(p.sma200)}`).join(" ");

  // Real, most recent crossover inside this window, walking backward so
  // the marker lands on the latest real cross, not the earliest.
  let crossIdx = null;
  for (let i = series.length - 1; i > 0; i--) {
    const prevDiff = series[i - 1].sma50 - series[i - 1].sma200;
    const currDiff = series[i].sma50 - series[i].sma200;
    if ((prevDiff <= 0 && currDiff > 0) || (prevDiff >= 0 && currDiff < 0)) { crossIdx = i; break; }
  }

  return (
    <div className="chart-wrap">
      <svg className="cross-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={line200} fill="none" stroke="var(--muted)" strokeWidth="1.5" />
        <polyline points={line50} fill="none" stroke="var(--green-soft)" strokeWidth="1.5" />
        {crossIdx != null && (
          <circle cx={x(crossIdx)} cy={y(series[crossIdx].sma50)} r="3.5" fill="var(--amber)" />
        )}
      </svg>
      <ChartAxis labels={buildAxisLabels(series, 4, false)} />
    </div>
  );
}

function SignalCard({ s, sym, price, firedAt, now, demo, read, loading, onAssess, isOpenPosition }) {
  return (
    <div className={`sig-card ${s.dir} ${s.isConfluence ? "confluence" : ""}`}>
      <div className="sig-top">
        <div className="sig-id">
          <span className="sym">{sym}</span>
          <span className="sig-type">{s.dir === "bull" ? "Buy" : "Sell"} {brandName(s.label)} {s.tierRate != null ? `${Math.round(s.tierRate * 100)}%` : ""}</span>
          {s.tierRate != null && (
            <span className={`rate-src ${s.tierIsLive ? "live" : "backtest"}`} title={s.tierIsLive ? "A real, current number, from recent, actual trades" : "The original backtest number, not enough recent trades yet to refresh it"}>
              {s.tierIsLive ? "live" : "backtest"}
            </span>
          )}
          {s.tierRate == null && <span className="testing-tag">testing, not yet verified</span>}
          {s.isConfluence && <span className="confluence-tag">⚡ extreme read</span>}
          {isOpenPosition && <span className="open-pos-tag">still in motion</span>}
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
      {!demo && (
        <div className="ai-take">
          {read && read.error ? (
            <div className="ai-err">{read.error === "no_key" ? "This feature isn't configured yet." : "Read unavailable right now."}</div>
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
            <button className="ai-btn" onClick={onAssess}>Details on this signal</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================== LANDING PAGE ============================= */
function Landing({ onPickPlan, onSignIn }) {
  const demoSig = { label: "Quiet accumulation", dir: "bull", strength: 0.72, tierRate: 0.80, note: "+2.14% in one 15m bar", entry: 61840, stop: 60960, target: 63600, rr: 2, tf: "15m" };
  const tiers = PRICING_LIST.map((p) => ({ ...p, pop: p.id === "trader", cta: `Get ${p.name}` }));
  useEffect(() => {
    fetch("/api/track-visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/" }) }).catch(() => {});
  }, []);
  return (
    <div className="landing">
      <nav className="nav">
        <div className="brand"><span className="logo-dot" />Setpoint</div>
        <div className="nav-r">
          <a className="watch-live-link" href="/watch"><span className="live-dot" />Watch it live</a>
          <button className="ghost" onClick={onSignIn}>Sign in</button>
          <button className="solid" onClick={() => onPickPlan("starter")}>Get started</button>
        </div>
      </nav>

      <div className="testing-band"><span className="tb-dot" />Signals are live. Every plan gets the full product, nothing held back, the only choice is how many coins.</div>

      <header className="hero">
        <div className="hero-l">
          <div className="eyebrow">SIGNALS, NOT AUTOPILOT</div>
          <h1>See the alert, the price, and where to get in, <em>all on one card.</em></h1>
          <p className="sub">Setpoint watches the coins you pick and sends you a card the moment something real happens, with the entry, stop, and target already drawn on it. You make every call. It never places a trade.</p>
          <div className="hero-cta">
            <button className="solid lg" onClick={() => onPickPlan("starter")}>Get started, from $19.99/mo</button>
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
          {[["Real price action", "The classics, but checked, not blind. Volume surges, momentum, RSI extremes, real breakouts, real trend structure. Every one of them tested against the broader market before it ever reaches you."],
            ["Real trade activity", "Large, real trades on the exchange, big enough to matter. A genuine, standalone signal with its own real, backtested edge, not just a chart annotation."],
            ["Advanced intel", "Setpoint uses AI to weigh every signal against actual, current headlines before it's shown, not to chat with you or guess. Real intelligence, quietly built into the system, not a bot pretending to trade for you."],
            ["Real verification, live", "Nothing shows up here just because an indicator crossed a line. It has to have backtested well, and that status is checked continuously, not earned once and forgotten."]].map(([t, d]) => (
            <div className="feat-item" key={t}><div className="feat-h">{t}</div><div className="feat-d">{d}</div></div>
          ))}
        </div>
      </section>

      <section className="how">
        <h2>How it works</h2>
        <div className="how-grid">
          <div className="how-step"><div className="how-n">01</div><div className="how-h">Pick your coins</div><div className="how-d">Start with the coins you actually trade. Add more anytime.</div></div>
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
        <div className="foot-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></div>
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
  const planName = plan === "watch" ? "Free account" : (planLabel(plan) || planLabel("starter"));

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

      // Only a real paid plan selection should trigger Stripe checkout.
      // "watch" is real again (the free Watch-Live-registration tier, not
      // the old free dashboard tier), and correctly should NOT check out,
      // that account gets real access only once they pick a paid plan
      // from UpgradeGate later. This condition once only checked
      // trader/desk, a real bug once Starter also became paid, it would
      // have created an account with no payment ever collected.
      if (mode !== "signin" && (plan === "starter" || plan === "trader" || plan === "desk")) {
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
  "RSI oversold": "Price dropped fast and far enough that it's due for a bounce.",
  "RSI overbought": "Price climbed fast and far enough that it's due for a pullback.",
  "Volume building early": "Volume is already unusually heavy before the current candle has even finished forming, an early heads-up.",
  "Breakout": "Price was stuck in a tight range for a while, then it really broke out to the upside. A genuine move, not just noise.",
  "Breakdown": "Price was stuck in a tight range for a while, then it really broke down. A genuine move, not just noise.",
  "Grind Up": "A sustained, steady climb, most of the recent bars moving the same direction. A real move, not a single dramatic bar.",
  "Grind Down": "A sustained, steady decline, most of the recent bars moving the same direction. A real move, not a single dramatic bar.",
  "Momentum": "Price moved a large amount in a single bar, a burst of one-sided pressure.",
  "Whale Flow": "A real, unusually large trade just happened on a major exchange, the kind of size that can genuinely move a market on its own.",
};

function Guide({ onBack }) {
  const proven = Object.entries(SIGNAL_RATES)
    .map(([key, v]) => {
      const [label, tf, dir] = key.split("|");
      return { label, tf, dir, rate: v.rate };
    })
    .filter((s) => s.rate != null && s.rate >= 0.58)
    .sort((a, b) => b.rate - a.rate);

  // Grouped by real, customer-facing brand name, not by the raw
  // (label,tf,dir) key. Surge alone covers four separate timeframes now,
  // showing four cards that all just say "Surge" with the same
  // description was genuinely confusing, indistinguishable at a glance.
  // One real card per name, every verified variant listed inside it.
  const grouped = [];
  for (const s of proven) {
    const name = brandName(s.label);
    let g = grouped.find((x) => x.name === name);
    if (!g) {
      g = { name, label: s.label, best: s.rate, variants: [] };
      grouped.push(g);
    }
    g.variants.push(s);
    if (s.rate > g.best) g.best = s.rate;
  }
  grouped.sort((a, b) => b.best - a.best);

  return (
    <div className="dash">
      <button className="guide-back" onClick={onBack}>← Back to dashboard</button>

      <div className="guide-hero">
        <div className="guide-mark">S</div>
        <h1>How Setpoint Works</h1>
        <p>A plain-English guide to the parts of your dashboard that need the most explaining: verified alerts, the lean meter, the Market tab, and the news read.</p>
      </div>

      <div className="guide-section">
        <div className="guide-eyebrow">Part 1</div>
        <h2>Alerts you can actually trust</h2>
        <p className="guide-lede">Setpoint tests every alert type against real, historical price data before it ever shows up on your screen. Only setups that have verified themselves right more often than not, at least 58 times out of 100, show up by default. Here's what's currently verified, best track record first.</p>

        {grouped.length ? grouped.map((g, i) => (
          <div className="guide-card" key={i}>
            <div className="guide-card-top">
              <span className="guide-card-name">{g.name}</span>
            </div>
            <div className="guide-card-desc">{GUIDE_DESC[g.label] || "A setup that's backtested well historically."}</div>
            <div className="guide-card-variants">
              {g.variants.sort((a, b) => b.rate - a.rate).map((v, j) => (
                <span className="guide-variant" key={j}>{v.dir === "bull" ? "LONG" : "SHORT"} · {Math.round(v.rate * 100)}% · {TF[v.tf]?.label || v.tf}</span>
              ))}
            </div>
          </div>
        )) : (
          <div className="guide-card"><div className="guide-card-desc">Nothing's currently verified at 58% or higher. This updates automatically as the data changes.</div></div>
        )}

        <div className="guide-glossary">
          <b>The percentage is a real batting average, not a guarantee.</b> It means this exact setup has actually happened many times before, and that share of the time it played out the way the alert expected. It doesn't mean this specific alert will win, just that the odds have leaned that way historically. Anything that hasn't verified itself at 58% or higher, checked live against real, current results, never shows up here at all. That's deliberate, not a limitation, you're only ever seeing what's actually earning it right now.
        </div>
      </div>

      <div className="guide-section">
        <div className="guide-eyebrow">Part 2</div>
        <h2>The lean meter</h2>
        <p className="guide-lede">Under each coin's price, you'll see a small bar with a dot on it. This isn't an alert, it never fires or logs anything. Think of it like a mood thermometer: it's just telling you how stretched a coin's recent move looks right now.</p>

        <div className="guide-meter-row">
          <div className="guide-meter-label"><b>Near bottom</b>−30 or lower</div>
          <div className="guide-meter-track"><div className="guide-meter-dot" style={{ left: "15%" }} /></div>
        </div>
        <div className="guide-meter-row">
          <div className="guide-meter-label"><b>Neutral</b>near 0</div>
          <div className="guide-meter-track"><div className="guide-meter-dot" style={{ left: "50%" }} /></div>
        </div>
        <div className="guide-meter-row">
          <div className="guide-meter-label"><b>Near top</b>+30 or higher</div>
          <div className="guide-meter-track"><div className="guide-meter-dot" style={{ left: "85%" }} /></div>
        </div>

        <div className="guide-field"><div className="guide-field-k">Middle of the bar (0)</div><div className="guide-field-v">The coin's been quiet, moving sideways in a tight range. Nothing big happening either way yet.</div></div>
        <div className="guide-field"><div className="guide-field-k">Leaning green, toward +30</div><div className="guide-field-v">Price has been climbing, and that climb has real strength behind it, not just noise.</div></div>
        <div className="guide-field"><div className="guide-field-k">Leaning red, toward −30</div><div className="guide-field-v">Same idea, mirrored, price has been dropping with real force behind it.</div></div>
        <div className="guide-field"><div className="guide-field-k">The important part: hitting a hard edge</div><div className="guide-field-v">The dot only swings all the way to an extreme when a real move is genuinely losing steam, either the range itself has started shrinking after a real spike, or each new push is smaller than the one before it. A strong move by itself isn't the signal, a strong move that's fading is.</div></div>
      </div>

      <div className="guide-section">
        <div className="guide-eyebrow">Part 3</div>
        <h2>The Market tab</h2>
        <p className="guide-lede">A separate tab, apart from your own coins, reading the broader market on its own terms. Everything here is real, live, background context, not a trading signal, and it never changes based on which coin you've selected.</p>

        <div className="guide-field"><div className="guide-field-k">Market Meter</div><div className="guide-field-v">A real, 1 to 5 read on Bitcoin specifically, always on the 15m, no matter which timeframe you're actually trading. Level 1 means genuinely calm, quiet, nothing stretched. Level 5 means a real, established move that's gotten stretched enough it may be running out of room. The plain-language line underneath, "Bullish, trending" or "Quiet range, may be about to break," says the same thing in words instead of just a number.</div></div>
        <div className="guide-field"><div className="guide-field-k">Confirmed</div><div className="guide-field-v">Shows up when two separate, real things agree at once, your own watchlist genuinely showing exhaustion, and the bias read below genuinely showing both sides weak. Worth extra attention when it appears, it's rare on purpose.</div></div>
        <div className="guide-field"><div className="guide-field-k">Bullish or bearish read</div><div className="guide-field-v">Shows whether longs or shorts have actually been winning more, based on real, resolved trades, not a guess or a forecast. A read on what's genuinely been working lately, not a prediction of what's coming next. "Both sides weak" means neither longs nor shorts have a real edge right now, worth extra caution regardless of direction.</div></div>
        <div className="guide-field"><div className="guide-field-k">Large trade flow</div><div className="guide-field-v">Real, large individual trades, big enough to matter, read directly off the exchange's own trade feed. Net buying has a genuine, backtested edge behind it. Net selling is shown for context only, it hasn't proven itself a reliable read either direction.</div></div>
        <div className="guide-field"><div className="guide-field-k">BTC 200-week MA</div><div className="guide-field-v">The real, average closing price of Bitcoin over the last 200 weeks, close to four years. A genuine, long-run structural line, not something that moves in a day. Every prior Bitcoin bear market has bottomed at or near this level historically. The chart shows real, recent price plotted against it, so you can see how price has actually approached it over time, not just where things stand this exact moment.</div></div>
        <div className="guide-field"><div className="guide-field-k">BTC 50 / 200-day SMA</div><div className="guide-field-v">Two real averages, the last 50 real trading days and the last 200, both plotted together. When the faster, 50-day line crosses above the slower, 200-day line, traders call that a golden cross, real bullish structure. Below it, a death cross. The real, most recent crossover, when there is one in view, gets marked directly on the chart.</div></div>
        <div className="guide-field"><div className="guide-field-k">Fear &amp; Greed Index</div><div className="guide-field-v">A widely-used, real, third-party read on the crypto market's overall mood, from extreme fear to extreme greed. Background context, not something Setpoint computes itself.</div></div>
      </div>

      <div className="guide-section">
        <div className="guide-eyebrow">Part 4</div>
        <h2>The news read</h2>
        <p className="guide-lede">Everything else on your dashboard comes purely from price. This one piece doesn't. Setpoint uses AI to read real, current crypto headlines and weigh them against the setup, real intelligence built quietly into the system, not a chatbot guessing at an alert or chatting with you.</p>

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
  const [changingPlanEmail, setChangingPlanEmail] = useState(null);
  const [analytics, setAnalytics] = useState(null);

  const loadUsers = () => {
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("failed")))
      .then((json) => setUsers(json.users || []))
      .catch(() => setError("Couldn't load the registration list."));
  };

  const loadAnalytics = () => {
    fetch("/api/admin/analytics", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("failed")))
      .then((json) => setAnalytics(json))
      .catch(() => {}); // real, secondary panel, a load failure here shouldn't block the rest of the admin page
  };

  useEffect(() => { loadUsers(); loadAnalytics(); }, []);

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

  const changePlan = async (email, plan) => {
    setChangingPlanEmail(email);
    try {
      const res = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, plan }) });
      if (res.ok) {
        setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, plan } : u)));
      }
    } catch { /* leave the row as-is, they can try again */ }
    setChangingPlanEmail(null);
  };

  return (
    <div className="dash">
      <button className="guide-back" onClick={onBack}>← Back to dashboard</button>

      <div className="guide-hero">
        <div className="guide-mark">S</div>
        <h1>Registrations</h1>
        <p>Everyone who's signed up, and what's actually captured today: email, plan, and signup date. Name and phone aren't collected yet, they're not asked for at signup.</p>
      </div>

      {analytics && (
        <div className="guide-section">
          <h2 style={{ fontSize: 15 }}>Real numbers, last 30 days</h2>
          <div className="admin-stat-row">
            <div className="admin-stat"><div className="admin-stat-n">{analytics.totalUsers}</div><div className="admin-stat-k">total accounts</div></div>
            <div className="admin-stat"><div className="admin-stat-n">{analytics.totalPaid}</div><div className="admin-stat-k">paying now</div></div>
            <div className="admin-stat"><div className="admin-stat-n">{analytics.viewsByDay.reduce((s, d) => s + d.n, 0)}</div><div className="admin-stat-k">real visits</div></div>
            <div className="admin-stat"><div className="admin-stat-n">{analytics.signupsByDay.reduce((s, d) => s + d.n, 0)}</div><div className="admin-stat-k">new signups</div></div>
          </div>
          <div className="admin-plan-breakdown">
            {analytics.planBreakdown.map((p) => (
              <span key={p.plan} className="admin-plan-chip">{{ starter: "Starter", trader: "Trader", desk: "Pro", watch: "Free" }[p.plan] || p.plan}: {p.n}</span>
            ))}
          </div>
          {analytics.totalUsers > 0 && (
            <div className="admin-conv-note">
              Real visit-to-signup rate: {analytics.viewsByDay.reduce((s, d) => s + d.n, 0) > 0
                ? `${Math.round((analytics.signupsByDay.reduce((s, d) => s + d.n, 0) / analytics.viewsByDay.reduce((s, d) => s + d.n, 0)) * 100)}%`
                : "not enough visit data yet"}
            </div>
          )}
        </div>
      )}

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
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="admin-plan-select"
                value={u.plan}
                disabled={changingPlanEmail === u.email}
                onChange={(e) => changePlan(u.email, e.target.value)}
              >
                <option value="watch">watch (free)</option>
                <option value="starter">starter</option>
                <option value="trader">trader</option>
                <option value="desk">pro</option>
              </select>
              {changingPlanEmail === u.email && <span className="admin-plan-saving">Saving…</span>}
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

// The Push API requires the VAPID public key as a Uint8Array, not the
// base64url string it's actually stored and shared as. Standard, widely
// documented conversion, not custom logic of our own.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function Dashboard({ account, onSignOut, justUpgraded }) {
  const maxCoins = account.isAdmin ? Infinity : maxCoinsForPlan(account.plan);
  const [showGuide, setShowGuide] = useState(false);
  const [showWatchLive, setShowWatchLive] = useState(false);
  const [pushStatus, setPushStatus] = useState("checking"); // checking | unsupported | off | on | busy
  const [pushError, setPushError] = useState("");
  const [cancelState, setCancelState] = useState("idle"); // idle | confirming | busy | done
  const [cancelInfo, setCancelInfo] = useState(null); // { endsAt } once real, confirmed
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Guide, Watch Live, and the admin panel now each get a real, actual
  // URL (?view=guide etc), not just an empty history entry. The empty
  // entry was enough to make the back button work, but a genuine page
  // refresh has nothing to read from an unchanged URL, so it always
  // fell back to the dashboard underneath. A real URL fixes both the
  // back button and a real refresh at once, from the same mechanism.
  const openSubView = useCallback((setter, view) => {
    const url = `${window.location.pathname}?view=${view}`;
    window.history.pushState({ setpointSubView: view }, "", url);
    setter(true);
  }, []);
  const closeSubView = useCallback((setter) => {
    setter(false);
    // Always, directly clear the real URL back to the base path, not
    // just via history.back() — a real page refresh while a sub-view
    // was open can leave the history state object without the marker
    // this used to depend on, which silently left the URL stuck on the
    // old view forever even after the view had visibly closed.
    if (window.location.search.includes("view=")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (window.history.state?.setpointSubView) window.history.back();
  }, []);
  useEffect(() => {
    const onPopState = () => {
      setShowGuide(false);
      setShowWatchLive(false);
      setShowAdminPanel(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  // Real, one-time check on initial load, restores whichever sub-view
  // the URL says was open, the actual fix for the real refresh case.
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view === "guide") setShowGuide(true);
    else if (view === "watchlive") setShowWatchLive(true);
    else if (view === "admin") setShowAdminPanel(true);
  }, []);
  const [adminStats, setAdminStats] = useState(null);
  const [adminUsers, setAdminUsers] = useState(null);
  const [watchlist, setWatchlist] = useState(["BTC"]); // safe starting point for every plan, including Starter's 1-coin limit — grows from real saved data once it loads
  const [tfKey, setTfKey] = useState("15m");

  // Real, persisted across a genuine page refresh, same real pattern
  // already proven for the dashboard tab — a real reload shouldn't
  // silently bounce someone back to 15m from whichever timeframe they
  // actually had selected.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("setpoint-tf");
      if (saved && TF[saved]) setTfKey(saved);
    } catch { /* localStorage unavailable, safe to just keep the default */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("setpoint-tf", tfKey); } catch { /* non-fatal */ }
  }, [tfKey]);
  const [th, setTh] = useState(DEFAULT_TH);
  const [data, setData] = useState({});        // sym -> {signals, snap, warming, error}
  const [btcRegime, setBtcRegime] = useState(null); // BTC's real trend/exhaustion read, always 15m regardless of the selected alerts tab, powers the Market Meter below
  const [watchlistMeters15m, setWatchlistMeters15m] = useState({}); // sym -> real meter score, always 15m, powers the Market Meter's confirmation check specifically
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
  const [liveGate, setLiveGate] = useState({});
  const [risk, setRisk] = useState(null);
  const [weekly200, setWeekly200] = useState(null);
  const [macroRead, setMacroRead] = useState(null);
  const [news, setNews] = useState({});         // sym -> [items]
  const [netFlow, setNetFlow] = useState(null);     // aggregate whale flow, not per-coin
  const [openPositions, setOpenPositions] = useState([]); // signals fired and still unresolved, from signal_track
  const [recentlyResolved, setRecentlyResolved] = useState([]); // real, honest closure — a position that leaves Open Alerts shouldn't just vanish without a trace
  const [assess, setAssess] = useState({});     // "sym:key" -> read | {error}
  const [assessing, setAssessing] = useState({});
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [dashboardTab, setDashboardTab] = useState("coins"); // "coins" | "market" | "news" — real, top-level layout tabs, replacing the single, long scroll

  // Real, persisted across a genuine page refresh (pull-to-refresh on
  // mobile is common and reloads the whole page), so a real browser
  // reload doesn't silently bounce someone back to the Coins tab from
  // wherever they actually were. Read only inside a real, client-only
  // effect, never during server-side rendering, where localStorage
  // doesn't exist at all.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("setpoint-dashboard-tab");
      if (saved === "coins" || saved === "market") setDashboardTab(saved);
    } catch { /* localStorage unavailable, safe to just keep the default */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("setpoint-dashboard-tab", dashboardTab); } catch { /* non-fatal */ }
  }, [dashboardTab]);
  const [coinNote, setCoinNote] = useState({}); // "sym:tf" -> read | {error}
  const [coinNoteLoading, setCoinNoteLoading] = useState({});
  const fired = useRef({}); // key -> {firstFired, lastSeen}
  const openPositionsRef = useRef([]); // mirrors openPositions state, read inside the detection loop so a stale closure can never see old data

  const th2 = useMemo(() => ({ ...th, pctMin: TF[tfKey].pctMin }), [th, tfKey]);

  // Real, current subscription state, checked once on mount, not assumed.
  // A browser can have push permission granted from a previous visit
  // without this device's specific subscription still being valid, so
  // this checks the actual registration, not just Notification.permission.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("unsupported");
      return;
    }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) { setPushStatus("off"); return; }
      reg.pushManager.getSubscription().then((sub) => setPushStatus(sub ? "on" : "off"));
    }).catch(() => setPushStatus("off"));
  }, []);

  const togglePush = async () => {
    setPushError("");
    if (pushStatus === "on") {
      setPushStatus("busy");
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
          await sub.unsubscribe();
        }
        setPushStatus("off");
      } catch {
        setPushStatus("on"); // real failure to unsubscribe, don't claim it's off when it might not be
      }
      return;
    }

    setPushStatus("busy");
    // Checked directly, first, rather than letting a missing key surface
    // as a generic subscribe failure. This was a real, silent failure
    // mode, the button just quietly reverted to "off" with no
    // explanation, exactly the confusing experience worth never
    // repeating.
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setPushError("Alerts aren't set up on the server yet. Try again once that's configured.");
      setPushStatus("off");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushError("Permission wasn't granted, browser notifications stay off until it is.");
        setPushStatus("off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub }) });
      if (!res.ok) {
        setPushError("Couldn't save the subscription, try again in a moment.");
        setPushStatus("off");
        return;
      }
      setPushStatus("on");
    } catch (e) {
      setPushError(`Something went wrong turning alerts on${e?.message ? `: ${e.message}` : ""}.`);
      setPushStatus("off");
    }
  };

  const cancelSubscription = async () => {
    setCancelState("busy");
    try {
      const res = await fetch("/api/cancel-subscription", { method: "POST" });
      const json = await res.json();
      if (res.ok && json.endsAt) {
        setCancelInfo({ endsAt: json.endsAt });
        setCancelState("done");
      } else {
        setCancelState("confirming"); // real failure, let them try again rather than silently drop it
      }
    } catch {
      setCancelState("confirming");
    }
  };

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
      const res = await fetch("/api/open-positions?key=verified2026", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setOpenPositions(json.positions || []);
      openPositionsRef.current = json.positions || [];
      setRecentlyResolved(json.recentlyResolved || []);
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
    fetch("/api/close-alert?key=verified2026", { cache: "no-store" }).catch(() => {});
    try {
      // BTC is always included here now, even for an account whose own
      // watchlist doesn't have it, since the real Market Meter needs a
      // reliable, always-available BTC read regardless of what any one
      // customer happens to be tracking. Deduped so it's never fetched
      // twice for someone who already has it.
      const fetchSymbols = watchlist.includes("BTC") ? watchlist : [...watchlist, "BTC"];
      const res = await fetch(`/api/market?symbols=${fetchSymbols.join(",")}&tf=${tfKey}`, { cache: "no-store" });
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
      setLiveGate(json.liveGate || {});

      const next = {};
      let anyOk = false;
      const t = Date.now();
      coins.forEach((c) => {
        if (c.error || !c.candles || !c.candles.length) {
          next[c.sym] = { signals: [], snap: null, warming: false, error: c.error || "no data", stats: c.stats || null, meter: null };
          return;
        }
        const { signals, snap, warming } = computeSignals(c.candles, tfKey, th2, { now: t, marketBias: currentBias, reversalRisk: currentRisk, fngValue: json.fng?.value, recentWhaleOutflow: json.recentWhaleOutflow, liveGate: json.liveGate });
        const meter = volatilityMeter(c.candles, tfKey);
        const tagged = signals.map((s) => {
          const key = `${c.sym}:${tfKey}:${s.type}:${s.dir}`;
          const rec = fired.current[key];
          // A real, persistent check, not just this session's own memory.
          // fired.current resets on every reload and is keyed per
          // timeframe, so switching tabs or refreshing the page used to
          // make an alert that fired hours ago look brand new again,
          // re-logging it to the scoreboard and re-firing a push
          // notification for something already delivered. openPositions
          // comes from the server and survives both, so it's checked
          // first: if a real, already-open position for this exact
          // coin/tf/label/dir already exists, this was never new.
          const serverMatch = openPositionsRef.current.find(
            (p) => p.coin === c.sym && p.tf === TF[tfKey].label && p.label === s.label && p.dir === s.dir
          );
          const isNew = !serverMatch && (!rec || t - rec.lastSeen > TF[tfKey].cooldownMs);
          if (isNew) fired.current[key] = { firstFired: t, lastSeen: t };
          else fired.current[key] = { firstFired: rec?.firstFired || serverMatch?.firedAt || t, lastSeen: t };
          if (isNew) {
            // Log to the rolling scoreboard (now part of /api/backtest, the standalone /api/scoreboard page is retired). Fire-and-forget,
            // a logging hiccup should never block the dashboard from working.
            fetch("/api/track", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ coin: c.sym, tf: tfKey, label: s.label, dir: s.dir, entry: s.entry, stop: s.stop, target: s.target, firedAt: t }),
            }).catch(() => {});
            // Push notification, only for what's actually verified right
            // now, both the static table AND the live recent-20 check,
            // using the fresh liveGate just fetched this same call rather
            // than one render-cycle-old state, so this can never fire on
            // something that's already been quietly live-gated out.
            // Genuinely follows the same list that decides what shows in
            // Opportunities, no separate trigger list to keep in sync.
            const gateKey = `${s.label}|${TF[tfKey].label}|${s.dir}`;
            const gate = (json.liveGate || {})[gateKey];
            const currentlyVerified = s.tier === "proven" && (!gate || gate.rate >= PROVEN_THRESHOLD);
            if (currentlyVerified) {
              fetch("/api/push/notify", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ coin: c.sym, label: brandName(s.label), dir: s.dir, tf: TF[tfKey].label }),
              }).catch(() => {});
            }
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

  // Real, independent of whichever timeframe tab is selected for alerts.
  // Market Meter is meant to be a consistent, reliable "where's the
  // market right now" anchor, not something that silently changes
  // meaning depending on an unrelated choice you made for your own
  // alerts. Locked to 15m specifically — fast enough to react to
  // something genuinely shifting today, not so fast it's just tracking
  // noise (discussed directly, real tradeoff, not arbitrary).
  const loadBtcRegime = useCallback(async () => {
    try {
      const res = await fetch(`/api/market?symbols=${watchlist.join(",")}&tf=15m`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const coins = json.coins || [];
      const btc = coins.find((c) => c.sym === "BTC");
      if (btc && !btc.error && btc.candles?.length) setBtcRegime(marketRegime(btc.candles, "15m"));

      // Real, same real fix, this time for the confirmation check's own
      // watchlist-exhaustion half, not just the BTC stage/level. That
      // check used to silently read data[sym]?.meter, which is computed
      // on whichever timeframe the alerts tab happens to be on, meaning
      // the "Confirmed" callout could appear or disappear just from
      // switching tabs, even though nothing about the real 15m read had
      // changed. Locked to 15m here, same as everything else in this
      // panel.
      const meters = {};
      for (const c of coins) {
        if (c.error || !c.candles?.length) continue;
        meters[c.sym] = volatilityMeter(c.candles, "15m");
      }
      setWatchlistMeters15m(meters);
    } catch { /* non-fatal, next tick tries again */ }
  }, [watchlist]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadNews(); }, [loadNews]);
  useEffect(() => { loadOpenPositions(); }, [loadOpenPositions]);
  useEffect(() => { const id = setInterval(loadOpenPositions, 60000); return () => clearInterval(id); }, [loadOpenPositions]);
  useEffect(() => { loadMacro(); }, [loadMacro]);
  useEffect(() => { const id = setInterval(loadNews, 300000); return () => clearInterval(id); }, [loadNews]);
  useEffect(() => { const id = setInterval(loadMacro, 300000); return () => clearInterval(id); }, [loadMacro]);
  useEffect(() => { const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  useEffect(() => { loadBtcRegime(); const id = setInterval(loadBtcRegime, 60000); return () => clearInterval(id); }, [loadBtcRegime]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const secsToRefresh = lastUpdate ? Math.max(0, 60 - Math.floor((now - lastUpdate) / 1000)) : null;

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

  // "Verified" is now a live status, not a one-time-earned label. A
  // signal only shows here if its real, current recent-20 performance is
  // actually still clearing 58%, not just because the backtested table
  // said it did at some point. Requires a real minimum sample before the
  // live number can override the static one either way, not enough
  // recent data should never silently hide something that's actually
  // fine, same principle Signal Drift already uses.
  const isLiveVerified = useCallback((s) => {
    const gate = liveGate[`${s.label}|${s.tf}|${s.dir}`];
    if (!gate) return true; // not enough recent data yet, trust the backtested number
    return gate.rate >= PROVEN_THRESHOLD;
  }, [liveGate]);

  // Real, direct check for whether anything is even currently verified on
  // this specific timeframe, not just whether something has fired. These
  // are genuinely different states, and the empty-state message below
  // needs to tell them apart honestly, "nothing verified here right now,
  // don't wait for it" versus "verified and actively watching, just
  // hasn't fired yet."
  const anyVerifiedThisTf = useMemo(() => {
    const tfLabel = TF[tfKey].label;
    return Object.keys(SIGNAL_RATES).some((key) => {
      const [label, tf, dir] = key.split("|");
      return tf === tfLabel && isLiveVerified({ label, tf, dir });
    });
  }, [tfKey, isLiveVerified]);

  const visibleSignals = useMemo(() => allSignals.filter((s) => s.tier === "proven" && isLiveVerified(s)), [allSignals, isLiveVerified]);
  // Open positions still resolve correctly in the background for any coin,
  // watchlisted or not, close-alert doesn't care about the watchlist at
  // all. This just controls what's actually shown, once a coin's removed
  // from the watchlist, its open trades stop showing here too, even
  // though they're still quietly tracking to a real win or loss.
  const visibleOpenPositions = useMemo(
    () => openPositions.filter((p) => watchlist.includes(p.coin) && p.tier === "proven" && isLiveVerified(p) && p.tf === TF[tfKey].label),
    [openPositions, watchlist, isLiveVerified, tfKey]
  );
  // Real, simple closure, not scoped to whichever timeframe tab happens to
  // be selected right now, the whole point is catching something that
  // resolved on a different one than the one currently open. Capped at 5,
  // a quiet, small list, not a full trade history. Verified-only, same
  // exact check Open Alerts itself uses — this used to show every real
  // resolved trade regardless of verified status, meaning genuinely
  // unverified, testing-tier fires (things that should never have been
  // shown as a real alert in the first place) were appearing in what's
  // supposed to be closure for something the customer actually saw.
  const visibleRecentlyResolved = useMemo(
    () => recentlyResolved.filter((p) => watchlist.includes(p.coin) && p.tier === "proven" && isLiveVerified(p)).slice(0, 5),
    [recentlyResolved, watchlist, isLiveVerified]
  );
  // One real, combined list, merging what's already server-confirmed open
  // with anything that just fired locally and hasn't been picked up by
  // the server's own poll yet (a brief, real timing gap, never longer
  // than one refresh cycle). Server-confirmed entries are authoritative;
  // a live signal only gets added if nothing open already represents the
  // exact same real alert, so nothing ever shows twice.
  const openAlerts = useMemo(() => {
    const openKeys = new Set(visibleOpenPositions.map((p) => `${p.coin}:${p.tf}:${p.label}:${p.dir}`));
    const freshOnly = visibleSignals.filter((s) => !openKeys.has(`${s.sym}:${s.tf}:${s.label}:${s.dir}`));
    return [
      ...visibleOpenPositions.map((p) => ({ kind: "open", data: p })),
      ...freshOnly.map((s) => ({ kind: "fresh", data: s })),
    ];
  }, [visibleOpenPositions, visibleSignals]);

  // Market Meter (internal only, never shown to customers, no label on
  // the badge itself). The volatility meter (per-coin, price-based) and
  // the bias scale (whole-engine, outcome-based) run as two independent
  // reads. This watches for the rare moment they agree: several coins
  // showing real exhaustion at the same time the bias scale shows both
  // longs and shorts genuinely struggling, together, not just one side
  // ahead by a little. That combination is a stronger, more specific
  // signal than either read alone, the same idea as the per-alert
  // confluence flag, applied to the whole market instead of one trade.
  // Combined Market Meter (Aug 25): the real, primary read is BTC's own
  // trend/exhaustion stage, since BTC tends to lead the broader market.
  // The confirmation check below is the exact same logic the old,
  // admin-only diamond used, kept as a real, extra layer, not replaced —
  // when several of your own watchlist coins are independently also
  // showing genuine exhaustion at the same moment the bias scale agrees
  // both sides are weak, that's a stronger, more specific read than the
  // BTC stage alone, worth surfacing as a real boost rather than losing
  // it entirely.
  const marketMeter = useMemo(() => {
    if (!btcRegime) return null;

    const confirmed = !!signalBias?.bothWeak && (() => {
      const nearBottom = watchlist.filter((sym) => watchlistMeters15m[sym]?.score <= 20).length;
      const nearTop = watchlist.filter((sym) => watchlistMeters15m[sym]?.score >= 80).length;
      const needed = watchlist.length <= 2 ? 1 : watchlist.length <= 4 ? 2 : Math.ceil(watchlist.length / 3);
      return nearBottom >= needed || nearTop >= needed;
    })();

    return { ...btcRegime, confirmed };
  }, [btcRegime, signalBias, watchlistMeters15m, watchlist]);


  const saveWatchlist = useCallback((list) => {
    fetch("/api/my-watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watchlist: list }),
    }).catch(() => {}); // fire-and-forget, a failed save just means it falls back to defaults on next visit, not worth blocking the UI over
  }, []);

  const addCoin = (raw) => {
    const sym = (raw || "").trim().toUpperCase();
    if (!sym || watchlist.includes(sym) || watchlist.length >= maxCoins) return;
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
        <Guide onBack={() => closeSubView(setShowGuide)} />
      </div>
    );
  }

  if (showWatchLive) {
    return (
      <div className="dash">
        <div className="topbar">
          <div className="brand"><span className="logo-dot" />Setpoint</div>
        </div>
        <WatchLiveContent onBack={() => closeSubView(setShowWatchLive)} />
      </div>
    );
  }

  if (showAdminPanel) {
    return (
      <div className="dash">
        <div className="topbar">
          <div className="brand"><span className="logo-dot" />Setpoint</div>
        </div>
        <AdminPanel onBack={() => closeSubView(setShowAdminPanel)} />
      </div>
    );
  }

  return (
    <div className="dash">
      <div className="topbar">
        <div className="brand"><span className="logo-dot" />Setpoint</div>
        {dashboardTab === "coins" && (
        <div className="tf-toggle">
          {Object.keys(TF).map((k) => <button key={k} className={tfKey === k ? "on" : ""} onClick={() => setTfKey(k)}>{TF[k].label}</button>)}
        </div>
        )}
        <div className="top-r">
          <div className="refresh">{loading ? <span className="dot-pulse" /> : <span className="dot-ok" />}<span className="refresh-t">{secsToRefresh != null ? `refresh ${secsToRefresh}s` : "…"}</span></div>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
          <button className="hamburger-btn" onClick={() => setShowMobileMenu((v) => !v)} aria-label="Menu">☰</button>
          <div className={`acct ${showMobileMenu ? "acct-open" : ""}`}>
            {account.isAdmin && (
              <button className="admin-badge" onClick={() => { openSubView(setShowAdminPanel, "admin"); setShowMobileMenu(false); }}>
                ADMIN{adminStats?.newLast24h > 0 ? ` · ${adminStats.newLast24h} new` : ""}
              </button>
            )}
            {!account.isAdmin && (
              <span className="plan-badge">{{ starter: "STARTER", watch: "FREE", trader: "TRADER", desk: "PRO" }[account.plan] || "STARTER"}</span>
            )}
            {!account.isAdmin && account.plan !== "watch" && cancelState !== "done" && (
              cancelState === "confirming" ? (
                <span className="cancel-confirm-row">
                  <span className="cancel-confirm-text">Cancel your plan?</span>
                  <button className="admin-danger-btn" onClick={cancelSubscription} disabled={cancelState === "busy"}>{cancelState === "busy" ? "…" : "Yes, cancel"}</button>
                  <button className="ghost sm" onClick={() => setCancelState("idle")}>Never mind</button>
                </span>
              ) : (
                <button className="cancel-link" onClick={() => setCancelState("confirming")}>Cancel subscription</button>
              )
            )}
            <button className="ghost sm" onClick={() => { openSubView(setShowWatchLive, "watchlive"); setShowMobileMenu(false); }}>WATCH LIVE</button>
            {pushStatus !== "unsupported" && pushStatus !== "checking" && (
              <button className={`ghost sm ${pushStatus === "on" ? "alerts-on" : ""}`} onClick={togglePush} disabled={pushStatus === "busy"}>
                {pushStatus === "on" ? "ALERTS ON" : pushStatus === "busy" ? "…" : "TURN ON ALERTS"}
              </button>
            )}
            <button className="ghost sm" onClick={() => { openSubView(setShowGuide, "guide"); setShowMobileMenu(false); }}>GUIDE</button>
            <a className="ghost sm" href="/contact" target="_blank" rel="noopener noreferrer">CONTACT</a>
            <button className="ghost sm" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>

      <div className="dash-tabs">
        <button className={`dash-tab-btn ${dashboardTab === "coins" ? "active" : ""}`} onClick={() => setDashboardTab("coins")}>Coins</button>
        <button className={`dash-tab-btn ${dashboardTab === "market" ? "active" : ""}`} onClick={() => setDashboardTab("market")}>Market</button>
      </div>

      {/* ticker row */}
      {dashboardTab === "coins" && (
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
        {watchlist.length < maxCoins && (
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
      )}

      {globalError && <div className="banner">{globalError}</div>}
      {justUpgraded && <div className="banner success">Payment confirmed. Your plan is now {{ starter: "Starter", trader: "Trader", desk: "Pro" }[account.plan] || account.plan}.</div>}
      {pushError && <div className="banner error">{pushError} <button className="banner-dismiss" onClick={() => setPushError("")}>×</button></div>}
      {cancelState === "done" && cancelInfo && (
        <div className="banner success">
          Your subscription is canceled. You'll keep full access through {new Date(cancelInfo.endsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}, no charge after that.
        </div>
      )}

      <div className="dash-body">
        {dashboardTab === "coins" && (
        <div className="opps">
          <div className="section-head">
            <h2>Open Alerts</h2>
            <span className="sh-sub">{openAlerts.length} active, verified only · {watchlist.length} coins · {TF[tfKey].label}</span>
          </div>
          {openAlerts.length === 0 ? (
            <div className={`empty ${!anyVerifiedThisTf ? "dead" : ""}`}>
              <div className="empty-h">
                {!anyVerifiedThisTf
                  ? `Nothing to watch on ${TF[tfKey].label} yet`
                  : <><span className="dot-ok" /> Watching {TF[tfKey].label}</>}
              </div>
              <div className="empty-d">
                {!anyVerifiedThisTf
                  ? `Nothing's cleared the bar on this timeframe right now. It'll show up here the moment something does, no need to keep checking.`
                  : allSignals.length > 0
                  ? `${allSignals.length} signal${allSignals.length === 1 ? "" : "s"} fired, but none matched a setup that's actually verified yet. That's the point, not a bug, only verified setups ever show here.`
                  : `Setpoint only shows setups verified by backtest, and it stays quiet until one of those exact conditions shows up on ${watchlist.join(", ")}.`}
              </div>
            </div>
          ) : (
            <div className="cards-grid">
              {openAlerts.map((a) =>
                a.kind === "open" ? (
                  <SignalCard
                    key={`open:${a.data.coin}:${a.data.tf}:${a.data.label}:${a.data.dir}:${a.data.firedAt}`}
                    s={{ dir: a.data.dir, label: a.data.label, note: "Fired and still open, tracking toward target or stop.", strength: 0.5, entry: a.data.entry, stop: a.data.stop, target: a.data.target, tf: a.data.tf, tier: a.data.tier, tierRate: a.data.tierRate, key: `${a.data.tf}:${a.data.label}:${a.data.dir}` }}
                    sym={a.data.coin}
                    price={data[a.data.coin]?.snap?.price}
                    firedAt={a.data.firedAt}
                    now={now}
                    isOpenPosition
                    read={assess[`${a.data.coin}:${a.data.tf}:${a.data.label}:${a.data.dir}`]}
                    loading={assessing[`${a.data.coin}:${a.data.tf}:${a.data.label}:${a.data.dir}`]}
                    onAssess={() => runAssess(a.data.coin, { dir: a.data.dir, label: a.data.label, tf: a.data.tf, key: `${a.data.tf}:${a.data.label}:${a.data.dir}` })}
                  />
                ) : (
                  <SignalCard key={a.data.sym + a.data.key} s={a.data} sym={a.data.sym} price={a.data.price} firedAt={a.data.firedAt} now={now} read={assess[`${a.data.sym}:${a.data.key}`]} loading={assessing[`${a.data.sym}:${a.data.key}`]} onAssess={() => runAssess(a.data.sym, a.data)} />
                )
              )}
            </div>
          )}

          <div className="signals-panel">
            <div className="section-head">
              <h2>Early signals</h2>
              {selectedCoin && <button className="sh-clear" onClick={() => setSelectedCoin(null)}>{selectedCoin} · show all ×</button>}
            </div>

            {selectedCoin ? (() => {
              const id = noteId(selectedCoin);
              const note = coinNote[id];
              const loadingNote = coinNoteLoading[id];
              return (
                <div className="coin-note">
                  <div className="cn-head">Note on {selectedCoin} · {TF[tfKey].label}</div>
                  {note && note.error ? (
                    <div className="ai-err">{note.error === "no_key" ? "This feature isn't configured yet." : "Note unavailable right now."}</div>
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
                    <button className="ai-btn" onClick={() => runCoinNote(selectedCoin)}>Write note</button>
                  )}
                </div>
              );
            })() : (
              <div className="sig-empty">Tap a coin above for a note on just that coin.</div>
            )}
          </div>

          {visibleRecentlyResolved.length > 0 && (
            <div className="recently-resolved">
              <div className="rr-head">Recently resolved</div>
              {visibleRecentlyResolved.map((r, i) => (
                <div className={`rr-row ${r.outcome}`} key={i}>
                  <span className="rr-coin">{r.coin}</span>
                  <span className="rr-tf">{r.tf}</span>
                  <span className="rr-name">{r.dir === "bull" ? "Buy" : "Sell"} {brandName(r.label)}</span>
                  <span className={`rr-outcome ${r.outcome}`}>{r.outcome === "win" ? "WIN" : "LOSS"}</span>
                  <span className={`rr-pct ${r.outcome}`}>{r.pctMove >= 0 ? "+" : ""}{r.pctMove.toFixed(2)}%</span>
                  <span className="rr-when">resolved {new Date(r.resolvedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {dashboardTab === "market" && (
        <div className="market-cols">
        <aside className="onchain market-col-left">
          <div className="section-head"><h2>Market</h2><span className="sh-sub">live</span></div>

          {signalBias && marketMeter && (
            <div className={`mm-panel ${marketMeter.confirmed ? "confirmed" : ""}`}>
              <div className="mm-head">
                <span className="mm-title">Market Meter</span>
                <span className="mm-sub">BTC · 15m</span>
              </div>
              <div className="sb-head">
                <span className="sb-label">{signalBias.label} <span className="sb-score mono">{signalBias.score - 50 > 0 ? "+" : ""}{signalBias.score - 50}</span></span>
              </div>
              <div className="sb-sub">
                {signalBias.bullRate != null
                  ? `Longs: ${Math.round(signalBias.bullRate * 100)}% (${signalBias.bullN}) · Shorts: ${Math.round(signalBias.bearRate * 100)}% (${signalBias.bearN}), real win rate, last ${signalBias.bullN + signalBias.bearN} resolved trades.`
                  : `Longs: ${signalBias.bullN} resolved · Shorts: ${signalBias.bearN} resolved, needs at least 5 on each side to show a real lean.`}
              </div>
              <div className="mm-levels">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={`mm-dot ${n <= marketMeter.level ? "on" : ""} ${marketMeter.stage === "bullish-trending" ? "up" : marketMeter.stage === "bearish-trending" ? "down" : "neutral"} ${n === 5 ? "extreme" : ""}`} />
                ))}
              </div>
              <div className="mm-level-text">Level {marketMeter.level} of 5</div>
              <div className={`mm-stage ${marketMeter.phase === "ending" ? "ending" : ""}`}>{marketMeter.label}</div>
              {marketMeter.confirmed && (
                <div className="mm-confirm">⚡ Confirmed: your own watchlist and the bias scale independently agree</div>
              )}
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
                <PriceVsMaChart series={weekly200.priceSeries} maValue={weekly200.sma} />
                <div className="w200-note">Long-run structural line, weeks not minutes. Every prior Bitcoin bear market has bottomed at or near this level. Not a trading signal, background context only.</div>
              </div>
            );
          })()}

          {weekly200 && weekly200.daily50 != null && weekly200.daily200 != null && (() => {
            const btcPrice = data.BTC?.snap?.price;
            const dist50 = btcPrice ? ((btcPrice - weekly200.daily50) / weekly200.daily50) * 100 : null;
            const dist200 = btcPrice ? ((btcPrice - weekly200.daily200) / weekly200.daily200) * 100 : null;
            const golden = weekly200.daily50 >= weekly200.daily200;
            return (
              <div className="w200-panel dual">
                <div className="w200-head">BTC 50 / 200-day SMA</div>
                <div className={`cross-tag ${golden ? "golden" : "death"}`}>{golden ? "Golden cross, 50 above 200" : "Death cross, 50 below 200"}</div>
                <CrossoverChart series={weekly200.dailySeries} />
                <div className="cross-legend">
                  <span className="cross-legend-item"><span className="cross-dot fifty" /> 50-day, ${fmtPrice(weekly200.daily50)}{dist50 != null && ` (${dist50 >= 0 ? "+" : ""}${dist50.toFixed(1)}%)`}</span>
                  <span className="cross-legend-item"><span className="cross-dot twohundred" /> 200-day, ${fmtPrice(weekly200.daily200)}{dist200 != null && ` (${dist200 >= 0 ? "+" : ""}${dist200.toFixed(1)}%)`}</span>
                </div>
                <div className="w200-note">Faster, daily basis, a real, different read from the weekly line above. When the 50 crosses above the 200, traders call that a golden cross, real bullish structure. Below, a death cross. Not a trading signal on its own, background context only.</div>
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
        </aside>

        <aside className="onchain market-col-right">
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
                  <span className="netflow-dir">{netDir === "buy" ? "▲ net buying" : "● net selling"}</span>
                  <span className="netflow-amt mono">{fmtVol(Math.abs(netFlow.net))} ({netPct}%)</span>
                </div>
                {netFlow.recent && netFlow.recent[0]?.when && (
                  <div className="netflow-ts">Most recent: {new Date(netFlow.recent[0].when).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                )}
                <div className="netflow-note">Real, unusually large individual trades on Coinbase (BTC, $500k+). Net buying has real, backtested edge (74-78% at the 4h mark). Net selling is shown for context only, our own data hasn't found it a reliable predictor either direction, so it's never colored as a signal.</div>
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
        )}
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
/* ============================== UPGRADE GATE ============================= */
// Shown to anyone signed in on the free "watch" plan instead of the real
// dashboard. They already have a real account and a real session, so this
// never asks them to register again, picking a tier here just goes
// straight to Stripe checkout on the account that already exists.
function UpgradeGate({ account, onSignOut }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const tiers = PRICING_LIST;

  const upgrade = async (plan) => {
    setErr("");
    setBusy(plan);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (res.ok && json.url) { window.location.href = json.url; return; }
      setErr("Couldn't start checkout, try again.");
    } catch {
      setErr("Something went wrong, try again.");
    }
    setBusy(null);
  };

  return (
    <div className="upgrade-gate">
      <div className="ug-head">
        <div className="brand"><span className="logo-dot" />Setpoint</div>
        <button className="ghost sm" onClick={onSignOut}>Sign out</button>
      </div>
      <div className="ug-hero">
        <h1>You're registered, {account.email}.</h1>
        <p>Your free account gives you access to Watch It Live and nothing else yet. Pick a plan below to unlock the real dashboard, live signals on your own coins, entry, stop, and target on every alert.</p>
      </div>
      {err && <div className="ug-err">{err}</div>}
      <div className="ug-tiers">
        {tiers.map((t) => (
          <div className="ug-tier" key={t.id}>
            <div className="ug-tier-name">{t.name}</div>
            <div className="ug-tier-price">{t.price}<span>{t.per}</span></div>
            <ul>{t.feats.map((f) => <li key={f}>{f}</li>)}</ul>
            <button className="solid full" onClick={() => upgrade(t.id)} disabled={busy !== null}>{busy === t.id ? "Please wait…" : `Get ${t.name}`}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const { data: session, status, update } = useSession(); // "loading" | "authenticated" | "unauthenticated"
  const [view, setView] = useState("landing"); // landing | auth
  const [authMode, setAuthMode] = useState("signup");
  const [plan, setPlan] = useState(null);
  const [justUpgraded, setJustUpgraded] = useState(false);

  const isAuthed = status === "authenticated";
  const account = isAuthed ? { email: session.user.email, plan: session.user.plan, isAdmin: !!session.user.isAdmin } : null;

  // A link from Watch It Live ("/?signup=watch") should open straight into
  // free signup, not dump someone on the generic landing page they'd have
  // to click through again. Only meaningful for a signed-out visitor,
  // already-signed-in accounts route on their own further down.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") === "watch" && !isAuthed) {
      setAuthMode("signup");
      setPlan("watch");
      setView("auth");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  // Real, deeper version of the same fix Guide/Watch Live/Admin already
  // got. Signing in and landing on the dashboard is itself pure React
  // state, no URL ever changes, so even without opening a sub-view, the
  // browser's back button had nothing real from inside the app to land
  // on, it fell straight through to whatever page was open before
  // Setpoint was ever loaded. This pushes one real, genuine anchor the
  // moment someone actually becomes authenticated, so back from anywhere
  // on the dashboard has somewhere real of its own to go.
  const historyAnchored = useRef(false);
  useEffect(() => {
    if (isAuthed && !historyAnchored.current) {
      window.history.pushState({ setpointDashboardAnchor: true }, "");
      historyAnchored.current = true;
    }
    if (!isAuthed) historyAnchored.current = false;
  }, [isAuthed]);

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
      {account && account.plan === "watch" && !account.isAdmin && (
        <UpgradeGate account={account} onSignOut={handleSignOut} />
      )}
      {account && (account.plan !== "watch" || account.isAdmin) && (
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
.feat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:26px}
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

.upgrade-gate{max-width:900px;margin:0 auto;padding:0 22px 60px}
.ug-head{display:flex;justify-content:space-between;align-items:center;padding:22px 0}
.ug-hero{text-align:center;padding:20px 0 40px}
.ug-hero h1{font-size:24px;margin:0 0 12px}
.ug-hero p{color:var(--muted);font-size:14.5px;max-width:480px;margin:0 auto;line-height:1.5}
.ug-err{background:var(--red-dim);color:var(--red-soft);border:1px solid rgba(255,92,108,.3);border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:20px;text-align:center}
.ug-tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.ug-tier{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:24px 20px;display:flex;flex-direction:column}
.ug-tier-name{font-family:'Bricolage Grotesque';font-weight:700;font-size:17px}
.ug-tier-price{margin:8px 0 16px;font-family:'Bricolage Grotesque';font-size:30px;font-weight:800}
.ug-tier-price span{color:var(--muted);font-size:13px;font-weight:500}
.ug-tier ul{list-style:none;padding:0;margin:0 0 18px;flex:1;display:flex;flex-direction:column;gap:9px}
.ug-tier li{font-size:12.5px;color:var(--text);padding-left:20px;position:relative;line-height:1.4}
.ug-tier li::before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:700}
@media(max-width:640px){.ug-tiers{grid-template-columns:1fr}}

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
.foot-links{display:flex;gap:16px;margin-top:12px}
.foot-links a{color:var(--muted);font-size:12px;text-decoration:none}
.foot-links a:hover{color:var(--text)}

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
.hamburger-btn{display:none;background:none;border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:16px;width:34px;height:34px;align-items:center;justify-content:center;cursor:pointer}
.plan-badge{font-size:10.5px;font-weight:700;letter-spacing:.08em;color:var(--green);background:var(--green-dim);border:1px solid var(--green);padding:4px 9px;border-radius:6px}
.alerts-on{color:var(--green) !important;background:var(--green-dim) !important;border:1px solid var(--green) !important}
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
.banner.error{background:var(--red-dim);border-color:rgba(255,92,108,.3);color:var(--red-soft);display:flex;align-items:center;justify-content:space-between;gap:12px}
.banner-dismiss{background:none;border:none;color:inherit;font-size:16px;cursor:pointer;padding:0 4px;line-height:1}

.dash-body{margin-top:6px}
.dash-tabs{display:flex;gap:4px;margin-top:16px;border-bottom:1px solid var(--border)}
.dash-tab-btn{background:none;border:none;padding:10px 18px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent}
.dash-tab-btn.active{color:var(--text);border-bottom-color:var(--green)}
.dash-tab-btn:hover{color:var(--text)}
.section-head{display:flex;align-items:baseline;gap:12px;margin-bottom:16px}
.recently-resolved{margin-top:20px;padding:14px 16px;background:var(--panel2);border:1px solid var(--border);border-radius:12px}
.rr-head{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.rr-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border);font-size:12.5px;flex-wrap:wrap}
.rr-row:first-of-type{border-top:none;padding-top:0}
.rr-coin{font-weight:800;color:var(--text)}
.rr-tf{font-size:10px;color:var(--dim);background:var(--panel3);border:1px solid var(--border);padding:1px 6px;border-radius:5px}
.rr-name{color:var(--muted)}
.rr-outcome{font-size:10px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:5px}
.rr-outcome.win{color:var(--green);background:var(--green-dim)}
.rr-outcome.loss{color:var(--red-soft);background:var(--red-dim)}
.rr-pct{font-weight:700;margin-left:auto}
.rr-pct.win{color:var(--green)}
.rr-pct.loss{color:var(--red-soft)}
.rr-when{color:var(--dim);font-size:11px;width:100%}


.section-head h2{font-size:20px;font-weight:700}
.sh-sub{color:var(--dim);font-size:12.5px}
.sh-sub.sample{color:var(--amber)}

.empty{background:var(--panel);border:1px dashed var(--border);border-radius:14px;padding:44px 26px;text-align:center}
.empty.dead{opacity:.7}
.empty-h{font-family:'Bricolage Grotesque';font-weight:600;font-size:18px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:9px}
.empty-d{color:var(--muted);font-size:14px;line-height:1.55;max-width:420px;margin:0 auto}

.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(288px,1fr));gap:14px}
.sig-card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-left-width:3px;border-radius:14px;padding:16px}
.sig-card.confluence{border-color:var(--amber);box-shadow:0 0 0 1px rgba(245,184,81,.35),0 0 18px rgba(245,184,81,.12)}
.confluence-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:5px;color:var(--amber);background:rgba(245,184,81,.14);border:1px solid rgba(245,184,81,.35)}
.testing-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:5px;color:var(--muted);background:var(--panel2);border:1px solid var(--border)}
.rate-src{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:5px;cursor:help}
.rate-src.live{color:var(--green-soft);background:var(--green-dim)}
.rate-src.backtest{color:var(--dim);background:var(--panel2)}
.sig-card.bull{border-left-color:var(--green)}
.sig-card.bear{border-left-color:var(--red)}
.sig-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.sig-id{display:flex;align-items:center;gap:6px;flex-wrap:wrap;row-gap:4px}
.sig-id .sym{font-family:'Bricolage Grotesque';font-weight:800;font-size:17px}
.sig-type{font-size:12.5px;color:var(--muted);font-weight:500}
.open-pos-tag{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:5px;color:var(--amber);background:var(--amber-dim);border:1px solid rgba(245,184,81,.35)}
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
.market-cols{display:grid;grid-template-columns:7fr 3fr;gap:20px;align-items:start}
.market-col-right{display:flex;flex-direction:column;gap:16px}
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
.w200-val.sm{font-size:12.5px}
.w200-panel.dual{padding-bottom:12px}
.cross-tag{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;display:inline-block;margin-bottom:10px}
.chart-wrap{position:relative}
.cross-chart{width:100%;height:90px;display:block;margin-bottom:2px}
.chart-axis{position:relative;height:16px;margin-bottom:8px}
.chart-axis-label{position:absolute;top:0;transform:translateX(-50%);font-size:9.5px;color:var(--dim);white-space:nowrap}
.chart-axis-label:first-child{transform:translateX(0)}
.chart-axis-label:last-child{transform:translateX(-100%)}
.cross-legend{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.cross-legend-item{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px}
.cross-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.cross-dot.fifty{background:var(--green-soft)}
.cross-dot.twohundred{background:var(--muted)}
.cross-tag.golden{color:var(--green-soft);background:var(--green-dim)}
.cross-tag.death{color:var(--red-soft);background:var(--red-dim)}
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
.mm-panel{padding:14px 16px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-bottom:16px}
.mm-panel.confirmed{border-color:rgba(245,184,81,.5);background:linear-gradient(180deg,rgba(245,184,81,.08),var(--panel2))}
.mm-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.mm-title{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.mm-sub{font-size:11px;color:var(--dim)}
.mm-levels{display:flex;gap:6px;margin-bottom:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--hair)}
.mm-dot{width:100%;height:6px;border-radius:4px;background:var(--panel3)}
.mm-dot.on.up{background:var(--green-soft)}
.mm-dot.on.down{background:var(--red-soft)}
.mm-dot.on.neutral{background:var(--muted)}
.mm-dot.on.extreme{background:var(--amber)}
.mm-level-text{font-family:'Bricolage Grotesque';font-weight:700;font-size:20px;margin-bottom:6px}
.mm-stage{font-family:'Bricolage Grotesque';font-weight:700;font-size:18px;margin-bottom:4px}
.mm-stage.ending{color:var(--amber)}
.mm-confirm{margin-top:10px;font-size:12px;color:var(--amber);font-weight:600}
.sb-head{display:flex;justify-content:flex-end;align-items:baseline;margin-bottom:8px}
.sb-label{font-size:12px;font-weight:600}
.sb-score{color:var(--dim);font-weight:400;margin-left:2px}
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
.netflow-panel.sell{background:var(--panel2);border-color:var(--border)}
.netflow-head{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.netflow-tag{text-transform:none;letter-spacing:0;font-style:italic;font-weight:400}
.netflow-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.netflow-dir{font-size:12px;font-weight:700}
.netflow-panel.buy .netflow-dir{color:var(--green)}
.netflow-panel.sell .netflow-dir{color:var(--muted)}
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
  .market-cols{grid-template-columns:1fr}
}
@media(max-width:640px){
  .topbar{flex-wrap:wrap;gap:10px;padding:12px 0;position:relative}
  .tf-toggle{order:3;width:100%;justify-content:space-between}
  .tf-toggle button{flex:1;text-align:center}
  .top-r{gap:10px}
  .hamburger-btn{display:flex}
  .acct{display:none}
  .acct.acct-open{
    display:flex;flex-direction:column;align-items:stretch;gap:8px;
    position:absolute;top:100%;right:0;margin-top:8px;z-index:50;
    background:var(--panel);border:1px solid var(--border);border-radius:12px;
    padding:12px;min-width:220px;box-shadow:0 12px 32px rgba(0,0,0,.4);
  }
  .acct.acct-open .ghost.sm,.acct.acct-open .admin-badge,.acct.acct-open .cancel-link{width:100%;text-align:left}
  .acct.acct-open .plan-badge{display:inline-block;width:fit-content}
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
.guide-card-variants{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.guide-variant{font-size:11px;font-weight:600;color:var(--green-soft);background:var(--green-dim);border:1px solid rgba(0,209,121,.3);padding:3px 9px;border-radius:6px;white-space:nowrap}
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
.admin-plan-select{background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:5px 8px;font-size:12px;font-family:inherit;cursor:pointer}
.admin-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.admin-stat{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:14px}
.admin-stat-n{font-size:24px;font-weight:800;font-family:'Bricolage Grotesque'}
.admin-stat-k{font-size:11px;color:var(--muted);margin-top:2px}
.admin-plan-breakdown{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.admin-plan-chip{font-size:11.5px;color:var(--muted);background:var(--panel2);border:1px solid var(--border);padding:4px 10px;border-radius:20px}
.admin-conv-note{font-size:12px;color:var(--dim)}
@media(max-width:640px){.admin-stat-row{grid-template-columns:repeat(2,1fr)}}
.admin-plan-select:disabled{opacity:.5;cursor:default}
.admin-plan-saving{color:var(--muted);font-size:11.5px}
.admin-confirm-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.admin-confirm-text{color:var(--red-soft);font-size:12px}
.cancel-link{background:none;border:none;color:var(--dim);font-size:11px;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px}
.cancel-link:hover{color:var(--muted)}
.cancel-confirm-row{display:flex;align-items:center;gap:8px}
.cancel-confirm-text{color:var(--red-soft);font-size:11px}
.admin-danger-btn{background:var(--red-dim);border:1px solid var(--red);color:var(--red-soft);font-size:12px;font-weight:700;padding:6px 11px;border-radius:8px;cursor:pointer}
`;
