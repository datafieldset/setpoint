# Setpoint v6.6

## Switched from Resend to real Gmail sending

The 403 confirmed it directly: Resend requires a verified domain, and gmail.com can't be verified by anyone but Google. Rewired lib/email.js to send through Gmail's own servers instead, using nokanetmail@gmail.com as the real sender, authenticated with a Gmail App Password. Same function signatures as before, so nothing else needed to change, the welcome email and the admin test-email button both just work against the new sending method automatically.

**Needs two new environment variables in Vercel before this actually works:**
- `GMAIL_USER` — nokanetmail@gmail.com
- `GMAIL_APP_PASSWORD` — the 16-character app password from Google Account → Security → App passwords (needs 2-Step Verification turned on first)

No DNS changes needed at all this time, that's the whole point of switching.

## A real dependency conflict caught before it could break the build

Adding nodemailer at the version I first tried (9.x) directly conflicted with a peer dependency next-auth already requires (nodemailer ^7.x for its own optional email-provider support). Caught this by actually running the install locally instead of just writing the version number and assuming it'd work, this would have broken Vercel's build entirely on deploy otherwise. Fixed to the compatible version (^7.0.7) and reinstalled clean.

Separately noticed: npm flagged some existing vulnerabilities in next-auth and Next.js itself, unrelated to this change, pre-existing in the current dependency versions. Not touched, that's a bigger, separate upgrade decision, just worth knowing about.
