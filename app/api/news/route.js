// app/api/news/route.js
// Early-signal feed: free crypto news RSS + Reddit + Bluesky mentions for the
// watchlist. No API keys. Same free-source approach as News Desk Hawaii.
// GET /api/news?symbols=BTC,SOL,XLM

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NAME } from "../../../lib/coins.js";

const UA = { "User-Agent": "setpointalerts/1.1 (+https://setpointalerts.com)" };

const RSS_FEEDS = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "The Block", url: "https://www.theblock.co/rss.xml" },
  { source: "Bitcoin.com", url: "https://news.bitcoin.com/feed/" },
  { source: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
];

// Fast, reliable crypto accounts pulled free from their public Telegram channels.
// Watcher Guru and Whale Alert break moves faster than mainstream RSS. Add more
// channel handles here (their t.me/s/<handle> must be public). X/Twitter-only
// accounts still need the paid X API.
export const TELEGRAM_CHANNELS = ["watcherguru", "whale_alert_io"];

const EXCHANGES = ["binance", "coinbase", "kraken", "okx", "bybit", "huobi", "htx", "bitfinex", "gate.io", "gate", "kucoin", "upbit", "bitstamp", "gemini", "crypto.com", "mexc", "bithumb", "bitget"];

// Turn a Whale Alert message into structured flow: which asset, how much USD, and
// whether it moved to an exchange (possible sell pressure) or off one (possible
// accumulation). Free substitute for a paid on-chain provider, for flow only.
function parseWhale(text, when, link) {
  const matches = [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*[#$]?([A-Za-z]{2,6})\b/g)];
  const pick = matches.find((m) => m[2].toUpperCase() !== "USD");
  if (!pick) return null;
  const asset = pick[2].toUpperCase();
  const usdM = text.match(/\(?\$?\s*([\d,]+(?:\.\d+)?)\s*USD/i);
  const usd = usdM ? parseFloat(usdM[1].replace(/,/g, "")) : null;
  const low = text.toLowerCase();
  const ft = low.match(/from\s+(.+?)\s+to\s+(.+)$/);
  let dir = "other";
  if (ft) {
    const fromEx = EXCHANGES.some((e) => ft[1].includes(e));
    const toEx = EXCHANGES.some((e) => ft[2].includes(e));
    if (toEx && !fromEx) dir = "to_exchange";
    else if (fromEx && !toEx) dir = "from_exchange";
    else if (fromEx && toEx) dir = "exchange_move";
  }
  return { asset, usd, dir, when, link };
}

// Curated traders/analysts to weight highly, by Bluesky handle (editable).
// Real-time X/Twitter tracking needs the paid X API, so free tracking lives on
// Bluesky + Reddit. Add handles like "someanalyst.bsky.social" here.
const TRADERS = [];

function clean(s) {
  return (s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

function parseRss(xml, source) {
  const out = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks) {
    const title = clean((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = clean((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
    const date = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1];
    if (!title) continue;
    const when = date ? new Date(date).getTime() : Date.now();
    out.push({ title, link, when: isNaN(when) ? Date.now() : when, source, kind: "news" });
  }
  return out;
}

export async function getRss() {
  const results = await Promise.all(RSS_FEEDS.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: UA, cache: "no-store" });
      if (!r.ok) return [];
      return parseRss(await r.text(), f.source);
    } catch { return []; }
  }));
  return results.flat();
}

export async function getReddit() {
  const subs = ["CryptoCurrency", "CryptoMarkets"];
  const results = await Promise.all(subs.map(async (sub) => {
    try {
      const r = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=25`, { headers: UA, cache: "no-store" });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.data?.children || []).map((c) => ({
        title: clean(c.data.title),
        link: "https://reddit.com" + c.data.permalink,
        when: (c.data.created_utc || 0) * 1000,
        source: "r/" + sub,
        kind: "reddit",
      }));
    } catch { return []; }
  }));
  return results.flat();
}

export async function getTelegram(channels) {
  const results = await Promise.all(channels.map(async (ch) => {
    try {
      const r = await fetch(`https://t.me/s/${ch}`, { headers: UA, cache: "no-store" });
      if (!r.ok) return [];
      const html = await r.text();
      // Telegram's public preview page has changed its exact markup before
      // without warning, and a scrape depending on one exact class string
      // breaks completely and silently when that happens, exactly what
      // took this down for a week undetected. Try several real, known
      // patterns from Telegram's own widget markup, in order, the first
      // one that actually finds real message blocks wins, instead of
      // depending on a single brittle string staying exactly the same
      // forever.
      const splitPatterns = ["js-message_text", "tgme_widget_message_text", "tgme_widget_message "];
      let blocks = [];
      for (const pattern of splitPatterns) {
        const found = html.split(pattern).slice(1);
        if (found.length > 0) { blocks = found; break; }
      }
      const items = [];
      for (const b of blocks) {
        const tm = b.match(/^[^>]*>([\s\S]*?)<\/div>/);
        const text = tm ? clean(tm[1]) : "";
        if (!text || text.length < 5) continue;
        const time = (b.match(/datetime="([^"]+)"/) || [])[1];
        const link = (b.match(/href="(https:\/\/t\.me\/[^"]+\/\d+)"/) || [])[1] || `https://t.me/${ch}`;
        items.push({
          title: text,
          link,
          when: time ? new Date(time).getTime() : Date.now(),
          source: "@" + ch,
          kind: "social",
          watched: true,
        });
      }
      return items;
    } catch { return []; }
  }));
  return results.flat();
}

async function getBluesky(symbols) {
  const queries = [];
  symbols.forEach((s) => { queries.push("$" + s); queries.push(NAME[s] || s); });
  const results = await Promise.all(queries.map(async (q) => {
    try {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=12&sort=latest`;
      const r = await fetch(url, { headers: UA, cache: "no-store" });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.posts || []).map((p) => {
        const handle = p.author?.handle || "";
        return {
          title: clean(p.record?.text || ""),
          link: `https://bsky.app/profile/${handle}/post/${(p.uri || "").split("/").pop()}`,
          when: new Date(p.indexedAt || Date.now()).getTime(),
          source: "@" + handle,
          kind: "social",
          watched: TRADERS.includes(handle),
        };
      });
    } catch { return []; }
  }));
  return results.flat();
}

