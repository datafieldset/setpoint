// app/api/meter-card/route.jsx
//
// The Market Meter's share image (v24.7, Nov 12). GET /api/meter-card returns a square 1080 x 1080 PNG of today's Bitcoin read for the
// Share button (copy, save, share) and for tweets. The numbers come from lib/meterCard.js, which reads the same code the meter on the page
// reads. Drawn on the server so it looks the same on every phone. Cached by the CDN for a minute, and the market data underneath is
// cached too, so a burst of taps does no extra database work (the 200-week average is read the same cached way /api/market reads it).
import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";
import { fetchCandles, getWeekly200MA, fetchFng } from "../../../lib/marketContext.js";
import { buildMeterCard } from "../../../lib/meterCard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FONT_DIR = path.join(process.cwd(), "lib", "fonts");
let fonts = null;
function loadFonts() {
  if (!fonts) {
    const f = (file) => fs.readFileSync(path.join(FONT_DIR, file));
    fonts = [
      { name: "Inter", data: f("inter-latin-500-normal.woff"), weight: 500, style: "normal" },
      { name: "Inter", data: f("inter-latin-600-normal.woff"), weight: 600, style: "normal" },
      { name: "Montserrat", data: f("montserrat-latin-800-normal.woff"), weight: 800, style: "normal" },
    ];
  }
  return fonts;
}

const RED = "#FF4D5E", GREEN = "#00D179", AMBER = "#F5B544", GREY = "#8FA39A";
const col = (up) => (up === null ? "#93A69D" : up ? GREEN : RED);

