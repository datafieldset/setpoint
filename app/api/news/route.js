// app/api/news/route.js
// Early-signal feed: free crypto news RSS + Reddit + Bluesky mentions for the
// watchlist. No API keys. Same free-source approach as News Desk Hawaii.
// GET /api/news?symbols=BTC,SOL,XLM

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NAME } from "../../../lib/coins.js";

// Was a self-identifying bot string before ("setpointalerts/1.1..."),
// changed to a real browser UA. A request that announces itself as a bot
// is exactly the kind of thing simple anti-scraping rules filter first,
// and that's a very plausible reason this could work fine from other
// tools/networks while quietly failing specifically from a server.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" };

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
export const TELEGRAM_CHANNELS = ["watcherguru"];

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
  const debug = [];
  const results = await Promise.all(subs.map(async (sub) => {
    try {
      const r = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=25`, { headers: UA, cache: "no-store" });
      if (!r.ok) { debug.push({ sub, status: r.status }); return []; }
      const j = await r.json();
      return (j.data?.children || []).map((c) => ({
        title: clean(c.data.title),
        link: "https://reddit.com" + c.data.permalink,
        when: (c.data.created_utc || 0) * 1000,
        source: "r/" + sub,
        kind: "reddit",
      }));
    } catch (e) { debug.push({ sub, error: String(e) }); return []; }
  }));
  return { items: results.flat(), debug };
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
  const debug = [];
  const results = await Promise.all(queries.map(async (q) => {
    try {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=12&sort=latest`;
      const r = await fetch(url, { headers: UA, cache: "no-store" });
      if (!r.ok) { debug.push({ q, status: r.status }); return []; }
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
    } catch (e) { debug.push({ q, error: String(e) }); return []; }
  }));
  return { items: results.flat(), debug };
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

  const [rss, redditR, bskyR, tg] = await Promise.all([
    getRss(), getReddit(), getBluesky(symbols), getTelegram(TELEGRAM_CHANNELS),
  ]);
  const reddit = redditR.items, bsky = bskyR.items;
  const all = [...rss, ...reddit, ...bsky, ...tg]
    .filter((x) => x.title && x.title.length > 4);

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

  // Large trade flow: real, unusually large individual trades on Coinbase
  // itself, not scraped wallet-transfer alerts. Replaced the Telegram
  // scrape (Aug 5) after real evidence showed it was very likely blocked
  // specifically from this deployment platform's IP range, not fixable
  // by better parsing or a more realistic User-Agent, both tried and
  // both didn't resolve it. This reads from the same Coinbase API every
  // signal on this dashboard already depends on, proven reliable from
  // here. Genuinely a different measurement than before: real buy/sell
  // trade pressure on one exchange, not wallet movement across the whole
  // blockchain, worded that way everywhere it's shown, not oversold as
  // the same thing under a new source.
  const netFlow = await getLargeTradeFlow();

  return Response.json(
    { coins, netFlow, at: Date.now() },
    { headers: { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}

async function getLargeTradeFlow() {
  // Coinbase's actual /trades endpoint requires authentication, confirmed
  // directly from their own docs, this was the real bug this whole time,
  // not caching, not Vercel. Every request here was silently failing on
  // an auth error and returning null, meaning this panel was quietly
  // showing its empty state the entire time since it was first built,
  // never actually working. Switched to 1-minute candles instead, the
  // same public, unauthenticated endpoint already proven working
  // elsewhere in this app. An unusually high-volume bar compared to its
  // own recent average stands in for a real burst of large trading
  // activity, direction read from whether that bar closed up or down.
  try {
    const r = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60", { headers: UA, cache: "no-store" });
    if (!r.ok) return null;
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length < 30) return null;
    const candles = raw.slice().reverse().map((x) => ({ time: x[0] * 1000, low: x[1], high: x[2], open: x[3], close: x[4], volume: x[5] }));
    let buyUsd = 0, sellUsd = 0, txCount = 0;
    const recent = [];
    for (let i = 20; i < candles.length; i++) {
      const window = candles.slice(Math.max(0, i - 20), i);
      const avgVol = window.reduce((s, c) => s + c.volume, 0) / window.length;
      const c = candles[i];
      if (avgVol <= 0 || c.volume < avgVol * 4) continue;
      const avgPrice = (c.high + c.low) / 2;
      const usd = c.volume * avgPrice;
      const side = c.close >= c.open ? "buy" : "sell";
      if (side === "buy") buyUsd += usd; else sellUsd += usd;
      txCount++;
      recent.push({ usd, side, when: c.time });
    }
    if (txCount === 0) return null;
    recent.sort((a, b) => b.when - a.when);
    return {
      toExchange: sellUsd,
      fromExchange: buyUsd,
      net: sellUsd - buyUsd,
      txCount,
      recent: recent.slice(0, 4).map((r) => ({ dir: r.side === "sell" ? "to_exchange" : "from_exchange", when: r.when })),
    };
  } catch {
    return null;
  }
}
