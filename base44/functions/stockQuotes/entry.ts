
import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

const POLY_API_KEY = Deno.env.get("POLY_API_KEY") || "";
const ALPHA_VANTAGE_API = Deno.env.get("ALPHA_VANTAGE_API") || "";

// Helpers
function parseNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return isFinite(n) ? n : null;
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 4000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(resource, { ...rest, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Providers
async function polygonLastTrade(symbol) {
  try {
    if (!POLY_API_KEY) return { price: null };
    const url = new URL(`https://api.polygon.io/v2/last/trade/stocks/${encodeURIComponent(symbol)}`);
    url.searchParams.set("apiKey", POLY_API_KEY);
    const res = await fetchWithTimeout(url.toString(), { timeout: 2500 });
    if (!res.ok) return { price: null };
    const data = await res.json();
    const price = parseNumber(data?.results?.p ?? data?.price);
    return { price: price ?? null };
  } catch {
    return { price: null };
  }
}

async function polygonPrevClose(symbol) {
  try {
    if (!POLY_API_KEY) return { prevClose: null };
    const url = new URL(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev`);
    url.searchParams.set("adjusted", "true");
    url.searchParams.set("apiKey", POLY_API_KEY);
    const res = await fetchWithTimeout(url.toString(), { timeout: 2500 });
    if (!res.ok) return { prevClose: null };
    const data = await res.json();
    const c = Array.isArray(data?.results) ? data.results[0] : null;
    const prevClose = parseNumber(c?.c);
    return { prevClose: prevClose ?? null };
  } catch {
    return { prevClose: null };
  }
}

async function alphaGlobalQuote(symbol) {
  try {
    if (!ALPHA_VANTAGE_API) return { price: null, changePct: null, changeVal: null };
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "GLOBAL_QUOTE");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", ALPHA_VANTAGE_API);
    const res = await fetchWithTimeout(url.toString(), { timeout: 3500 });
    if (!res.ok) return { price: null, changePct: null, changeVal: null };
    const data = await res.json();
    const gq = data?.["Global Quote"] || {};
    const price = parseNumber(gq["05. price"]);
    const changeVal = parseNumber(gq["09. change"]);
    const changePct = parseNumber((gq["10. change percent"] || "").toString().replace("%", ""));
    return { price: price ?? null, changePct: changePct ?? null, changeVal: changeVal ?? null };
  } catch {
    return { price: null, changePct: null, changeVal: null };
  }
}

async function yahooQuote(symbol) {
  try {
    const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
    url.searchParams.set("symbols", symbol);
    const res = await fetchWithTimeout(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 3000
    });
    if (!res.ok) return { price: null, name: null, changePct: null, changeVal: null, prevClose: null };
    const data = await res.json();
    const q = data?.quoteResponse?.result?.[0] || {};
    const price = typeof q.regularMarketPrice === "number" ? q.regularMarketPrice : null;
    const name = q.shortName || q.longName || null;
    const changePct = typeof q.regularMarketChangePercent === "number" ? q.regularMarketChangePercent : null;
    const changeVal = typeof q.regularMarketChange === "number" ? q.regularMarketChange : null;
    const prevClose = typeof q.regularMarketPreviousClose === "number" ? q.regularMarketPreviousClose : null;
    return { price, name, changePct, changeVal, prevClose };
  } catch {
    return { price: null, name: null, changePct: null, changeVal: null, prevClose: null };
  }
}

async function googleFinanceFallback(symbol) {
  try {
    const exchanges = ["NASDAQ", "NYSE", "NYSEARCA", "NYSEMKT"];
    for (const ex of exchanges) {
      const url = `https://www.google.com/finance/quote/${encodeURIComponent(symbol)}:${ex}`;
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 1500 });
      if (!res.ok) continue;
      const html = await res.text();

      // Try lightweight patterns for price
      const m1 = html.match(/"price"\s*:\s*{\s*"raw"\s*:\s*([\d.\-]+)/i);
      const m2 = html.match(/data-last-price="([\d.,\-]+)"/i);
      const price = parseNumber(m1?.[1] ?? m2?.[1] ?? null);

      // Company name (simple, JS-compatible patterns)
      const nameMatch =
        html.match(/"companyName":"([^"]+)"/i) ||
        html.match(/<meta[^>]*itemprop="name"[^>]*content="([^"]+)"/i);
      const name = (nameMatch && nameMatch[1]) ? nameMatch[1] : null;

      if (typeof price === "number") return { price, name };
    }
    return { price: null, name: null };
  } catch {
    return { price: null, name: null };
  }
}

// Compose a single quote
async function resolveQuote(symbol) {
  const sym = (symbol || "").toUpperCase();

  // Parallel provider calls with safe timeouts
  const [polyTrade, polyPrev, alpha, yq] = await Promise.all([
    polygonLastTrade(sym),
    polygonPrevClose(sym),
    alphaGlobalQuote(sym),
    yahooQuote(sym)
  ]);

  // Price priority: Polygon last -> Yahoo -> Alpha -> Google
  let price = polyTrade.price ?? yq.price ?? alpha.price ?? null;
  let name = yq.name ?? null;

  // If still no price, try Google quickly
  if (price == null) {
    const g = await googleFinanceFallback(sym);
    price = g.price ?? null;
    name = name ?? g.name ?? null;
  }

  // Previous close from Polygon or Yahoo
  const prevClose = polyPrev.prevClose ?? yq.prevClose ?? null;

  // Change calculations:
  let change_value = null;
  let change = null;

  if (typeof price === "number" && typeof prevClose === "number" && prevClose > 0) {
    change_value = price - prevClose;
    change = (change_value / prevClose) * 100;
  } else {
    // fallback to provider change fields
    change_value = alpha.changeVal ?? yq.changeVal ?? null;
    change = alpha.changePct ?? yq.changePct ?? null;
  }

  return {
    symbol: sym,
    name: name ?? sym,
    price: typeof price === "number" ? price : null,
    change: typeof change === "number" ? change : null,
    change_value: typeof change_value === "number" ? change_value : null
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    const symbols = Array.isArray(payload?.symbols) ? payload.symbols : [];
    if (symbols.length === 0) {
      return Response.json([], { status: 200 });
    }

    // Limit concurrency to avoid upstream throttling (batch in chunks of 5)
    const out = [];
    const chunkSize = 5;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const results = await Promise.all(chunk.map((s) => resolveQuote(s).catch(() => ({
        symbol: (s || "").toUpperCase(),
        name: (s || "").toUpperCase(),
        price: null, change: null, change_value: null
      }))));
      out.push(...results);
    }

    return Response.json(out, { status: 200 });
  } catch (error) {
    return Response.json({ error: error?.message || "Unknown error" }, { status: 500 });
  }
});
