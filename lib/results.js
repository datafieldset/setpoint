// lib/results.js
//
// How a closed trade's result is read, in one place. Every surface that
// shows an average result per trade uses these, so a fixed-target signal
// and a trailing-stop signal are measured the same way.
//
// A fixed-target trade is built as a 2:1 payoff: a win is +2R, a loss is
// -1R (R is the amount risked). Trailing-stop trades store their real r.

export const FIXED_WIN_R = 2;
export const FIXED_LOSS_R = -1;

// Result of one closed trade in R. Rows from before r was stored are 2:1.
export const resultR = (row) => (row.r != null ? Number(row.r) : row.outcome === "win" ? FIXED_WIN_R : FIXED_LOSS_R);

// Average result per trade for a list of closed trades, or null if none.
export const avgResult = (rows) => (rows.length ? rows.reduce((s, x) => s + resultR(x), 0) / rows.length : null);

// Where a closed trade ended. Trailing trades store it; fixed trades end
// exactly at the target (win) or the stop (loss).
export const exitPrice = (row) => (row.exit_price != null ? parseFloat(row.exit_price) : row.outcome === "win" ? parseFloat(row.target) : parseFloat(row.stop));

// How an open trade stands right now, in R, from price and its opening risk.
export const openResult = (dir, entry, risk, price) => {
  if (!(risk > 0) || price == null) return null;
  return (dir === "bull" ? price - entry : entry - price) / risk;
};

