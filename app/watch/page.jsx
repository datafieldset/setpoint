"use client";
// app/watch/page.jsx
//
// Public, no login, no password. This page exists to prove one specific
// thing: Setpoint's signals don't repaint. A level shown here was locked
// the moment the trade fired, the exit shown is always exactly the
// target (win) or the stop (loss), never a separate number assembled
// after the fact. Anyone can pull up their own chart and check every
// single one of these against real price history themselves.
//
// Only shows the 7 currently-verified setups, the ones actually sold to
// customers. Wins and losses both, real percentages, nothing hand-picked.
import { useEffect, useState } from "react";

export default function WatchPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/public-stats", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
        .then((json) => { if (alive) setData(json); })
        .catch(() => { if (alive) setError("Couldn't load live results right now."); });
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const winRatePct = data?.verifiedWinRate != null ? Math.round(data.verifiedWinRate * 100) : null;
  const fmtPrice = (n) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(n >= 1 ? 2 : 5));

  return (
    <div className="watch-page">
      <style>{CSS}</style>

      <a href="/" className="watch-back">← Back to Setpoint</a>

      <div className="watch-hero">
        <div className="watch-mark">S</div>
        <h1>We don't redraw.</h1>
        <p>Pull up your own chart. It'll match, every time. Every level below was locked the moment it fired.</p>
      </div>

      {error && <div className="watch-empty">{error}</div>}

      {data && (
        <>
          <div className="watch-stat-row">
            <div className="watch-donut-wrap">
              <svg viewBox="0 0 36 36" className="watch-donut">
                <circle cx="18" cy="18" r="15.9" className="donut-bg" />
                {winRatePct != null && (
                  <circle cx="18" cy="18" r="15.9" className="donut-fg" strokeDasharray={`${winRatePct} 100`} />
                )}
              </svg>
              <div className="watch-donut-label">
                <div className="watch-big-num">{winRatePct != null ? `${winRatePct}%` : "—"}</div>
                <div className="watch-big-sub">verified win rate</div>
              </div>
            </div>
            <div className="watch-stat-legend">
              <div className="watch-legend-row"><span className="dot win" /> {data.wins} wins</div>
              <div className="watch-legend-row"><span className="dot loss" /> {data.losses} losses</div>
              <div className="watch-legend-total">{data.verifiedTotal} trades, all 7 verified setups, all-time, real price, no exceptions.</div>
            </div>
          </div>

          <div className="watch-feed-head">Every trade, locked levels, most recent first</div>
          {data.recent.length === 0 ? (
            <div className="watch-empty">Nothing resolved yet. Check back soon.</div>
          ) : (
            <div className="watch-scroll">
              <div className="watch-grid">
                {data.recent.map((t, i) => (
                  <div className={`watch-card ${t.outcome}`} key={i}>
                    <div className="wc-top">
                      <span className="wc-coin">{t.coin}</span>
                      <span className="wc-name">{t.dir === "bull" ? "Buy" : "Sell"} {t.name}</span>
                      <span className={`wc-outcome ${t.outcome}`}>{t.outcome === "win" ? "WIN" : "LOSS"}</span>
                    </div>
                    <div className="wc-levels">
                      <div className="wc-level"><span className="wc-level-k">Entry</span><span className="wc-level-v mono">{fmtPrice(t.entry)}</span></div>
                      <div className="wc-arrow">→</div>
                      <div className="wc-level"><span className="wc-level-k">Exit</span><span className="wc-level-v mono">{fmtPrice(t.exit)}</span></div>
                      <div className={`wc-pct ${t.outcome}`}>{t.pctMove >= 0 ? "+" : ""}{t.pctMove.toFixed(2)}%</div>
                    </div>
                    <div className="wc-times">
                      <span>Fired {new Date(t.firedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      <span>Resolved {new Date(t.resolvedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="watch-cta">
            <h2>This is what verified actually means.</h2>
            <p>Every trade above, real, resolved, checkable against your own chart. Get these on your own dashboard, live, the moment they fire.</p>
            <a className="watch-cta-btn" href="/#pricing">Start free, no card needed</a>
          </div>
        </>
      )}

      <div className="watch-foot">Updates automatically every 30 seconds. This is context, not financial advice.</div>
    </div>
  );
}

const CSS = `
  html, body {
    background: #0A0F0D;
    margin: 0;
  }
  :root{
    --bg:#0A0F0D; --panel:#0F1712; --panel2:#0D1310; --text:#EAF2EE; --muted:#93A69D; --dim:#5E7168;
    --border:#223029; --green:#00D179; --red:#FF5C6C;
  }
  *{box-sizing:border-box}
  .mono{font-family:'JetBrains Mono',monospace}
  .watch-page{background:var(--bg);color:var(--text);font-family:-apple-system,Inter,system-ui,sans-serif;min-height:100vh;max-width:900px;margin:0 auto;padding:0 0 60px}
  .watch-hero{padding:44px 22px 28px;text-align:center;border-bottom:1px solid var(--border)}
  .watch-back{display:inline-block;color:var(--muted);font-size:13px;text-decoration:none;padding:16px 22px 0;transition:color .15s}
  .watch-back:hover{color:var(--text)}
  .watch-mark{width:40px;height:40px;border-radius:11px;background:var(--green);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#03110B;font-size:19px}
  .watch-hero h1{font-size:26px;margin:0 0 8px}
  .watch-hero p{color:var(--muted);font-size:14px;margin:0 auto;max-width:460px;line-height:1.5}
  .watch-stat-row{display:flex;align-items:center;gap:28px;padding:32px 22px 20px;flex-wrap:wrap;justify-content:center}
  .watch-donut-wrap{position:relative;width:150px;height:150px;flex-shrink:0}
  .watch-donut{width:100%;height:100%;transform:rotate(-90deg)}
  .donut-bg{fill:none;stroke:var(--panel2);stroke-width:3}
  .donut-fg{fill:none;stroke:var(--green);stroke-width:3;stroke-linecap:round;transition:stroke-dasharray .4s ease}
  .watch-donut-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .watch-big-num{font-size:30px;font-weight:800}
  .watch-big-sub{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .watch-stat-legend{display:flex;flex-direction:column;gap:8px}
  .watch-legend-row{font-size:14px;display:flex;align-items:center;gap:8px}
  .dot{width:9px;height:9px;border-radius:50%;display:inline-block}
  .dot.win{background:var(--green)}
  .dot.loss{background:var(--red)}
  .watch-legend-total{font-size:12px;color:var(--dim);max-width:240px;margin-top:4px}
  .watch-feed-head{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:0 22px;margin-bottom:12px}
  .watch-scroll{padding:0 22px;max-height:400px;overflow-y:auto;border-radius:12px}
  .watch-scroll::-webkit-scrollbar{width:8px}
  .watch-scroll::-webkit-scrollbar-track{background:transparent}
  .watch-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
  .watch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;padding-bottom:4px}
  .watch-cta{margin:32px 22px 0;padding:28px 24px;background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--border);border-radius:16px;text-align:center}
  .watch-cta h2{font-size:19px;margin:0 0 8px}
  .watch-cta p{color:var(--muted);font-size:13.5px;margin:0 auto 18px;max-width:400px;line-height:1.5}
  .watch-cta-btn{display:inline-block;background:var(--green);color:#03110B;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;text-decoration:none}
  .watch-cta-btn:hover{background:#00e884}
  .watch-card{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--dim);border-radius:12px;padding:14px}
  .watch-card.win{border-left-color:var(--green)}
  .watch-card.loss{border-left-color:var(--red)}
  .wc-top{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .wc-coin{font-weight:800;font-size:14px}
  .wc-name{color:var(--muted);font-size:12.5px;flex:1}
  .wc-outcome{font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:5px}
  .wc-outcome.win{color:var(--green);background:rgba(0,209,121,.12)}
  .wc-outcome.loss{color:var(--red);background:rgba(255,92,108,.12)}
  .wc-levels{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .wc-level{display:flex;flex-direction:column;gap:1px}
  .wc-level-k{font-size:9.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}
  .wc-level-v{font-size:13px;font-weight:600}
  .wc-arrow{color:var(--dim);font-size:12px}
  .wc-pct{margin-left:auto;font-weight:800;font-size:14px}
  .wc-pct.win{color:var(--green)}
  .wc-pct.loss{color:var(--red)}
  .wc-times{display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--dim);border-top:1px solid var(--border);padding-top:8px}
  .watch-empty{text-align:center;color:var(--muted);padding:40px 22px;font-size:13px}
  .watch-foot{text-align:center;color:var(--dim);font-size:11px;padding:28px 22px 0}
`;
