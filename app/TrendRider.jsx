"use client";
// app/TrendRider.jsx
//
// The Trend Rider panel (v19.21). Admin-only test of a slow Bitcoin trend
// signal. Shows what it's waiting for, the open trade with its trailing
// stop, and the real forward record. While focus mode is on this is the
// only signal on the dashboard.
import { useEffect, useState } from "react";

const money = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const fmtR = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`);
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dayTime = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function TrendRider() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/trend", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
        .then((j) => { if (alive) { setD(j); setErr(null); } })
        .catch(() => { if (alive) setErr("Couldn't load Trend Rider right now."); });
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const t = d?.triggers;
  const open = d?.open || [];
  const rec = d?.record;

  return (
    <section className="tr-panel">
      <style>{CSS}</style>
      <div className="tr-head">
        <h2 className="tr-title">Trend Rider</h2>
        <span className="tr-pill">test</span>
        <span className="tr-sub">Bitcoin · 4-hour candles</span>
      </div>

      {err && <div className="tr-note tr-err">{err}</div>}
      {!d && !err && <div className="tr-note">Loading…</div>}

      {d && (
        <>
          {open.length === 0 ? (
            <div className="tr-state">
              <div className="tr-state-h">Waiting for a breakout.</div>
              {t ? (
                <ul className="tr-watch">
                  <li className={t.longAllowed ? "" : "off"}>
                    <b>Buy</b> if a 4-hour candle closes above <span className="mono">{money(t.longTrigger)}</span>.
                    {!t.longAllowed && <span className="tr-why"> Not allowed now: price is under its 200-day average.</span>}
                  </li>
                  <li className={t.shortAllowed ? "" : "off"}>
                    <b>Sell</b> if a 4-hour candle closes below <span className="mono">{money(t.shortTrigger)}</span>.
                    {!t.shortAllowed && <span className="tr-why"> Not allowed now: price is above its 200-day average of <span className="mono">{money(t.sma)}</span>.</span>}
                  </li>
                </ul>
              ) : (
                <div className="tr-note">Still gathering enough candles to set the levels.</div>
              )}
              <div className="tr-price">Bitcoin now <span className="mono">{money(d.price)}</span></div>
            </div>
          ) : (
            open.map((p) => (
              <div key={p.id} className={`tr-trade ${p.dir}`}>
                <div className="tr-trade-top">
                  <span className="tr-dir">{p.dir === "long" ? "Buy" : "Sell"} open</span>
                  <span className="tr-since">since {dayTime(p.openedAt)}</span>
                  <span className={`tr-now ${p.openR >= 0 ? "pos" : "neg"}`}>{fmtR(p.openR)} now</span>
                </div>
                <div className="tr-levels">
                  <div><span className="k">Entry</span><span className="v mono">{money(p.entry)}</span></div>
                  <div><span className="k">Trailing stop</span><span className="v mono">{money(p.stop)}</span></div>
                  <div><span className="k">Price</span><span className="v mono">{money(d.price)}</span></div>
                </div>
                <div className="tr-note">No target. The stop follows price {p.dir === "long" ? "up" : "down"} and never backs off. The trade ends when price hits it.</div>
              </div>
            ))
          )}

          <div className="tr-record">
            <div className="tr-rec-h">Real results so far</div>
            {rec && rec.trades > 0 ? (
              <div className="tr-rec-line">
                {rec.trades} closed, {rec.wins} won. Total <b className={rec.totalR >= 0 ? "pos" : "neg"}>{fmtR(rec.totalR)}</b>, average {fmtR(rec.avgR)} a trade.
              </div>
            ) : (
              <div className="tr-note">No closed trades yet. The first result lands here when a trade is stopped out.</div>
            )}
            {d.closed.length > 0 && (
              <div className="tr-hist">
                {d.closed.map((c) => (
                  <div key={c.id} className="tr-hist-row">
                    <span className="tr-hist-dir">{c.dir === "long" ? "Buy" : "Sell"}</span>
                    <span className="mono">{money(c.entry)} → {money(c.exit)}</span>
                    <span className={`tr-hist-r ${c.r >= 0 ? "pos" : "neg"}`}>{fmtR(c.r)}</span>
                    <span className="tr-hist-when">{day(c.openedAt)} to {day(c.closedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="tr-expect">
            <b>What to expect.</b> About 4 in 10 trades win, and winners run longer than losers cost. A few big wins carry it, with a string of small losses in between. Over 6 years of Bitcoin history it averaged +0.35R a buy, but in the last 2 calmer years it was close to zero. That's why this is a test. A signal fires a few times a month, not a day.
          </div>
        </>
      )}
    </section>
  );
}

const CSS = `
.tr-panel{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:18px 18px 16px;max-width:720px}
.tr-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 10px;margin-bottom:12px}
.tr-title{font-family:'Bricolage Grotesque';font-size:22px;font-weight:700;margin:0}
.tr-pill{font-size:11px;font-weight:600;color:var(--amber);background:rgba(232,176,74,.12);padding:2px 8px;border-radius:999px}
.tr-sub{font-size:12px;color:var(--dim)}
.tr-state-h{font-size:16px;font-weight:600;margin-bottom:8px}
.tr-watch{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.45}
.tr-watch li.off{color:var(--dim)}
.tr-why{font-size:12.5px}
.tr-price{font-size:13px;color:var(--muted)}
.tr-trade{border:1px solid var(--border);border-left:3px solid var(--green);border-radius:10px;padding:12px 14px;margin-bottom:6px}
.tr-trade.short{border-left-color:var(--red)}
.tr-trade-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.tr-dir{font-weight:700;font-size:15px}
.tr-since{font-size:12px;color:var(--dim);flex:1}
.tr-now{font-weight:700;font-variant-numeric:tabular-nums}
.tr-levels{display:flex;gap:22px;flex-wrap:wrap;margin-bottom:8px}
.tr-levels .k{display:block;font-size:11px;color:var(--dim)}
.tr-levels .v{font-size:15px;font-weight:600}
.tr-note{font-size:12.5px;color:var(--dim);line-height:1.5}
.tr-err{color:var(--red)}
.tr-record{margin-top:16px;padding-top:14px;border-top:1px solid var(--hair)}
.tr-rec-h{font-size:12px;color:var(--muted);margin-bottom:6px}
.tr-rec-line{font-size:14px}
.tr-hist{margin-top:10px;display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto}
.tr-hist-row{display:grid;grid-template-columns:44px 1fr auto auto;gap:10px;font-size:12.5px;align-items:baseline}
.tr-hist-dir{font-weight:600}
.tr-hist-r{font-weight:700;font-variant-numeric:tabular-nums}
.tr-hist-when{color:var(--dim);font-size:11.5px;text-align:right}
.tr-expect{margin-top:16px;padding:10px 12px;background:var(--panel3);border-radius:10px;font-size:12.5px;line-height:1.55;color:var(--muted)}
.tr-panel .pos{color:var(--green)}
.tr-panel .neg{color:var(--red)}
@media (max-width:520px){.tr-hist-row{grid-template-columns:40px 1fr auto}.tr-hist-when{display:none}}
`;
