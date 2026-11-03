// Renders the square X card from live data. See README.md.
// Usage: NODE_PATH=$(npm root -g) node memory/social/render.mjs --sub "meter sentence" --out card.png
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const out = arg("out", "card.png");
const sub = arg("sub", "");
if (!sub) { console.error('Pass --sub "<the Market Meter sentence from the Market tab>"'); process.exit(1); }

const m = await (await fetch("https://setpointalerts.com/api/market")).json();
const tk = await (await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { headers: { "User-Agent": "setpoint" } })).json();
const price = Number(tk.price);
const btc = m.coins.find((c) => c.sym === "BTC").candles;
// v20.6: the 1h / 1 day / 1 week numbers are computed exactly like the Market Meter on the site: hourly candles, now vs N hours back.
const h1 = (await (await fetch("https://setpointalerts.com/api/market?symbols=BTC&tf=1h")).json()).coins.find((c) => c.sym === "BTC").candles;
const back = (h) => (price / h1[h1.length - 1 - h].close - 1) * 100;
const mv = { "1h": back(1), "1 day": back(24), "1 week": back(168) };
const chg = mv["1 day"];
// Guard: the sentence and the 1 week number are read at different moments and can differ by 0.1 at a rounding edge. Make the sentence use the card's number.
const wk = Math.abs(mv["1 week"]).toFixed(1).replace(/\.0$/, "");
const subFixed = sub.replace(/[\d.]+% this week/, `${wk}% this week`);
const w = m.weekly200;
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (n) => (Math.abs(n) < 0.05 ? "0.0%" : (n >= 0 ? "+" : "-") + Math.abs(n).toFixed(1) + "%");
// v20.8: the verdict is the trend, price against the 50-day average (the same test the flip line uses and the "Bitcoin trend" label promises).
// It used to read the last-hour market bias, which could say BULLISH on a card whose own sentence said below the 50-day.
const bull = price > m.weekly200.daily50;
const levels = [
  { n: "50-day", v: w.daily50, cls: "d50" },
  { n: "Bitcoin", v: price, cls: "btc" },
  { n: "200-day", v: w.daily200 },
  { n: "200-week", v: w.sma },
].sort((a, b) => b.v - a.v);
const tops = [0, 84, 172, 256];
const rows = levels.map((l, i) => {
  let pc = "now";
  if (l.cls !== "btc") {
    const d = (price / l.v - 1) * 100; // price vs level
    pc = l.v > price ? `${pct((l.v / price - 1) * 100)} ${l.cls === "d50" ? "to break" : "to reach"}` : `${pct(d)} above`;
  }
  return `<div class="row ${l.cls || ""}" style="top:${tops[i]}px"><span class="n">${l.n}</span><span class="dot"></span><span class="v">${money(l.v)}</span><span class="pc">${pc}</span></div>`;
}).join("\n");
const cross = w.daily50 > w.daily200;
const flip = price < w.daily50
  ? `Flip the story with a daily close above <b>${money(w.daily50)}</b>`
  : `Staying above the 50-day (<b>${money(w.daily50)}</b>) keeps it bullish`;
const vals = {
  GLOW: bull ? "rgba(0,209,121,.15)" : "rgba(255,77,94,.17)",
  VCOLOR: bull ? "#00D179" : "#FF4D5E",
  VERDICT: bull ? "BULLISH" : "BEARISH",
  SUB: subFixed,
  PRICE: money(price),
  MOVES: Object.entries(mv).map(([k, v]) => `<div><span class="k">${k}</span><b style="color:${Math.abs(v) < 0.05 ? "#93A69D" : v >= 0 ? "#00D179" : "#FF4D5E"}">${pct(v)}</b></div>`).join(""),
  CHGCOLOR: chg >= 0 ? "#00D179" : "#FF4D5E",
  ROWS: rows,
  GC: cross ? "on" : "off",
  GCBG: cross ? "rgba(0,209,121,.15)" : "rgba(255,77,94,.15)",
  GCCOLOR: cross ? "#5EE9AE" : "#FF8A96",
  FNG: m.fng.value,
  FLIP: flip,
};
let html = fs.readFileSync(path.join(dir, "card.template.html"), "utf8");
for (const [k, v] of Object.entries(vals)) html = html.split(`{{${k}}}`).join(String(v));
const tmp = path.join(dir, ".card.tmp.html");
fs.writeFileSync(tmp, html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await p.screenshot({ path: out });
await b.close();
fs.unlinkSync(tmp);
console.log("wrote", out, { price: money(price), moves: Object.fromEntries(Object.entries(mv).map(([k, v]) => [k, pct(v)])), d50: money(w.daily50), d200: money(w.daily200), w200: money(w.sma), fng: vals.FNG });
