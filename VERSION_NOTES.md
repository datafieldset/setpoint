# Setpoint v4.8

## Self-built, free, no third-party scheduler

Added .github/workflows/close-alert-cron.yml. This is a feature of GitHub itself, the same place already hosting this repo, not a new service or account. It runs every 5 minutes on GitHub's own servers, hits /api/close-alert directly, and does this forever, completely independent of whether anyone's dashboard is open anywhere.

This is the real fix for "just close it when it hits target or stop, I don't care how." Once this file is in the repo and pushed, it starts running on its own schedule automatically, nothing else to set up, no signup, no external account.

Can also be triggered manually anytime from the repo's Actions tab on GitHub.com, useful for testing it fired correctly without waiting for the next 5-minute mark.
