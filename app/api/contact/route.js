// app/api/contact/route.js
//
// A real, simple contact form, reusing the exact same Gmail SMTP setup
// account emails already use, no new email infrastructure. Sends
// straight to SUPPORT_EMAIL, which points at nokanetmail@gmail.com for
// now, a real, single env var to change later rather than a hardcoded
// address buried in code.
import { sendEmail } from "../../../lib/email.js";

export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }

  const name = (body.name || "").trim().slice(0, 100);
  const email = (body.email || "").trim().slice(0, 200);
  const message = (body.message || "").trim().slice(0, 4000);

  if (!email || !email.includes("@")) return Response.json({ error: "invalid_email" }, { status: 400 });
  if (!message) return Response.json({ error: "empty_message" }, { status: 400 });

  const supportEmail = process.env.SUPPORT_EMAIL || "nokanetmail@gmail.com";
  const html = `
    <div style="font-family:-apple-system,sans-serif;background:#0A0F0D;color:#EAF2EE;padding:24px;border-radius:12px;max-width:520px">
      <h2 style="font-size:16px;margin:0 0 14px">New contact form message</h2>
      <p style="color:#93A69D;font-size:13px;margin:0 0 4px"><b style="color:#EAF2EE">From:</b> ${name || "(no name given)"} &lt;${email}&gt;</p>
      <p style="color:#93A69D;font-size:13px;white-space:pre-wrap;margin:14px 0 0;border-top:1px solid #223029;padding-top:14px">${message}</p>
    </div>`;

  try {
    await sendEmail({ to: supportEmail, subject: `Setpoint contact form: ${name || email}`, html });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: "send_failed", detail: String(e.message || e).slice(0, 200) }, { status: 500 });
  }
}
