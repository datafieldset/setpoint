"use client";
// app/TrendRider.jsx
//
// Trend Rider on the coins tab. It plugs into the same dashboard pattern as
// every signal: the timeframe buttons live in the top bar (the page owns
// them and passes the picked one in as `tfKey`), "Open Alerts" shows a card
// only for a trade that has fired and is still open on that timeframe, an
// empty state says "Watching 4h" when nothing has, and the plain-English
// description of the signal lives in the Guide, never on the dashboard.
// The signal's name appears only on its card. Below the cards: the
// recent results (with the win rate), and a collapsed "what it's watching" checklist.
import { useEffect, useState } from "react";

const fmtPrice = (p) => (p == null || isNaN(p) ? "—" : Math.round(p).toLocaleString("en-US"));
const fmtR = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`);
const pct = (n) => (n == null ? "—" : `${n}%`);
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (iso, now) => {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  return h < 48 ? h + "h ago" : Math.floor(h / 24) + "d ago";
};
const away = (price, level) => (price && level ? Math.abs((level / price - 1) * 100).toFixed(1) + "%" : null);
const EARLY = 10; // below this many closed trades a win rate is just an early read

function Check({ ok, children }) {
  return (
    <li className={ok ? "ok" : "no"}>
      <span className="tr-dot" aria-hidden="true" />
      <span className="tr-sr">{ok ? "Met: " : "Not met: "}</span>
      {children}
    </li>
  );
}

function Side({ title, level, price, conds, dir }) {
  const met = conds.filter((c) => c.ok).length;
  const dist = away(price, level);
  return (
    <div className={`tr-side ${dir}`}>
      <div className="tr-side-h">
        <b>{title}</b> if price touches <span className="mono">${fmtPrice(level)}</span>
        {dist && <span className="tr-dist"> ({dist} away)</span>}
      </div>
      <ul className="tr-conds">
        {conds.map((c) => <Check key={c.key} ok={c.ok}>{c.label}</Check>)}
      </ul>
      <div className="tr-side-f">{met === conds.length ? "Every check is green. It fires the moment price touches the level." : `${met} of ${conds.length} checks green. All must be green when price touches the level.`}</div>
    </div>
  );
}

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

function TrendCard({ p, rec, tf, price, now }) {
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

export default function TrendRider({ tfKey }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/trend", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
        .then((j) => { if (alive) { setD(j); setErr(null); setNow(Date.now()); } })
        .catch(() => { if (alive) setErr("Couldn't load Trend Rider right now."); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 30000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, []);

  const cur = d?.tfs?.[tfKey];
  const price = cur?.watch?.price ?? d?.price;
  const open = cur?.open || [];
  const recFor = (p) => (p.dir === "long" ? cur.record.buys : cur.record.sells);

  return (
    <>
      <style>{CSS}</style>
      <div className="section-head">
        <h2>Open Alerts</h2>
        <span className="sh-sub">{open.length} active · Bitcoin · {tfKey}</span>
      </div>

      <div aria-live="polite">
        {err && <div className="empty"><div className="empty-d">{err}</div></div>}
        {!d && !err && <div className="empty"><div className="empty-d">Loading…</div></div>}
      </div>

      {cur && (
        <>
          {cur.error && <div className="tr-err">This timeframe couldn't load just now. It retries on its own.</div>}

          {open.length === 0 ? (
            <div className="empty">
              <div className="empty-h"><span className="dot-ok" /> Watching {tfKey}</div>
              <div className="empty-d">Nothing's fired on {tfKey} right now. It shows up here the moment price breaks out and every check is green.</div>
            </div>
          ) : (
            <div className="cards-grid">
              {open.map((p) => <TrendCard key={p.id} p={p} rec={recFor(p)} tf={tfKey} price={price} now={now} />)}
            </div>
          )}

          <details className="tr-watch">
            <summary>What it's watching on {tfKey}</summary>
            {cur.watch ? (
              <>
                <div className="tr-sides">
                  <Side title="Buy" dir="long" level={cur.watch.buy.level} price={cur.watch.price} conds={cur.watch.buy.conds} />
                  <Side title="Sell" dir="short" level={cur.watch.sell.level} price={cur.watch.price} conds={cur.watch.sell.conds} />
                </div>
                {cur.ref && (
                  <div className="tr-ref">
                    History test on {cur.label}: buys {cur.ref.buys.winPct}% wins, {fmtR(cur.ref.buys.avgR)} avg over {cur.ref.buys.trades} trades; sells {cur.ref.sells.winPct}% wins, {fmtR(cur.ref.sells.avgR)} avg over {cur.ref.sells.trades} trades. Live results usually come in lower.
                  </div>
                )}
                {(cur.record.crowd.fearful.trades > 0 || cur.record.crowd.greedy.trades > 0) && (
                  <div className="tr-ref">
                    By crowd mood when it fired: fearful or neutral {pct(cur.record.crowd.fearful.winPct)} ({cur.record.crowd.fearful.trades} trades), greedy {pct(cur.record.crowd.greedy.winPct)} ({cur.record.crowd.greedy.trades} trades).
                  </div>
                )}
              </>
            ) : (
              <div className="tr-ref">Still gathering enough candles to set the levels.</div>
            )}
          </details>

          {cur.closed.length > 0 && (
            <div className="recently-resolved">
              <div className="rr-head">Recently resolved · {tfKey}{cur.record.all.winPct != null ? ` · ${cur.record.all.winPct}% won (${cur.record.all.wins} of ${cur.record.all.trades})` : ""}</div>
              {cur.closed.map((c) => (
                <div className={`rr-row ${c.r > 0 ? "win" : "loss"}`} key={c.id}>
                  <span className="rr-coin">BTC</span>
                  <span className="rr-tf">{tfKey}</span>
                  <span className="rr-name">{c.dir === "long" ? "Buy" : "Sell"} Trend Rider</span>
                  <span className={`rr-outcome ${c.r > 0 ? "win" : "loss"}`}>{c.r > 0 ? "WIN" : "LOSS"}</span>
                  <span className={`rr-pct ${c.r > 0 ? "win" : "loss"}`}>{fmtR(c.r)}</span>
                  <span className="rr-when">{fmtPrice(c.entry)} to {fmtPrice(c.exit)} · resolved {when(c.closedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

const CSS = `
.tr-err{color:var(--red);font-size:12.5px;margin-bottom:10px}
.tr-watch{margin-top:16px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px}
.tr-watch summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--muted)}
.tr-watch summary:focus-visible{outline:2px solid var(--amber);outline-offset:3px;border-radius:4px}
.tr-watch[open] summary{margin-bottom:12px}
.tr-sides{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tr-side{border:1px solid var(--border);border-top:3px solid var(--green);border-radius:10px;padding:10px 12px}
.tr-side.short{border-top-color:var(--red)}
.tr-side-h{font-size:13.5px;line-height:1.45;margin-bottom:8px}
.tr-dist{color:var(--dim);font-size:12px}
.tr-conds{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:5px;font-size:12.5px;line-height:1.35}
.tr-conds li{display:flex;gap:8px;align-items:flex-start}
.tr-conds li.no{color:var(--dim)}
.tr-dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:4px;background:var(--red)}
.tr-conds li.ok .tr-dot{background:var(--green)}
.tr-side-f{font-size:11.5px;color:var(--dim);line-height:1.4}
.tr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.tr-ref{font-size:12px;color:var(--dim);line-height:1.5;margin-top:10px}
@media (max-width:640px){.tr-sides{grid-template-columns:1fr}}
`;
