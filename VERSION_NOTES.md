# Setpoint v7.6

## Password rotated

The internal access password (protecting the backtest research pages, close-alert, and open-positions) is rotated to a new value. Updated everywhere it appeared: the shared access check (lib/access.js), both client-side fetch calls that use it (app/page.jsx), and the GitHub Actions cron workflow file. Verified no trace of the old password remains anywhere in the repo before pushing.

Pushed directly this time, first real use of direct push access instead of a zip handoff.