function matches(text, sym) {
  const t = text.toLowerCase();
  const name = (NAME[sym] || sym).toLowerCase();
  return t.includes("$" + sym.toLowerCase()) ||
    new RegExp(`\\b${sym.toLowerCase()}\\b`).test(t) ||
    t.includes(name);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get("symbols") || "BTC,SOL,XLM")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 6);

  const [rss, reddit, bsky, tg] = await Promise.all([
    getRss(), getReddit(), getBluesky(symbols), getTelegram(TELEGRAM_CHANNELS),
  ]);
  // Whale Alert has its own net-flow read in Market Context now, so it stays
  // out of the news feed, but its posts still feed that aggregate below.
  const whaleItems = tg.filter((x) => x.source === "@whale_alert_io");
  const all = [...rss, ...reddit, ...bsky, ...tg]
    .filter((x) => x.title && x.title.length > 4 && x.source !== "@whale_alert_io");

  const coins = {};
  symbols.forEach((sym) => {
    const items = all
      .filter((x) => matches(x.title, sym))
      .sort((a, b) => (b.watched ? 1 : 0) - (a.watched ? 1 : 0) || b.when - a.when);
    // dedupe by title
    const seen = new Set();
    coins[sym] = items.filter((x) => {
      const k = x.title.slice(0, 60).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 6);
  });

  // Net flow: pooled across every large transfer Whale Alert posted, not
  // filtered to any one coin. Individual coins go quiet for days, whale
  // activity overall never does, BTC and stablecoins alone move billions
  // daily. Positive net means more money moving onto exchanges lately
  // (often read as building sell pressure), negative means more moving off
  // (often read as accumulation). This is a read, not a rule, worded that
  // way everywhere it's shown.
  const parsed = whaleItems.map((x) => parseWhale(x.title, x.when, x.link)).filter(Boolean);
  let toExchange = 0, fromExchange = 0, txCount = 0;
  for (const w of parsed) {
    if (w.usd == null) continue;
    if (w.dir === "to_exchange") { toExchange += w.usd; txCount++; }
    else if (w.dir === "from_exchange") { fromExchange += w.usd; txCount++; }
  }
  const netFlow = txCount > 0 ? {
    toExchange, fromExchange, net: toExchange - fromExchange, txCount,
    recent: parsed.filter((w) => w.dir === "to_exchange" || w.dir === "from_exchange").slice(0, 4),
  } : null;

  return Response.json(
    { coins, netFlow, at: Date.now() },
    { headers: { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
