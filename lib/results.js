// lib/results.js
//
// How a closed trade's result is read, in one place. Every surface that
// shows an average result per trade uses these, so every signal is
// measured the same way, whatever its target.
//
// Every trade has a stop and a target. R is the distance to the stop: a loss
// is -1R and a win is the target's multiple of it (+2R for the original
// signals, +0.75R for Trend Rider). The resolver stores the real r; older
// rows without one count as the original 2:1.

export const FIXED_WIN_R = 2;
export const FIXED_LOSS_R = -1;

// Result of one closed trade in R.
export const resultR = (row) => (row.r != null ? Number(row.r) : row.outcome === "win" ? FIXED_WIN_R : FIXED_LOSS_R);

// Average result per trade for a list of closed trades, or null if none.
export const avgResult = (rows) => (rows.length ? rows.reduce((s, x) => s + resultR(x), 0) / rows.length : null);

// Where a closed trade ended: the stored exit, or exactly the target (win)
// or the stop (loss) for older rows.
export const exitPrice = (row) => (row.exit_price != null ? parseFloat(row.exit_price) : row.outcome === "win" ? parseFloat(row.target) : parseFloat(row.stop));

