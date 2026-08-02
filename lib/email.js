// lib/email.js
//
// Thin wrapper around Resend's REST API. No SDK dependency needed, it's
// one simple POST. Scoped deliberately narrow: account/registration
// emails only (welcome, plan confirmation), never alert delivery, that
// was explicitly dropped from scope.
//
// Requires RESEND_API_KEY as an environment variable. Until the sending
// domain is verified with Resend (a few DNS records added on
// setpointalerts.com's host), sends may fail or land in spam, that step
// happens outside this code. Every call here fails gracefully: a failed
// email never blocks the actual account action (registration, upgrade)
// that triggered it.
const FROM = "Setpoint <hello@setpointalerts.com>";

export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "no_api_key" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return { ok: false, reason: `resend_${r.status}`, detail: detail.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "network_error", detail: String(e.message || e).slice(0, 150) };
  }
}

export function welcomeEmailHtml(email) {
  return `
  <div style="font-family:-apple-system,sans-serif;background:#0A0F0D;color:#EAF2EE;padding:32px;border-radius:12px;max-width:480px;margin:0 auto">
    <div style="width:36px;height:36px;border-radius:10px;background:#00D179;display:flex;align-items:center;justify-content:center;font-weight:800;color:#03110B;font-size:17px;margin-bottom:20px">S</div>
    <h1 style="font-size:20px;margin:0 0 12px">Welcome to Setpoint</h1>
    <p style="color:#93A69D;font-size:14px;line-height:1.6;margin:0 0 16px">Your account is live. Every alert on your dashboard has already been tested against real, historical price data, only setups that have proven themselves show up by default.</p>
    <p style="color:#93A69D;font-size:14px;line-height:1.6;margin:0 0 20px">Head back to your dashboard any time at <a href="https://setpointalerts.com" style="color:#5EE9AE">setpointalerts.com</a>, and look for the GUIDE button if you want a quick walkthrough of how everything works.</p>
    <p style="color:#5E7168;font-size:12px;margin:0">You're receiving this because you just created an account with this email address.</p>
  </div>`;
}
