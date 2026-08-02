# Setpoint v6.5

## Delete users, with real confirmation

Each registration in the admin panel now has a "Delete user" link. Tapping it doesn't delete anything immediately, it shows a real confirmation step ("Delete this account? This can't be undone.") with Yes/Cancel, only the Yes click actually removes the account. Can't delete your own admin account this way, a lockout with no other admin UI to recover from would be a real mess.

## A real way to see why the welcome email isn't sending

Added a "Send test email" button right in the admin panel. It sends a real test email to your own address and shows exactly what Resend says back, success, or the real failure reason, instead of guessing. Given the API key was just added and this is likely a first real send attempt, the most probable cause is the sending domain not being verified with Resend yet, Resend requires that before it'll send from a custom address like hello@setpointalerts.com at all, not just for spam-folder reasons. The test button will confirm this directly instead of us guessing back and forth.
