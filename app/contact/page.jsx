"use client";
// app/contact/page.jsx
//
// A real, simple way to reach a real person, nothing more. Submissions
// email straight through to Setpoint's own inbox via the same account-
// email system already in place, no new infrastructure, no third-party
// form service.
import { useState } from "react";
import { useSession } from "next-auth/react";

export default function ContactPage() {
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(session?.user?.email || "");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  const submit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="contact-page">
      <style>{CSS}</style>
      <a href="/" className="contact-back">← Back to Setpoint</a>
      <div className="contact-hero">
        <div className="contact-mark">S</div>
        <h1>Get in touch</h1>
        <p>A real question, a billing issue, anything at all. This goes straight to a real person, not a bot.</p>
      </div>

      {status === "sent" ? (
        <div className="contact-sent">Sent. We'll get back to you at {email}.</div>
      ) : (
        <form className="contact-form" onSubmit={submit}>
          <label>Name (optional)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Message<textarea required rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What's going on?" /></label>
          {status === "error" && <div className="contact-error">Something went wrong sending that, try again in a moment.</div>}
          <button type="submit" className="contact-submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send message"}</button>
        </form>
      )}
    </div>
  );
}

const CSS = `
  html, body { background: #0A0F0D; margin: 0; }
  :root{ --bg:#0A0F0D; --panel:#0F1712; --text:#EAF2EE; --muted:#93A69D; --dim:#5E7168; --border:#223029; --green:#00D179; --red:#FF5C6C; }
  *{box-sizing:border-box}
  .contact-page{background:var(--bg);color:var(--text);font-family:-apple-system,Inter,system-ui,sans-serif;min-height:100vh;max-width:520px;margin:0 auto;padding:0 22px 60px}
  .contact-back{display:inline-block;color:var(--muted);font-size:13px;text-decoration:none;padding:16px 0 0}
  .contact-back:hover{color:var(--text)}
  .contact-hero{padding:24px 0 28px;text-align:center;border-bottom:1px solid var(--border)}
  .contact-mark{width:40px;height:40px;border-radius:11px;background:var(--green);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#03110B;font-size:19px}
  .contact-hero h1{font-size:24px;margin:0 0 8px}
  .contact-hero p{color:var(--muted);font-size:14px;line-height:1.5;margin:0}
  .contact-form{display:flex;flex-direction:column;gap:16px;padding-top:28px}
  .contact-form label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--muted);font-weight:600}
  .contact-form input,.contact-form textarea{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:11px 13px;color:var(--text);font-family:inherit;font-size:14px;resize:vertical}
  .contact-form input:focus,.contact-form textarea:focus{outline:none;border-color:var(--green)}
  .contact-submit{background:var(--green);color:#03110B;font-weight:700;font-size:15px;padding:13px;border:none;border-radius:10px;cursor:pointer;margin-top:6px}
  .contact-submit:disabled{opacity:.6;cursor:default}
  .contact-error{color:var(--red);font-size:12.5px}
  .contact-sent{padding:40px 0;text-align:center;color:var(--muted);font-size:14.5px}
`;
