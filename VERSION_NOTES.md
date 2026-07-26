# Setpoint v5.1

## The GitHub cron was still hitting the old URL

The workflow file on GitHub still had the pre-v4.9 version, missing ?key=honolulu26, confirmed from the actual failed run's log: `curl -f "https://setpointalerts.com/api/close-alert"`, no key at all. Every scheduled run since v4.9 deployed has been getting rejected with a 401.

Almost certainly the .github folder specifically, since folders starting with a dot are hidden by default in both Finder and Windows Explorer, easy to miss when dragging files over manually even when every zip handed over had the correct version inside.

This version's .github/workflows/close-alert-cron.yml has the key included, verified against the actual file being shipped, not just assumed correct this time.
