"use client";
// app/watch/page.jsx
//
// Requires a real, free account to view (Aug 20) — a deliberate reversal
// of how this page started. It used to be genuinely public specifically
// so a skeptical visitor could check it with zero friction. Real
// decision now: anyone wanting to watch it live provides basic, free
// registration first, and that same account is what they upgrade from
// later, no second registration anywhere in the loop.
//
// The real content itself lives in WatchLiveContent.jsx, shared with the
// in-dashboard view for already-signed-in paid accounts, this file's own
// job is just the auth gate in front of it.
import { useSession } from "next-auth/react";
import WatchLiveContent from "../WatchLiveContent.jsx";

export default function WatchPage() {
  const { status } = useSession(); // "loading" | "authenticated" | "unauthenticated"

  if (status === "loading") {
    return (
      <div className="watch-page">
        <style>{GATE_CSS}</style>
        <div className="watch-gate-boot">Setpoint</div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="watch-page">
        <style>{GATE_CSS}</style>
        <a href="/" className="watch-back">← Back to Setpoint</a>
        <div className="watch-hero">
          <div className="watch-mark">S</div>
          <h1>Watch it live, free.</h1>
          <p>Every locked level, every real trade, win or lose. Create a free account to see it, no card needed. Upgrade whenever you want live signals on your own coins, same account, no re-registering.</p>
          <a className="watch-cta-btn" href="/?signup=watch">Create a free account</a>
          <a className="watch-gate-signin" href="/">Already have an account? Sign in →</a>
        </div>
      </div>
    );
  }

  return <WatchLiveContent />;
}

// Only the gate states need their own styling here, WatchLiveContent
// brings its own full CSS once someone's actually authenticated.
const GATE_CSS = `
  html, body { background: #0A0F0D; margin: 0; }
  :root{
    --bg:#0A0F0D; --panel:#0F1712; --text:#EAF2EE; --muted:#93A69D; --dim:#5E7168;
    --border:#223029; --green:#00D179;
  }
  *{box-sizing:border-box}
  .watch-page{background:var(--bg);color:var(--text);font-family:-apple-system,Inter,system-ui,sans-serif;min-height:100vh;max-width:900px;margin:0 auto;padding:0 0 60px}
  .watch-hero{padding:44px 22px 28px;text-align:center;border-bottom:1px solid var(--border)}
  .watch-back{display:inline-block;color:var(--muted);font-size:13px;text-decoration:none;padding:16px 22px 0;transition:color .15s}
  .watch-back:hover{color:var(--text)}
  .watch-mark{width:40px;height:40px;border-radius:11px;background:var(--green);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#03110B;font-size:19px}
  .watch-hero h1{font-size:26px;margin:0 0 8px}
  .watch-hero p{color:var(--muted);font-size:14px;margin:0 auto;max-width:460px;line-height:1.5}
  .watch-cta-btn{display:inline-block;background:var(--green);color:#03110B;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;text-decoration:none}
  .watch-cta-btn:hover{background:#00e884}
  .watch-gate-boot{max-width:900px;margin:80px auto;text-align:center;color:var(--muted);font-family:'Bricolage Grotesque';font-weight:700}
  .watch-gate-signin{display:block;color:var(--muted);font-size:13px;margin-top:18px;text-decoration:none}
  .watch-gate-signin:hover{color:var(--text)}
`;
