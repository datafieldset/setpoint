// lib/schema.js
//
// Columns added to signal_track after the table already existed.
// CREATE TABLE IF NOT EXISTS never helps a live table, so each one
// needs a real ALTER. One place for all of them, run once per server
// instance instead of on every request, and shared by every route that
// reads or writes these columns so none of them can hit a missing one.
let ensured = false;

export async function ensureSignalTrackColumns(sql) {
  if (ensured) return;
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS regime TEXT`;
  // Whether the trade counted as verified at the moment it fired.
  // NULL means it was logged before this existed, or the check
  // couldn't run, and readers fall back to today's status for those.
  await sql`ALTER TABLE signal_track ADD COLUMN IF NOT EXISTS verified_at_fire BOOLEAN`;
  ensured = true;
}
