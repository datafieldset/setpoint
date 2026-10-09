"use client";
// app/WatchLiveContent.jsx
//
// The real Watch It Live content, extracted (Aug 20) so it can render in
// two different places without duplicating it: the standalone /watch
// page (its own auth gate wraps this), and a real in-dashboard view for
// already-signed-in paid accounts, so a customer never has to leave the
// dashboard or open a new tab just to see it.
//
// Deliberately has no auth logic of its own. Whoever renders this is
// responsible for deciding whether the viewer should see it at all,
// /watch's own gate handles that for anonymous/free visitors, and the
// dashboard only ever reaches this component for accounts that already
// passed its own real plan check, never for a free "watch" account.
import { useEffect, useState } from "react";

const fmtPrice = (n) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(n >= 1 ? 2 : 5));
const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtTime = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function TradeCard({ t }) {
  return (
    <div className={`watch-card ${t.outcome}`}>
      <div className="wc-top">
        <span className="wc-coin">{t.coin}</span>
        <span className="wc-name">{t.dir === "bull" ? "Buy" : "Sell"} {t.name}</span>
        <span className="wc-tf">{t.tf}</span>
        <span className={`wc-outcome ${t.outcome}`}>{t.outcome === "win" ? "WIN" : "LOSS"}</span>
      </div>
      <div className="wc-levels">
        <div className="wc-level"><span className="wc-level-k">Entry</span><span className="wc-level-v mono">{fmtPrice(t.entry)}</span></div>
        <div className="wc-arrow">→</div>
        <div className="wc-level"><span className="wc-level-k">Exit</span><span className="wc-level-v mono">{fmtPrice(t.exit)}</span></div>
        <div className={`wc-pct ${t.outcome}`}>{t.pctMove >= 0 ? "+" : ""}{t.pctMove.toFixed(2)}%</div>
      </div>
      <div className="wc-times">
        <span>Fired {fmtTime(t.firedAt)}</span>
        <span>Resolved {fmtTime(t.resolvedAt)}</span>
      </div>
    </div>
  );
}

// One line per setup: what it is, its record in the window being
// counted, and when it last resolved a trade. This is what explains a
// quiet page: a setup that fires a few times a month shows up here as
// exactly that, instead of the page looking broken.
function SetupRow({ s }) {
  return (
    <div className="watch-setup">
      <span className="ws-name">{s.dir === "bull" ? "Buy" : "Sell"} {s.name}</span>
      <span className="wc-tf">{s.tf}</span>
      {s.regime && <span className="ws-regime">in {s.regime.replace("-", " ")} markets</span>}
      {s.verifiedNow === false && <span className="ws-slipped">under the bar now</span>}
      <span className="ws-rec">{s.wins} won, {s.losses} lost</span>
      <span className="ws-last">last {fmtDay(s.lastAt)}</span>
    </div>
  );
}

