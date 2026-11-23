// app/api/ready-state/route.js (v25.1)
//
// Extra live facts a signal's "How close is an alert" row needs that are not Coinbase candles. Today: Flow Rider's flow and 50-day state
// (lib/flow.js, from Binance's data-only mirror). GET returns { flow: { z, avg50, price, below } | null }. Cached for a minute by the feed
// itself (lib/flowFeed.js), so a burst of page loads does one set of requests. Nothing here writes to the database.
import { NextResponse } from "next/server";
import { getFlowData } from "../../../lib/flowFeed.js";
import { flowState } from "../../../lib/flow.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let flow = null;
  try {
    const d = await getFlowData();
    if (d) flow = flowState(d.k15, d.days, Date.now());
  } catch { /* the row is simply left out */ }
  return NextResponse.json({ flow }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } });
}