export async function GET(request) {
  // One address, one cached picture: anything with a query string goes back to the plain address, so it cannot be used to force fresh renders.
  const u = new URL(request.url);
  if (u.search) return Response.redirect(u.origin + u.pathname, 307);
  try {
    const [candles1h, candles5m, weekly, fng] = await Promise.all([
      fetchCandles("BTC", "1h"),
      fetchCandles("BTC", "5m").catch(() => null),
      getWeekly200MA(),
      fetchFng(),
    ]);
    const c = buildMeterCard({ candles1h, candles5m, weekly, fng });
    if (!c) return Response.json({ error: "Market data is not ready" }, { status: 503, headers: { "cache-control": "no-store" } });
    const vcol = c.bull ? GREEN : RED;
    const flex = (extra) => ({ display: "flex", ...extra });
    const dot = (bg, shadow) => ({ width: 17, height: 17, borderRadius: 9, background: bg, boxShadow: shadow });
    const rowBase = { position: "absolute", left: 0, right: 0, display: "flex", alignItems: "center" };
    const heights = c.ladder.map((r) => (r.cls === "px" ? 62 : 44));
    const pos = []; // rows stack top to bottom with an even gap; the highlighted price row is taller
    let y = 0;
    for (const h of heights) { pos.push(y); y += h + 16; }

    return new ImageResponse(
      (
        <div style={{ width: 1080, height: 1080, display: "flex", flexDirection: "column", padding: "52px 64px 30px", background: "#0A0F0D", color: "#EAF2EE", fontFamily: "Inter", position: "relative" }}>
          <div style={{ position: "absolute", left: -260, top: -300, width: 900, height: 900, display: "flex", backgroundImage: `radial-gradient(circle, ${c.bull ? "rgba(0,209,121,0.15)" : "rgba(255,77,94,0.17)"} 0%, rgba(10,15,13,0) 65%)` }} />
          <div style={flex({ justifyContent: "space-between", alignItems: "center", height: 40 })}>
            <div style={flex({ alignItems: "center", fontFamily: "Montserrat", fontWeight: 800, fontSize: 32, letterSpacing: -0.6 })}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: GREEN, marginRight: 14, boxShadow: "0 0 22px #00D179" }} />
              <span>SETPOINT</span>
              <span style={{ color: GREEN }}>ALERTS</span>
            </div>
            <span style={{ fontSize: 22, fontWeight: 600, color: GREY }}>{`Bitcoin trend · ${c.stamp}`}</span>
          </div>
          <div style={{ display: "flex", marginTop: 14, marginLeft: -4, fontFamily: "Montserrat", fontWeight: 800, fontSize: 140, lineHeight: 1, letterSpacing: -4.9, color: vcol }}>{c.verdict}</div>
          <div style={{ display: "flex", marginTop: 14, width: 920, fontSize: c.sentence.length > 104 ? 28 : 34, fontWeight: 600, lineHeight: 1.3 }}>{c.sentence}</div>
          <div style={flex({ alignItems: "center", marginTop: 22 })}>
            <span style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: 84, letterSpacing: -1.7, marginRight: 48 }}>{c.price}</span>
            <div style={flex({ alignItems: "center", marginTop: 4 })}>
              {c.moves.map((mv) => (
                <div key={mv.k} style={flex({ flexDirection: "column", marginRight: 34 })}>
                  <span style={{ fontSize: 22, fontWeight: 500, color: "#93A69D" }}>{mv.k}</span>
                  <span style={{ fontSize: 32, fontWeight: 600, color: col(mv.up) }}>{mv.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={flex({ flexDirection: "column", marginTop: 28 })}>
            <div style={flex({ justifyContent: "space-between", fontSize: 22, fontWeight: 500, color: "#93A69D" })}>
              <span>Last 24 hours</span>
              <span style={{ color: "#C7D4CD" }}>{c.range.note}</span>
            </div>
            <div style={{ display: "flex", position: "relative", height: 10, borderRadius: 5, background: "#1F2B25", marginTop: 12, marginBottom: 12 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: 10, width: `${Math.round(c.range.at * 100)}%`, borderRadius: 5, background: c.range.at >= 0.5 ? GREEN : RED }} />
              <div style={{ position: "absolute", left: `${Math.round(c.range.at * 100)}%`, top: -7, width: 24, height: 24, marginLeft: -12, borderRadius: 12, background: "#fff", boxShadow: "0 0 0 5px #0A0F0D, 0 0 16px rgba(255,255,255,0.7)" }} />
            </div>
            <div style={flex({ justifyContent: "space-between", fontSize: 24, fontWeight: 600 })}>
              <span>{`Low ${c.range.low}`}</span>
              <span>{`High ${c.range.high}`}</span>
            </div>
          </div>
          <div style={{ display: "flex", position: "relative", marginTop: 26, height: 248 }}>
            <div style={{ position: "absolute", left: 219, top: 10, bottom: 10, width: 3, borderRadius: 2, background: "#26332D" }} />
            {c.ladder.map((r, i) => {
              const isPx = r.cls === "px", isD50 = r.cls === "d50";
              return (
                <div key={r.name} style={{ ...rowBase, top: pos[i], height: heights[i], ...(isPx ? { background: "rgba(255,255,255,0.07)", borderRadius: 12 } : {}) }}>
                  <span style={{ width: 190, display: "flex", justifyContent: "flex-end", fontSize: 27, fontWeight: 600, color: isPx ? "#fff" : GREY }}>{r.name}</span>
                  <span style={{ width: 60, display: "flex", justifyContent: "center" }}>
                    <div style={isPx ? dot("#fff", "0 0 16px #fff") : isD50 ? dot(AMBER, `0 0 0 3px ${AMBER}`) : dot("#26332D", "0 0 0 3px #3A4A43")} />
                  </span>
                  <span style={{ fontFamily: "Montserrat", fontWeight: 800, fontSize: isPx ? 42 : 36, color: isD50 ? AMBER : "#EAF2EE" }}>{r.value}</span>
                  <span style={{ marginLeft: "auto", paddingRight: isPx ? 18 : 0, fontSize: 26, fontWeight: 600, color: isPx ? (c.bull ? GREEN : RED) : GREY }}>{r.note}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", marginTop: 28, height: 112, border: "1px solid #1F2B25", borderRadius: 20, background: "#0E1512", padding: "18px 30px" }}>
            <div style={flex({ alignItems: "center", justifyContent: "space-between", fontSize: 28, fontWeight: 600 })}>
              <div style={flex({ alignItems: "center" })}>
                <span>Golden cross</span>
                <span style={{ marginLeft: 12, borderRadius: 9, padding: "4px 14px", fontSize: 24, background: c.goldenCross ? "rgba(0,209,121,0.16)" : "rgba(255,77,94,0.16)", color: c.goldenCross ? GREEN : RED }}>{c.goldenCross ? "ON" : "OFF"}</span>
              </div>
              {c.fng && (
                <div style={flex({ alignItems: "center", fontWeight: 500, color: GREY })}>
                  <span>Fear &amp; Greed</span>
                  <span style={{ marginLeft: 10, color: "#EAF2EE", fontWeight: 600 }}>{`${c.fng.value} ${c.fng.label}`}</span>
                </div>
              )}
            </div>
            <div style={flex({ alignItems: "center", fontSize: 28, fontWeight: 500, color: "#C7D4CD" })}>
              <span>{c.flip.pre}</span>
              <span style={{ color: AMBER, fontWeight: 600, marginLeft: c.flip.gap ? 8 : 0 }}>{c.flip.hi}</span>
              {c.flip.post ? <span>{c.flip.post}</span> : null}
            </div>
          </div>
          <div style={flex({ marginTop: "auto", justifyContent: "space-between", fontSize: 20, fontWeight: 500, color: "#7A8F85" })}>
            <span>Context, not advice. Never places trades.</span>
            <span>setpointalerts.com</span>
          </div>
        </div>
      ),
      { width: 1080, height: 1080, fonts: loadFonts(), headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (e) {
    return Response.json({ error: "Could not make the image" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
