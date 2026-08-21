// lib/email.js
//
// Sends real account emails (welcome, plan confirmation) through Gmail
// itself, not Resend, Resend requires verifying a domain you control via
// DNS, and nobody can verify gmail.com since Google owns it. This sends
// straight through Gmail's own SMTP servers using nokanetmail@gmail.com
// as the real account, authenticated with a Gmail "App Password" (not
// the regular account password, Google blocks that for this).
//
// Requires two environment variables: GMAIL_USER (nokanetmail@gmail.com)
// and GMAIL_APP_PASSWORD (the 16-character app password from Google
// Account → Security → App passwords, needs 2-Step Verification turned
// on first).
//
// Scoped deliberately narrow: account/registration emails only, never
// alert delivery, that was explicitly dropped from scope.
import nodemailer from "nodemailer";

let cachedTransporter = null;
function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return cachedTransporter;
}

export async function sendEmail({ to, subject, html }) {
  const transporter = getTransporter();
  if (!transporter) return { ok: false, reason: "no_credentials" };
  try {
    await transporter.sendMail({
      from: `Setpoint <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "send_failed", detail: String(e.message || e).slice(0, 200) };
  }
}

export function welcomeEmailHtml(email) {
  return `
  <div style="font-family:-apple-system,sans-serif;background:#0A0F0D;color:#EAF2EE;padding:32px;border-radius:12px;max-width:480px;margin:0 auto">
    <div style="width:36px;height:36px;border-radius:10px;background:#00D179;display:flex;align-items:center;justify-content:center;font-weight:800;color:#03110B;font-size:17px;margin-bottom:20px">S</div>
    <h1 style="font-size:20px;margin:0 0 12px">Welcome to Setpoint</h1>
    <p style="color:#93A69D;font-size:14px;line-height:1.6;margin:0 0 16px">Your account is live. If you've picked a paid plan, your dashboard is ready now, real alerts, tested against real historical price data, only setups that have proven themselves show up by default. If you registered free from Watch It Live, sign back in any time to upgrade whenever you're ready, same account either way.</p>
    <p style="color:#93A69D;font-size:14px;line-height:1.6;margin:0 0 20px">Head back any time at <a href="https://setpointalerts.com" style="color:#5EE9AE">setpointalerts.com</a>.</p>
    <p style="color:#5E7168;font-size:12px;margin:0">You're receiving this because you just created an account with this email address.</p>
  </div>`;
}
