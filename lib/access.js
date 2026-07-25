// lib/access.js
//
// One shared protection key used across every semi-internal route:
// /api/close-alert, /api/open-positions, and both backtest pages. Same
// password already in use, honolulu26, not a new secret to manage.
//
// Two ways in, since these routes get called two different ways:
// - checkKey(req): a ?key=honolulu26 query parameter, for machine callers
//   that can't do an interactive login (GitHub Actions, this app's own
//   client-side fetch calls).
// - checkAuth(req): HTTP Basic Auth, browser's native login popup, for
//   pages a person visits directly (the backtest research pages).
// Both accept the same underlying password, just via a different
// mechanism appropriate to who's calling.
const KEY = "honolulu26";

export function checkKey(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("key") === KEY) return null;
  return new Response(JSON.stringify({ error: "Missing or wrong ?key=" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function checkAuth(req) {
  const auth = req.headers.get("authorization");
  const expected = "Basic " + Buffer.from("setpoint:" + KEY).toString("base64");
  // Also accept the ?key= query param, so a script or curl call can hit
  // these pages the same way close-alert and open-positions do, without
  // needing to construct a Basic Auth header.
  const { searchParams } = new URL(req.url);
  if (searchParams.get("key") === KEY) return null;
  if (auth !== expected) {
    return new Response("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Setpoint research"' },
    });
  }
  return null;
}
