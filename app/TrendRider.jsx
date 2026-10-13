"use client";
// app/TrendRider.jsx
//
// The Trend Rider panel (v19.23). Public. One Bitcoin signal on six
// timeframes, each with its own live scoreboard: win rate, wins and losses,
// average result, updated from real closed trades. Pick a timeframe to see
// what it's waiting for, any open trade with its trailing stop, and its
// history. While focus mode is on this is the only signal on the dashboard.
import { useEffect, useState } from "react";

const money = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const fmtR = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`);
const pct = (n) => (n == null ? "—" : `${n}%`);
const dayTime = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const away = (price, level) => (price && level ? Math.abs((level / price - 1) * 100).toFixed(1) + "%" : null);
const BREAK_EVEN = 34; // win rate where a 2-to-1 trade payoff breaks even

function Check({ ok, children }) {
  return (
    <li className={ok ? "ok" : "no"}>
      <span className="tr-dot" aria-hidden="true" />
      <span className="sr">{ok ? "Met: " : "Not met: "}</span>
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
        <b>{title}</b> if price touches <span className="mono">{money(level)}</span>
        {dist && <span className="tr-dist"> ({dist} away)</span>}
      </div>
      <ul className="tr-conds">
        {conds.map((c) => <Check key={c.key} ok={c.ok}>{c.label}</Check>)}
      </ul>
      <div className="tr-side-f">{met === conds.length ? "Every check is green. It fires the moment price touches the level." : `${met} of ${conds.length} checks green. All must be green when price touches the level.`}</div>
    </div>
  );
}

export default function TrendRider() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState("4h");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/trend", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
        .then((j) => { if (alive) { setD(j); setErr(null); } })
        .catch(() => { if (alive) setErr("Couldn't load Trend Rider right now."); });
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const cur = d?.tfs?.[sel];

  return (
    <section className="tr-panel">
      <style>{CSS}</style>
      <div className="tr-head">
        <h2 className="tr-title">Trend Rider</h2>
        <span className="tr-pill">test</span>
        <span className="tr-sub">Bitcoin · six timeframes · scoreboard updates as trades close</span>
      </div>

      {err && <div className="tr-note tr-err">{err}</div>}
      {!d && !err && <div className="tr-note">Loading…</div>}

      {d && (
        <>
          <div className="tr-tiles" role="tablist" aria-label="Timeframe">
            {d.order.map((k) => {
              const t = d.tfs[k];
              const all = t.record.all;
              const live = t.open.length > 0;
              return (
                <button key={k} role="tab" aria-selected={sel === k} className={`tr-tile ${sel === k ? "on" : ""}`} onClick={() => setSel(k)}>
                  <span className="tr-tile-top">
                    <span className="tr-tile-tf">{k}</span>
                    {live && <span className="tr-live">open</span>}
                  </span>
                  <span className="tr-tile-win">{pct(all.winPct)}</span>
                  <span className="tr-tile-sub">{all.trades ? `${all.wins} won · ${all.losses} lost` : "no trades yet"}</span>
                  <span className="tr-bar" aria-hidden="true">
                    <span className="tr-bar-fill" style={{ width: `${all.winPct ?? 0}%` }} />
                    <span className="tr-bar-tick" style={{ left: `${BREAK_EVEN}%` }} />
                  </span>
                  <span className="tr-tile-avg">{all.trades ? `${fmtR(all.avgR)} avg` : t.alerts ? "alerts on" : "tracking only"}</span>
                </button>
              );
            })}
          </div>
          <div className="tr-legend">Bar = win rate. The tick marks 34%, the win rate where these 2-to-1 trades break even.</div>

          {cur && (
            <div className="tr-detail">
              <div className="tr-detail-h">
                <h3>{cur.label}</h3>
                <span className="tr-sub">{cur.alerts ? "Admin alerts on" : "Tracking only, no alerts yet"} · Bitcoin now <span className="mono">{money(cur.watch?.price ?? d.price)}</span></span>
              </div>

              {cur.error && <div className="tr-note tr-err">This timeframe couldn't load just now. It retries on its own.</div>}

              {cur.open.map((p) => (
                <div key={p.id} className={`tr-trade ${p.dir}`}>
                  <div className="tr-trade-top">
                    <span className="tr-dir">{p.dir === "long" ? "Buy" : "Sell"} open</span>
                    <span className="tr-since">since {dayTime(p.openedAt)}</span>
                    <span className={`tr-now ${p.openR >= 0 ? "pos" : "neg"}`}>{fmtR(p.openR)} now</span>
                  </div>
                  <div className="tr-levels">
                    <div><span className="k">Entry</span><span className="v mono">{money(p.entry)}</span></div>
                    <div><span className="k">Trailing stop</span><span className="v mono">{money(p.stop)}</span></div>
                    <div><span className="k">Price</span><span className="v mono">{money(cur.watch?.price ?? d.price)}</span></div>
                  </div>
                  <div className="tr-note">No target. The stop follows price {p.dir === "long" ? "up" : "down"} and never backs off. The trade ends when price hits it.</div>
                </div>
              ))}

              {cur.watch ? (
                <div className="tr-waiting">
                  <div className="tr-state-h">{cur.open.length ? "Watching for the next one" : "Waiting for a breakout"}</div>
                  <div className="tr-sides">
                    <Side title="Buy" dir="long" level={cur.watch.buy.level} price={cur.watch.price} conds={cur.watch.buy.conds} />
                    <Side title="Sell" dir="short" level={cur.watch.sell.level} price={cur.watch.price} conds={cur.watch.sell.conds} />
                  </div>
                </div>
              ) : (
                !cur.error && <div className="tr-note">Still gathering enough candles to set the levels.</div>
              )}

              <div className="tr-record">
                <div className="tr-rec-h">Real results on {cur.label}</div>
                <div className="tr-rec-grid">
                  {[["Buys", cur.record.buys, cur.ref?.buys], ["Sells", cur.record.sells, cur.ref?.sells]].map(([nm, r, ref]) => (
                    <div key={nm} className="tr-rec-card">
                      <div className="tr-rec-nm">{nm}</div>
                      <div className="tr-rec-win">{pct(r.winPct)}<small> win rate</small></div>
                      <div className="tr-rec-sub">{r.trades ? `${r.wins} won, ${r.losses} lost · ${fmtR(r.avgR)} avg` : "no closed trades yet"}</div>
                      {ref && <div className="tr-rec-ref">History test: {ref.winPct}% wins, {fmtR(ref.avgR)} avg ({ref.window})</div>}
                    </div>
                  ))}
                </div>
                {(cur.record.crowd.fearful.trades > 0 || cur.record.crowd.greedy.trades > 0) && (
                  <div className="tr-note">
                    By crowd mood when it fired: fearful or neutral {pct(cur.record.crowd.fearful.winPct)} ({cur.record.crowd.fearful.trades} trades), greedy {pct(cur.record.crowd.greedy.winPct)} ({cur.record.crowd.greedy.trades} trades).
                  </div>
                )}
                {cur.closed.length > 0 && (
                  <div className="tr-hist">
                    {cur.closed.map((c) => (
                      <div key={c.id} className="tr-hist-row">
                        <span className="tr-hist-dir">{c.dir === "long" ? "Buy" : "Sell"}</span>
                        <span className="mono">{money(c.entry)} → {money(c.exit)}</span>
                        <span className={`tr-hist-r ${c.r >= 0 ? "pos" : "neg"}`}>{fmtR(c.r)}</span>
                        <span className="tr-hist-when">{dayTime(c.closedAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="tr-expect">
            <b>What to expect.</b> About 4 in 10 trades win, and the winners run longer than the losers cost, so a few big wins carry it with a string of small losses between. The slower charts (4 hour, 1 hour) held up over 6 years of history. The faster ones only have months of history behind them, so treat 30 minute and below as experiments. Every number above is real trades from now on, starting at zero.
          </div>
        </>
      )}
    </section>
  );
}

const CSS = `
.tr-panel{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:18px 18px 16px;max-width:860px}
.tr-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 10px;margin-bottom:14px}
.tr-title{font-family:'Bricolage Grotesque';font-size:22px;font-weight:700;margin:0}
.tr-pill{font-size:11px;font-weight:600;color:var(--amber);background:rgba(232,176,74,.12);padding:2px 8px;border-radius:999px}
.tr-sub{font-size:12px;color:var(--dim)}
.tr-tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
.tr-tile{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;background:var(--panel3);border:1px solid var(--border);border-radius:10px;padding:9px 10px 8px;color:inherit;cursor:pointer;font:inherit;min-width:0}
.tr-tile:hover{border-color:var(--muted)}
.tr-tile:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.tr-tile.on{border-color:var(--amber);background:var(--panel2);box-shadow:inset 0 0 0 1px var(--amber)}
.tr-tile-top{display:flex;justify-content:space-between;align-items:center;width:100%}
.tr-tile-tf{font-size:12px;font-weight:700;color:var(--muted)}
.tr-live{font-size:10px;font-weight:700;color:var(--green)}
.tr-tile-win{font-family:'Bricolage Grotesque';font-size:24px;font-weight:700;line-height:1.05;font-variant-numeric:tabular-nums}
.tr-tile-sub{font-size:11px;color:var(--dim);line-height:1.3}
.tr-bar{position:relative;display:block;width:100%;height:4px;background:var(--hair);border-radius:2px;margin:3px 0 1px}
.tr-bar-fill{position:absolute;left:0;top:0;bottom:0;background:var(--green);border-radius:2px}
.tr-bar-tick{position:absolute;top:-2px;bottom:-2px;width:1.5px;background:var(--muted)}
.tr-tile-avg{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.tr-legend{font-size:11px;color:var(--dim);margin:7px 0 14px}
.tr-detail{border-top:1px solid var(--hair);padding-top:14px}
.tr-detail-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;margin-bottom:10px}
.tr-detail-h h3{font-family:'Bricolage Grotesque';font-size:18px;font-weight:700;margin:0}
.tr-state-h{font-size:15px;font-weight:600;margin:8px 0}
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
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.tr-trade{border:1px solid var(--border);border-left:3px solid var(--green);border-radius:10px;padding:12px 14px;margin-bottom:8px}
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
.tr-rec-h{font-size:12px;color:var(--muted);margin-bottom:8px}
.tr-rec-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px}
.tr-rec-card{background:var(--panel3);border-radius:10px;padding:10px 12px}
.tr-rec-nm{font-size:12px;font-weight:600;color:var(--muted)}
.tr-rec-win{font-family:'Bricolage Grotesque';font-size:26px;font-weight:700;line-height:1.1}
.tr-rec-win small{font-family:inherit;font-size:12px;font-weight:400;color:var(--dim)}
.tr-rec-sub{font-size:12.5px;margin-top:2px}
.tr-rec-ref{font-size:11.5px;color:var(--dim);margin-top:4px}
.tr-hist{margin-top:10px;display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto}
.tr-hist-row{display:grid;grid-template-columns:44px 1fr auto auto;gap:10px;font-size:12.5px;align-items:baseline}
.tr-hist-dir{font-weight:600}
.tr-hist-r{font-weight:700;font-variant-numeric:tabular-nums}
.tr-hist-when{color:var(--dim);font-size:11.5px;text-align:right}
.tr-expect{margin-top:16px;padding:10px 12px;background:var(--panel3);border-radius:10px;font-size:12.5px;line-height:1.55;color:var(--muted)}
.tr-panel .pos{color:var(--green)}
.tr-panel .neg{color:var(--red)}
@media (max-width:720px){.tr-tiles{grid-template-columns:repeat(3,1fr)}.tr-sides,.tr-rec-grid{grid-template-columns:1fr}}
@media (max-width:520px){.tr-hist-row{grid-template-columns:40px 1fr auto}.tr-hist-when{display:none}.tr-tile-win{font-size:21px}}
`;
