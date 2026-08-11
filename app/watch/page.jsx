"use client";
// app/watch/page.jsx
//
// Public, no login, no password. The entire point of this page is "don't
// take our word for it", it only works if literally anyone can land here
// and see it for themselves.
//
// The headline number is the real win rate of verified setups only, the
// ones actually promoted to customers. A blended average across verified
// and still-being-tested setups together would be a real, honest number
// too, but it wouldn't answer the actual question a visitor has, "how
// good is what Setpoint sells." Testing-stage setups exist precisely
// because they haven't proven themselves yet, folding them into the same
// average misrepresents both, it makes the verified setups look worse
// than they are and makes testing setups look more finished than they
// are. The full feed below still shows every resolved trade, verified
// and testing both, wins and losses both, each one tagged so it's always
// clear which is which. Nothing is hidden, it's just not blurred
// together into one misleading number.
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
  const testingPct = data?.testingWinRate != null ? Math.round(data.testingWinRate * 100) : null;

  return (
    <div className="watch-page">
      <style>{CSS}</style>

      <div className="watch-hero">
        <div className="watch-mark">S</div>
        <h1>Watch It Live</h1>
        <p>The real, live win rate of Setpoint's verified setups, the ones actually promoted to customers. Resolved automatically against real price, nothing hand-picked.</p>
      </div>

      {error && <div className="watch-empty">{error}</div>}

      {data && (
        <>
          <div className="watch-stat-row">
            <div className="watch-donut-wrap">
              <svg viewBox="0 0 36 36" className="watch-donut">
                <circle cx="18" cy="18" r="15.9" className="donut-bg" />
                {winRatePct != null && (
                  <circle
                    cx="18" cy="18" r="15.9"
                    className="donut-fg"
                    strokeDasharray={`${winRatePct} 100`}
                  />
                )}
              </svg>
              <div className="watch-donut-label">
                <div className="watch-big-num">{winRatePct != null ? `${winRatePct}%` : "—"}</div>
                <div className="watch-big-sub">verified win rate</div>
              </div>
            </div>
            <div className="watch-stat-legend">
              <div className="watch-legend-row"><span className="dot win" /> {data.verifiedWins} wins</div>
              <div className="watch-legend-row"><span className="dot loss" /> {data.verifiedLosses} losses</div>
              <div className="watch-legend-total">{data.verifiedTotal} verified trades resolved, all-time, real price, no exceptions.</div>
            </div>
          </div>

          {data.testingTotal > 0 && (
            <div className="watch-testing-note">
              Setpoint is also actively testing {data.testingTotal} additional setup{data.testingTotal === 1 ? "" : "s"} that {data.testingTotal === 1 ? "hasn't" : "haven't"} earned verified status yet ({testingPct}% so far), that's exactly why they're not verified, and why they're not counted in the number above. Still visible in the feed below.
            </div>
          )}

          <div className="watch-feed-head">Live feed, most recent first</div>
          {data.recent.length === 0 ? (
            <div className="watch-empty">Nothing resolved yet. Check back soon.</div>
          ) : (
            <div className="watch-feed">
              {data.recent.map((t, i) => (
                <div className={`watch-row ${t.outcome}`} key={i}>
                  <span className="watch-row-coin">{t.coin}</span>
                  <span className="watch-row-name">{t.dir === "bull" ? "Buy" : "Sell"} {t.name}</span>
                  <span className={`watch-row-status ${t.verified ? "verified" : "testing"}`}>{t.verified ? "Verified" : "Testing"}</span>
                  <span className={`watch-row-outcome ${t.outcome}`}>{t.outcome === "win" ? "WIN" : "LOSS"}</span>
                  <span className="watch-row-time">{new Date(t.resolvedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="watch-foot">Updates automatically every 30 seconds. This is context, not financial advice.</div>
    </div>
  );
}

const CSS = `
  :root{
    --bg:#0A0F0D; --panel:#0F1712; --panel2:#0D1310; --text:#EAF2EE; --muted:#93A69D; --dim:#5E7168;
    --border:#223029; --green:#00D179; --red:#FF5C6C; --amber:#F5B851;
  }
  *{box-sizing:border-box}
  .watch-page{background:var(--bg);color:var(--text);font-family:-apple-system,Inter,system-ui,sans-serif;min-height:100vh;max-width:640px;margin:0 auto;padding:0 0 60px}
  .watch-hero{padding:44px 22px 28px;text-align:center;border-bottom:1px solid var(--border)}
  .watch-mark{width:40px;height:40px;border-radius:11px;background:var(--green);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#03110B;font-size:19px}
  .watch-hero h1{font-size:23px;margin:0 0 8px}
  .watch-hero p{color:var(--muted);font-size:14px;margin:0 auto;max-width:420px;line-height:1.5}
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
  .watch-legend-total{font-size:12px;color:var(--dim);max-width:220px;margin-top:4px}
  .watch-testing-note{margin:0 22px 24px;padding:12px 14px;background:var(--panel);border:1px solid var(--border);border-radius:10px;font-size:12px;color:var(--muted);line-height:1.5}
  .watch-feed-head{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:0 22px;margin-bottom:10px}
  .watch-feed{padding:0 22px;display:flex;flex-direction:column;gap:6px}
  .watch-row{display:grid;grid-template-columns:44px 1fr auto auto auto;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--dim);border-radius:10px;padding:10px 12px;font-size:12.5px}
  .watch-row.win{border-left-color:var(--green)}
  .watch-row.loss{border-left-color:var(--red)}
  .watch-row-coin{font-weight:700}
  .watch-row-name{color:var(--muted)}
  .watch-row-status{font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:2px 6px;border-radius:5px}
  .watch-row-status.verified{color:var(--green);background:rgba(0,209,121,.12)}
  .watch-row-status.testing{color:var(--amber);background:rgba(245,184,81,.12)}
  .watch-row-outcome{font-weight:700;font-size:11px;letter-spacing:.04em}
  .watch-row-outcome.win{color:var(--green)}
  .watch-row-outcome.loss{color:var(--red)}
  .watch-row-time{color:var(--dim);font-size:10.5px;white-space:nowrap}
  .watch-empty{text-align:center;color:var(--muted);padding:40px 22px;font-size:13px}
  .watch-foot{text-align:center;color:var(--dim);font-size:11px;padding:28px 22px 0}
  @media(max-width:480px){
    .watch-row{grid-template-columns:36px 1fr auto;grid-template-rows:auto auto}
    .watch-row-status,.watch-row-time{grid-column:2/3}
  }
`;
