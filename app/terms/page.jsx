"use client";
// app/terms/page.jsx
//
// Kept deliberately simple, per direct request. This is a real, working
// starting point, not a substitute for actual legal review, worth having
// a lawyer look at before serious marketing spend, especially given real
// payments are involved.
export default function TermsPage() {
  return (
    <div className="legal-page">
      <style>{CSS}</style>
      <a href="/" className="legal-back">← Back to Setpoint</a>
      <div className="legal-body">
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated August 2026</p>

        <h2>What Setpoint is</h2>
        <p>Setpoint is an informational dashboard showing real-time cryptocurrency market signals, checked against real, historical price data. Setpoint is not a broker, does not execute trades, hold funds, or provide financial advice. Levels shown are computed reference points, not recommendations. Cryptocurrency markets are volatile, and any decisions you make based on information from Setpoint are your own responsibility.</p>

        <h2>Accounts</h2>
        <p>You need a real account to use Setpoint's dashboard. You're responsible for keeping your login secure and for anything that happens under your account.</p>

        <h2>Subscriptions and billing</h2>
        <p>Paid plans bill monthly through Stripe. You can cancel any time from your dashboard, cancellation stops future billing but you keep access through the end of the period you already paid for, no partial refunds for time already billed.</p>

        <h2>No financial advice</h2>
        <p>Nothing on Setpoint is financial, investment, or trading advice. Signals are computed, backtested indicators, not guarantees, and past performance never guarantees future results.</p>

        <h2>Acceptable use</h2>
        <p>Don't use Setpoint to break the law, attempt to access other accounts, or interfere with the service.</p>

        <h2>Changes</h2>
        <p>These terms may be updated as Setpoint changes. Material changes will be reflected here with an updated date.</p>

        <h2>Contact</h2>
        <p>Questions about these terms: <a href="/contact">get in touch</a>.</p>
      </div>
    </div>
  );
}

const CSS = `
  html, body { background: #0A0F0D; margin: 0; }
  :root{ --bg:#0A0F0D; --text:#EAF2EE; --muted:#93A69D; --border:#223029; --green:#00D179; }
  *{box-sizing:border-box}
  .legal-page{background:var(--bg);color:var(--text);font-family:-apple-system,Inter,system-ui,sans-serif;min-height:100vh;max-width:640px;margin:0 auto;padding:0 22px 60px}
  .legal-back{display:inline-block;color:var(--muted);font-size:13px;text-decoration:none;padding:16px 0 0}
  .legal-back:hover{color:var(--text)}
  .legal-body{padding-top:24px}
  .legal-body h1{font-size:26px;margin:0 0 4px}
  .legal-updated{color:var(--muted);font-size:12.5px;margin:0 0 32px}
  .legal-body h2{font-size:16px;margin:28px 0 8px}
  .legal-body p{color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 4px}
  .legal-body a{color:var(--green)}
`;
