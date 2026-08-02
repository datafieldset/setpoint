# Setpoint v6.4

v6.3 folded in, wasn't pushed separately.

## Alert delivery promise removed from pricing

Dropped "Email delivery" (Watch tier) and "Telegram + Discord + email" (Trader tier) entirely. Alerts are dashboard-only, nothing promises a delivery channel that was never built. The webhooks feature on Pro is untouched, that's the customer's own endpoint, not something we send from.

## Real welcome email, via Resend

New lib/email.js, a thin wrapper around Resend's API, scoped narrowly to account emails only, never alert delivery, that stays out of scope entirely. Wired into registration: a real welcome email now sends the moment an account is created. Fails gracefully, if the send fails for any reason (including before the sending domain is verified), registration itself is never blocked or affected.

**Needs from you before this actually works:** a RESEND_API_KEY environment variable in Vercel, and a few DNS records added wherever setpointalerts.com's domain is managed, so Resend can verify the sending domain and actual inboxes trust the email instead of spam-filtering it. I'll give you the exact records once you've got a Resend account started.

## Admin: real registration list + CSV download

New page, reachable by clicking the ADMIN badge (which now also shows a live "X new" count for signups in the last 24 hours). Lists everyone who's registered, shows exactly what's actually captured today: email, plan, signup date. A real "Download CSV" link pulls the same data as an actual file. Name and phone don't appear because they're not collected anywhere in the system yet, that would need new fields added to the signup form itself, a separate decision.
