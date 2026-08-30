"use client";
// app/privacy/page.jsx
//
// Kept deliberately simple, per direct request. This is a real, working
// starting point, not a substitute for actual legal review, worth having
// a lawyer look at before serious marketing spend, especially given real
// payments and account data are involved.
export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <style>{CSS}</style>
      <a href="/" className="legal-back">← Back to Setpoint</a>
      <div className="legal-body">
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated August 2026</p>

        <h2>What we collect</h2>
        <p>Your email address and password (stored securely, never in plain text) when you create an account. Your watchlist and coin preferences. If you turn on browser alerts, a real device subscription token so we can send them. Payment is handled entirely by Stripe, we never see or store your card details ourselves.</p>

        <h2>How we use it</h2>
        <p>To run your account, show your dashboard, process billing through Stripe, and, if you've turned them on, browser push notifications for your own verified alerts.</p>

        <h2>What we don't do</h2>
        <p>We don't sell your data. We don't share it with advertisers. We don't use it for anything beyond running the actual product.</p>

        <h2>Third parties involved</h2>
        <p>We use real, established third parties for payment processing, hosting and infrastructure, and market data. Each handles data under their own privacy policies.</p>

        <h2>Your data, your control</h2>
        <p>Want your account and data deleted? <a href="/contact">Reach out</a> and we'll take care of it.</p>

        <h2>Changes</h2>
        <p>This policy may be updated as Setpoint changes. Material changes will be reflected here with an updated date.</p>
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