export default function WatchLiveContent({ onBack }) {
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
  const setups = data?.setups || [];
  const emerging = data?.emerging || { setups: [], recent: [] };
  const activeSetups = data?.activeSetups ?? setups.length;

  return (
    <div className="watch-page">
      <style>{CSS}</style>

      {onBack ? (
        <button className="watch-back watch-back-btn" onClick={onBack}>← Back to dashboard</button>
      ) : (
        <a href="/" className="watch-back">← Back to Setpoint</a>
      )}

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
              <div className="watch-legend-total">
                {data.verifiedTotal === 0
                  ? "No setup clears the verified bar right now."
                  : `${data.verifiedTotal} trades from ${activeSetups} setup${activeSetups === 1 ? "" : "s"}, each one verified at the moment it fired. Real prices, levels locked when each one fired.`}
              </div>
              {data.lastTradeAt && <div className="watch-legend-total">Latest verified trade: {fmtDay(data.lastTradeAt)}.</div>}
            </div>
          </div>

          {setups.length > 0 && (
            <section className="watch-section">
              <h2 className="watch-h">Verified setups</h2>
              <div className="watch-setups">
                {setups.map((s, i) => <SetupRow key={i} s={s} />)}
              </div>
              <p className="watch-note">
                Each setup counts its last 20 trades. A trade counts if its setup was verified when the trade fired, and it stays on the record even if the setup slips under the bar later. Those are marked. {data.stampedSince ? `Trades from before ${fmtDay(data.stampedSince)} were logged without that stamp, so they only count while their setup is verified today.` : ""}
              </p>
            </section>
          )}

          <section className="watch-section">
            <h2 className="watch-h">Verified trades, newest first</h2>
            {data.recent.length === 0 ? (
              <div className="watch-empty">Nothing resolved yet. Check back soon.</div>
            ) : (
              <div className="watch-scroll">
                <div className="watch-grid">
                  {data.recent.map((t, i) => <TradeCard key={i} t={t} />)}
                </div>
              </div>
            )}
          </section>

          {emerging.setups.length > 0 && (
            <section className="watch-section watch-emerging">
              <h2 className="watch-h">Emerging <span className="watch-pill">not verified</span></h2>
              <p className="watch-note">These are working lately, on fewer trades than a verified setup, so they're more likely to fade. They don't count toward the win rate above.</p>
              <div className="watch-setups">
                {emerging.setups.map((s, i) => <SetupRow key={i} s={s} />)}
              </div>
              {emerging.recent.length > 0 && (
                <div className="watch-scroll">
                  <div className="watch-grid">
                    {emerging.recent.map((t, i) => <TradeCard key={i} t={t} />)}
                  </div>
                </div>
              )}
            </section>
          )}

          {!onBack && (
            <div className="watch-cta">
              <h2>This is what verified actually means.</h2>
              <p>Every trade above, real, resolved, checkable against your own chart. Create a free account to save your spot, then upgrade whenever you're ready, live signals on your own coins.</p>
              <a className="watch-cta-btn" href="/?signup=watch">Create a free account</a>
              <a className="watch-cta-link" href="/#pricing">Or see plans and pricing →</a>
            </div>
          )}
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
    --border:#223029; --green:#00D179; --red:#FF5C6C; --amber:#E8B04A;
  }
  *{box-sizing:border-box}
  .mono{font-family:'JetBrains Mono',monospace}
  .watch-page{background:var(--bg);color:var(--text);font-family:-apple-system,Inter,system-ui,sans-serif;min-height:100vh;max-width:900px;margin:0 auto;padding:0 0 60px}
  .watch-hero{padding:44px 22px 28px;text-align:center;border-bottom:1px solid var(--border)}
  .watch-back{display:inline-block;color:var(--muted);font-size:13px;text-decoration:none;padding:16px 22px 0;transition:color .15s}
  .watch-back:hover{color:var(--text)}
  .watch-back-btn{background:none;border:none;cursor:pointer;font-family:inherit}
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
  .watch-scroll{padding:0 22px;max-height:400px;overflow-y:auto;border-radius:12px}
  .watch-scroll::-webkit-scrollbar{width:8px}
  .watch-scroll::-webkit-scrollbar-track{background:transparent}
  .watch-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
  .watch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;padding-bottom:4px}
  .watch-cta{margin:32px 22px 0;padding:28px 24px;background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--border);border-radius:16px;text-align:center}
  .watch-cta h2{font-size:19px;margin:0 0 8px}
  .watch-cta p{color:var(--muted);font-size:13.5px;margin:0 auto 18px;max-width:400px;line-height:1.5}
  .watch-cta-btn{display:inline-block;background:var(--green);color:#03110B;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;text-decoration:none}
  .watch-cta-link{display:block;color:var(--muted);font-size:12.5px;margin-top:14px;text-decoration:none}
  .watch-cta-link:hover{color:var(--text)}
  .watch-cta-btn:hover{background:#00e884}
  .watch-card{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--dim);border-radius:12px;padding:14px}
  .watch-card.win{border-left-color:var(--green)}
  .watch-card.loss{border-left-color:var(--red)}
  .wc-top{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .wc-coin{font-weight:800;font-size:14px}
  .wc-name{color:var(--muted);font-size:12.5px;flex:1}
  .wc-tf{font-size:10px;font-weight:700;color:var(--muted);background:var(--panel2);padding:2px 6px;border-radius:5px;letter-spacing:.02em}
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
  .watch-section{margin-top:28px}
  .watch-h{font-size:15px;font-weight:700;margin:0 0 10px;padding:0 22px}
  .watch-note{color:var(--dim);font-size:12.5px;line-height:1.55;margin:0 0 14px;padding:0 22px;max-width:62ch}
  .watch-setups{display:flex;flex-direction:column;gap:6px;padding:0 22px;margin-bottom:12px}
  .watch-setup{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px}
  .ws-name{font-weight:600;flex:1 1 150px}
  .ws-regime{color:var(--dim);font-size:11.5px}
  .ws-rec{font-weight:600;font-variant-numeric:tabular-nums}
  .ws-slipped{color:var(--amber);font-size:11.5px}
  .ws-last{color:var(--dim);font-size:11.5px;min-width:62px;text-align:right}
  .watch-emerging{margin-top:36px;padding-top:26px;border-top:1px solid var(--border)}
  .watch-emerging .watch-setup{border-left:3px solid var(--amber)}
  .watch-pill{margin-left:8px;font-size:11px;font-weight:600;color:var(--amber);background:rgba(232,176,74,.12);padding:2px 8px;border-radius:999px;vertical-align:1px}
`;
