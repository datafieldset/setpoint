// app/api/version/route.js
//
// Real, direct fix (Sep 24) for a recurring, confusing pattern this
// whole session: a browser tab open since before a real deploy keeps
// running the old, bundled client code, so a genuine, server-side fix
// can look like it "didn't work" when it actually did — the tab just
// never reloaded to pick it up. Returns the current, real, live
// deployment's identity, Vercel's own git commit SHA when deployed
// there, so the client can tell whether it's running stale code and
// prompt a real refresh instead of leaving that silently undiscovered.
export const dynamic = "force-dynamic";

export async function GET() {
  const id = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";
  return Response.json({ id }, { headers: { "cache-control": "no-store" } });
}
