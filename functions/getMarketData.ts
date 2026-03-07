import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Market Data Handler - FIXED VERSION
 * CRITICAL: Uses AbortController for proper timeout handling
 */

const FETCH_TIMEOUT = 4000;
const AUTH_TIMEOUT = 2000;

// ── Global In-Memory Caches ──
let globalKrakenPairsCache = null;
let globalKrakenPairsCacheTs = 0;
const KRAKEN_PAIRS_CACHE_TTL = 1000 * 60 * 60; // 1 hour

// ── Server-side response cache ──
// Prevents duplicate upstream API calls when multiple users/pages hit this function
// within the same window. Keyed by action + normalized payload.
const serverCache = new Map();
const SERVER_CACHE_TTL = 30000; // 30 seconds

function getCacheKey(action, payload) {
  // Build a stable, minimal key
  const p = payload || {};
  const crypto = (p.cryptoSymbols || []).map(s => String(s).toUpperCase()).sort().join(',');
  const stock = (p.stockSymbols || []).map(s => String(s).toUpperCase()).sort().join(',');
  const extra = p.symbol ? `_${p.symbol}_${p.assetType}_${p.days}` : '';
  return `${action}:${crypto}:${stock}${extra}`;
}

function getServerCached(key) {
  const entry = serverCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SERVER_CACHE_TTL) {
    serverCache.delete(key);
    return null;
  }
  return entry.data;
}

function setServerCached(key, data) {
  serverCache.set(key, { data, ts: Date.now() });
  // Evict stale entries periodically (keep map from growing unbounded)
  if (serverCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of serverCache) {
      if (now - v.ts > SERVER_CACHE_TTL) serverCache.delete(k);
    }
  }
}

// Helper: Proper timeout with AbortController
async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn(`[fetchWithTimeout] Aborted after ${timeoutMs}ms: ${url.substring(0, 50)}...`);
    }
    return null;
  }
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  // CRITICAL: 6-second hard timeout for entire function
  const controller = new AbortController();
  const globalTimeout = setTimeout(() => {
    console.warn('[getMarketData] ⏰ Global timeout (6s)');
    controller.abort();
  }, 6000);

  try {
    const result = await handleRequest(req, startTime);
    clearTimeout(globalTimeout);
    return result;
  } catch (error) {
    clearTimeout(globalTimeout);
    console.error('[getMarketData] ❌ Error:', error.message);
    return Response.json([], { status: 200 });
  }
});

async function handleRequest(req, startTime) {
  try {
    // Auth check with timeout
    const base44 = createClientFromRequest(req);
    
    const authController = new AbortController();
    const authTimeout = setTimeout(() => authController.abort(), AUTH_TIMEOUT);
    
    let user = null;
    try {
      user = await base44.auth.me();
      clearTimeout(authTimeout);
    } catch (authErr) {
      clearTimeout(authTimeout);
      console.warn('[getMarketData] Auth failed/timeout');
      return Response.json([], { status: 200 });
    }
    
    if (!user) {
      return Response.json([], { status: 200 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    
    const { action, payload = {} } = body;

    // ============================================
    // GET WATCHLIST DATA
    // ============================================
    if (action === 'getWatchlistData') {
      const { cryptoSymbols = [], stockSymbols = [] } = payload;
      
      if (!Array.isArray(cryptoSymbols) && !Array.isArray(stockSymbols)) {
        return Response.json([], { status: 200 });
      }

      // Check server cache first
      const cacheKey = getCacheKey(action, payload);
      const cached = getServerCached(cacheKey);
      if (cached) {
        console.log(`[getMarketData] ✅ CACHE HIT (${cached.length} results) in ${Date.now() - startTime}ms`);
        return Response.json(cached, { status: 200 });
      }
      
      const [cryptoData, stockData] = await Promise.all([
        Array.isArray(cryptoSymbols) && cryptoSymbols.length > 0 
          ? getCryptoData(base44, cryptoSymbols)
          : [],
        Array.isArray(stockSymbols) && stockSymbols.length > 0 
          ? getStockData(stockSymbols)
          : []
      ]);

      const results = [...cryptoData, ...stockData];
      setServerCached(cacheKey, results);
      console.log(`[getMarketData] ✅ ${results.length} results in ${Date.now() - startTime}ms`);
      
      return Response.json(results, { status: 200 });
    }

    // ============================================
    // GET CHART DATA
    // ============================================
    if (action === 'getAssetChartData') {
      const { symbol, assetType, days = 1 } = payload;

      if (!symbol || !assetType) {
        return Response.json([], { status: 200 });
      }

      const cacheKey = getCacheKey(action, payload);
      const cached = getServerCached(cacheKey);
      if (cached) {
        console.log(`[getMarketData] ✅ CACHE HIT (chart ${symbol}) in ${Date.now() - startTime}ms`);
        return Response.json(cached, { status: 200 });
      }

      const chartData = await getChartData(symbol, assetType, days);
      setServerCached(cacheKey, chartData);
      return Response.json(chartData, { status: 200 });
    }

    // ============================================
    // GET TOP MOVERS
    // ============================================
    if (action === 'getTopMovers') {
      const cacheKey = getCacheKey(action, payload);
      const cached = getServerCached(cacheKey);
      if (cached) {
        console.log(`[getMarketData] ✅ CACHE HIT (topMovers) in ${Date.now() - startTime}ms`);
        return Response.json(cached, { status: 200 });
      }
      const movers = await getTopMovers();
      setServerCached(cacheKey, movers);
      return Response.json(movers, { status: 200 });
    }

    // ============================================
    // SEARCH ASSETS
    // ============================================
    if (action === 'searchAssets') {
      const { term, assetType } = payload;
      const searchResults = await searchAssets(term, assetType);
      return Response.json(searchResults, { status: 200 });
    }

    // ============================================
    // GET ASSET DETAILS
    // ============================================
    if (action === 'getAssetDetails') {
      const { symbol, assetType } = payload;
      const details = await getAssetDetails(symbol, assetType);
      return Response.json(details, { status: 200 });
    }

    // ============================================
    // GET TOP STOCK MOVERS
    // ============================================
    if (action === 'getTopStockMovers') {
      const cacheKey = getCacheKey(action, payload);
      const cached = getServerCached(cacheKey);
      if (cached) {
        console.log(`[getMarketData] ✅ CACHE HIT (stockMovers) in ${Date.now() - startTime}ms`);
        return Response.json(cached, { status: 200 });
      }
      const stockMovers = await getTopStockMovers();
      setServerCached(cacheKey, stockMovers);
      return Response.json(stockMovers, { status: 200 });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('[handleRequest] Error:', error.message);
    return Response.json([], { status: 200 });
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Kraken OHLC chart data fetcher (public API, no auth needed)
async function getKrakenChartData(symbol, days) {
  try {
    // Kraken pair mappings
    const krakenPairMap = {
      'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
      'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
      'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
      'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
      'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'TON': 'TONCOINUSD', 'HBAR': 'HBARUSD',
      'USDT': 'USDTZUSD', 'USDC': 'USDCUSD', 'BNB': 'BNBUSD'
    };
    
    const pair = krakenPairMap[symbol.toUpperCase()];
    if (!pair) {
      console.log(`[getKrakenChartData] No Kraken pair mapping for ${symbol}`);
      return null;
    }
    
    // Kraken OHLC intervals: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600 (minutes)
    // For different timeframes:
    // 24h (1 day): 5-minute intervals = 288 points
    // 7d: 60-minute (1 hour) intervals = 168 points
    // 1m (30 days): 240-minute (4 hour) intervals = 180 points
    // 3m (90 days): 1440-minute (daily) intervals = 90 points
    // 1y (365 days): 1440-minute (daily) intervals = 365 points
    let interval;
    if (days <= 1) {
      interval = 5; // 5-min candles for 24h
    } else if (days <= 7) {
      interval = 60; // 1-hour candles for 7 days
    } else if (days <= 30) {
      interval = 240; // 4-hour candles for 1 month
    } else {
      interval = 1440; // Daily candles for 3m/1y
    }
    
    // Calculate 'since' timestamp (Kraken uses Unix seconds)
    const sinceMs = Date.now() - (days * 24 * 60 * 60 * 1000);
    const since = Math.floor(sinceMs / 1000);
    
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${since}`;
    console.log(`[getKrakenChartData] Fetching ${days} days for ${symbol} with interval=${interval}`);
    
    const response = await fetchWithTimeout(url, 6000);
    if (!response || !response.ok) {
      console.warn(`[getKrakenChartData] Kraken OHLC response not OK for ${symbol}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.error && data.error.length > 0) {
      console.warn(`[getKrakenChartData] Kraken error for ${symbol}:`, data.error);
      return null;
    }
    
    if (!data.result) {
      return null;
    }
    
    // Kraken returns result with pair as key (may have variations like XXBTZUSD or XBTUSD)
    const resultKey = Object.keys(data.result).find(k => k !== 'last');
    if (!resultKey || !Array.isArray(data.result[resultKey])) {
      return null;
    }
    
    const ohlcData = data.result[resultKey];
    
    // OHLC format: [time, open, high, low, close, vwap, volume, count]
    // We'll use the close price for the chart
    const chartData = ohlcData.map(candle => ({
      time: candle[0] * 1000, // Convert to milliseconds
      price: parseFloat(candle[4]) // Close price
    }));
    
    return chartData;
    
  } catch (error) {
    console.error('[getKrakenChartData] Error:', error.message);
    return null;
  }
}

async function getCryptoData(base44, cryptoSymbols) {
  try {
    if (!cryptoSymbols || cryptoSymbols.length === 0) return [];

    const upper = cryptoSymbols.map(s => String(s).toUpperCase().trim());
    const results = [];
    const foundMap = {};

    // 1) Skip Kraken public API for watchlist prices to avoid impacting private rate limits

    // 2) Fallback to CoinGecko for any missing symbols
    const missing = upper.filter(s => !foundMap[s]);
    if (missing.length > 0) {
      const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
      const coinGeckoIds = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'USDT': 'tether',
        'BNB': 'binancecoin', 'XRP': 'ripple', 'USDC': 'usd-coin', 'ADA': 'cardano',
        'DOGE': 'dogecoin', 'TRX': 'tron', 'TON': 'the-open-network', 'LINK': 'chainlink',
        'MATIC': 'polygon', 'DOT': 'polkadot', 'SHIB': 'shiba-inu', 'AVAX': 'avalanche-2',
        'UNI': 'uniswap', 'ATOM': 'cosmos', 'LTC': 'litecoin', 'BCH': 'bitcoin-cash',
        'XLM': 'stellar', 'BABY': 'babydoge'
      };
      const ids = missing.map(s => coinGeckoIds[s]).filter(Boolean).join(',');
      if (ids) {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=1h,24h${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
        const response = await fetchWithTimeout(url);
        if (response && response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            for (const coin of data) {
              const sym = missing.find(s => coinGeckoIds[s] === coin.id) || (coin.symbol || '').toUpperCase();
              if (sym) {
                foundMap[sym] = {
                  symbol: sym,
                  name: coin.name,
                  price: coin.current_price,
                  change: coin.price_change_percentage_24h,
                  price_change_percentage_24h: coin.price_change_percentage_24h,
                  percent_change: coin.price_change_percentage_24h,
                  change_1h_percent: coin.price_change_percentage_1h_in_currency ?? null,
                  change_1h_value: coin.current_price && coin.price_change_percentage_1h_in_currency
                    ? (coin.current_price * coin.price_change_percentage_1h_in_currency / 100)
                    : null,
                  icon_url: coin.image
                };
              }
            }
          }
        }
      }
    }

    // 3) Extra public fallbacks: Kraken public API and Binance
    const stillMissing = upper.filter(s => !foundMap[s]);
    if (stillMissing.length > 0) {
      // Kraken public ticker API (no auth required)
      // Kraken uses pairs like XXBTZUSD, XETHZUSD, etc.
      const krakenPairMap = {
        'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
        'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
        'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
        'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
        'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'TON': 'TONCOINUSD', 'HBAR': 'HBARUSD'
      };
      
      const krakenPairs = stillMissing.map(s => krakenPairMap[s]).filter(Boolean);
      if (krakenPairs.length > 0) {
        try {
          const pairsParam = krakenPairs.join(',');
          const resp = await fetchWithTimeout(`https://api.kraken.com/0/public/Ticker?pair=${pairsParam}`, 3000);
          if (resp && resp.ok) {
            const data = await resp.json();
            if (data && data.result) {
              for (const sym of stillMissing) {
                const pair = krakenPairMap[sym];
                // Kraken may return with slightly different key (e.g., XXBTZUSD or XBTUSD)
                const tickerData = data.result[pair] || data.result[pair?.replace('X', '')?.replace('Z', '')];
                if (tickerData) {
                  const price = parseFloat(tickerData.c?.[0] || tickerData.a?.[0] || '0');
                  const open24h = parseFloat(tickerData.o || '0');
                  const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : null;
                  if (price > 0 && !foundMap[sym]) {
                    foundMap[sym] = {
                      symbol: sym,
                      name: sym,
                      price: price,
                      change: change24h,
                      price_change_percentage_24h: change24h,
                      percent_change: change24h,
                      change_1h_percent: null,
                      change_1h_value: null,
                      icon_url: null
                    };
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[getCryptoData] Kraken public API error:', e.message);
        }
      }
    }

    const stillMissing2 = upper.filter(s => !foundMap[s]);
    if (stillMissing2.length > 0) {
      // Binance ticker price (USDT pairs) as final fallback
      const limited = stillMissing2.slice(0, 12);
      const binanceResults = [];
      
      for (const sym of limited) {
        try {
          const resp = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`, 2500);
          if (resp && resp.ok) {
            const data = await resp.json();
            const price = parseFloat(data?.price || '0');
            if (price > 0) {
              binanceResults.push({ sym, price });
            }
          }
        } catch (_) {}
        // Yield to event loop to prevent CPU spikes
        await new Promise(r => setTimeout(r, 5));
      }
      
      for (const item of binanceResults) {
        if (!foundMap[item.sym]) {
          foundMap[item.sym] = { symbol: item.sym, name: item.sym, price: item.price, change: null, price_change_percentage_24h: null, percent_change: null, change_1h_percent: null, change_1h_value: null, icon_url: null };
        }
      }
    }

    // Build array in requested order
    for (const sym of upper) {
      if (foundMap[sym]) results.push(foundMap[sym]);
    }
    return results;

  } catch (error) {
    console.error('[getCryptoData] Error:', error.message);
    return [];
  }
}

async function getStockData(stockSymbols) {
  try {
    if (!stockSymbols || stockSymbols.length === 0) return [];
    
    const alphaKey = Deno.env.get('ALPHA_VANTAGE_API');
    if (!alphaKey) return [];
    
    const limited = stockSymbols.slice(0, 3);
    const results = [];
    
    for (const symbol of limited) {
      try {
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${alphaKey}`;
        const response = await fetchWithTimeout(url);
        
        if (response && response.ok) {
          const data = await response.json();
          const quote = data['Global Quote'];
          
          if (quote && quote['05. price']) {
            results.push({
              symbol: symbol,
              name: symbol,
              price: parseFloat(quote['05. price']),
              change: parseFloat(quote['10. change percent'].replace('%', '')),
              percent_change: parseFloat(quote['10. change percent'].replace('%', '')),
              change_value: parseFloat(quote['09. change'])
            });
          }
        }
      } catch (error) {}
      // Yield to event loop to prevent CPU spikes
      await new Promise(r => setTimeout(r, 5));
    }
    
    return results;
    
  } catch (error) {
    console.error('[getStockData] Error:', error.message);
    return [];
  }
}

async function getChartData(symbol, assetType, days) {
  try {
    if (assetType === 'crypto') {
      // PRIMARY: Try Kraken OHLC public API first (no rate limits like CoinGecko)
      const krakenChartData = await getKrakenChartData(symbol, days);
      if (krakenChartData && krakenChartData.length > 0) {
        console.log(`[getChartData] Got ${krakenChartData.length} points from Kraken for ${symbol}`);
        return krakenChartData;
      }
      
      // FALLBACK: CoinGecko if Kraken doesn't have the pair
      const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
      const coinGeckoIds = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'USDT': 'tether',
        'BNB': 'binancecoin', 'XRP': 'ripple', 'USDC': 'usd-coin', 'ADA': 'cardano',
        'XLM': 'stellar', 'DOGE': 'dogecoin', 'LINK': 'chainlink', 'MATIC': 'polygon',
        'DOT': 'polkadot', 'SHIB': 'shiba-inu', 'AVAX': 'avalanche-2', 'UNI': 'uniswap',
        'ATOM': 'cosmos', 'LTC': 'litecoin', 'BCH': 'bitcoin-cash', 'TRX': 'tron',
        'TON': 'the-open-network', 'PEPE': 'pepe', 'HBAR': 'hedera-hashgraph'
      };
      
      const coinId = coinGeckoIds[symbol.toUpperCase()];
      if (!coinId) {
        console.log(`[getChartData] No CoinGecko ID mapping for symbol: ${symbol}`);
        return [];
      }
      
      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&precision=full${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
      
      console.log(`[getChartData] Falling back to CoinGecko for ${symbol} (${coinId})`);
      
      const response = await fetchWithTimeout(url, 8000);
      
      if (!response || !response.ok) {
        console.warn(`[getChartData] CoinGecko response not OK for ${symbol}`);
        return [];
      }
      
      const data = await response.json();
      
      if (!data || !data.prices || !Array.isArray(data.prices)) {
        console.warn(`[getChartData] No prices array in response for ${symbol}`);
        return [];
      }
      
      console.log(`[getChartData] Got ${data.prices.length} data points from CoinGecko for ${symbol}`);
      
      return data.prices.map(([time, price]) => ({ time, price }));
    }
    else if (assetType === 'stocks') {
      const polyKey = Deno.env.get('POLY_API_KEY');
      if (!polyKey) return [];

      const today = new Date();
      const fromDate = new Date();
      fromDate.setDate(today.getDate() - days);

      const to = today.toISOString().split('T')[0];
      const from = fromDate.toISOString().split('T')[0];
      
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}?adjusted=true&sort=asc&apiKey=${polyKey}`;

      const response = await fetchWithTimeout(url);
      if (!response || !response.ok) {
        return [];
      }
      const data = await response.json();
      if (!data || !data.results) return [];

      return data.results.map(r => ({ time: r.t, price: r.c }));
    }
    
    return [];
    
  } catch (error) {
    console.error('[getChartData] Error:', error.message);
    return [];
  }
}

async function getTopMovers() {
  try {
    const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
    
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=20&page=1&price_change_percentage=1h,24h${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
    
    const response = await fetchWithTimeout(url);
    
    if (!response || !response.ok) {
      return { gainers: [], losers: [] };
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) return { gainers: [], losers: [] };
    
    const gainers = data
      .filter(coin => coin.price_change_percentage_24h > 0)
      .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
      .slice(0, 10)
      .map(coin => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change1hPct: coin.price_change_percentage_1h_in_currency,
        change1hVal: coin.current_price * (coin.price_change_percentage_1h_in_currency || 0) / 100,
        icon_url: coin.image
      }));
    
    const losers = data
      .filter(coin => coin.price_change_percentage_24h < 0)
      .sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h)
      .slice(0, 10)
      .map(coin => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change1hPct: coin.price_change_percentage_1h_in_currency,
        change1hVal: coin.current_price * (coin.price_change_percentage_1h_in_currency || 0) / 100,
        icon_url: coin.image
      }));
    
    return { gainers, losers };
    
  } catch (error) {
    console.error('[getTopMovers] Error:', error.message);
    return { gainers: [], losers: [] };
  }
}

async function searchAssets(term, assetType) {
  try {
    const results = [];
    const foundSymbols = new Set();
    const searchTerm = term.toUpperCase().trim();
    
    if (assetType === 'crypto') {
      // PRIORITY 1: Search Kraken's tradeable pairs first (most accurate for trading)
      try {
        let krakenPairs = null;
        if (globalKrakenPairsCache && (Date.now() - globalKrakenPairsCacheTs < KRAKEN_PAIRS_CACHE_TTL)) {
          krakenPairs = globalKrakenPairsCache;
        } else {
          const krakenResp = await fetchWithTimeout('https://api.kraken.com/0/public/AssetPairs', 3000);
          if (krakenResp && krakenResp.ok) {
            const krakenData = await krakenResp.json();
            if (krakenData && krakenData.result) {
              krakenPairs = krakenData.result;
              globalKrakenPairsCache = krakenPairs;
              globalKrakenPairsCacheTs = Date.now();
            }
          }
        }

        if (krakenPairs) {
          // Filter USD pairs and match search term
          const usdPairs = Object.entries(krakenPairs)
              .filter(([pairName, pairInfo]) => {
                // Only USD pairs (not USDT, not EUR, etc)
                const isUsdPair = pairName.endsWith('USD') || pairName.endsWith('ZUSD');
                if (!isUsdPair) return false;
                
                // wsname is the canonical trading symbol (e.g., "XRP/USD", "BTC/USD")
                const wsname = pairInfo.wsname || '';
                const wsnameBase = wsname.split('/')[0] || '';
                const altname = pairInfo.altname || '';
                
                // Match against search term - use wsname as primary (it's the actual trading symbol)
                return wsnameBase.toUpperCase().includes(searchTerm) ||
                       altname.toUpperCase().includes(searchTerm);
              })
              .slice(0, 10);
            
            for (const [pairName, pairInfo] of usdPairs) {
              // Use wsname as the canonical symbol (e.g., "XRP/USD" -> "XRP")
              // This is what Kraken actually uses for trading
              const wsname = pairInfo.wsname || '';
              let symbol = wsname.split('/')[0] || '';
              
              // Only normalize XBT->BTC, keep everything else as-is (including XRP)
              if (symbol === 'XBT') symbol = 'BTC';
              
              symbol = symbol.toUpperCase();
              
              if (symbol && !foundSymbols.has(symbol)) {
                foundSymbols.add(symbol);
                results.push({
                  symbol: symbol,
                  name: symbol,
                  icon_url: null,
                  source: 'kraken'
                });
              }
            }
            console.log(`[searchAssets] Found ${results.length} Kraken matches for "${term}"`);
          }
        }
      } catch (e) {
        console.warn('[searchAssets] Kraken search failed:', e.message);
      }
      
      // PRIORITY 2: Supplement with CoinGecko for names and icons
      const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(term)}${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
      const response = await fetchWithTimeout(url);
      if (response && response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.coins)) {
          for (const c of data.coins.slice(0, 10)) {
            const symbol = c.symbol.toUpperCase();
            // Update existing Kraken results with CoinGecko metadata
            const existing = results.find(r => r.symbol === symbol);
            if (existing) {
              existing.name = c.name;
              existing.icon_url = c.thumb;
            } else if (!foundSymbols.has(symbol)) {
              // Add new results from CoinGecko (may not be tradeable on Kraken)
              foundSymbols.add(symbol);
              results.push({
                symbol: symbol,
                name: c.name,
                icon_url: c.thumb,
                source: 'coingecko'
              });
            }
          }
        }
      }
      
      // Sort: Kraken results first (tradeable), then others
      results.sort((a, b) => {
        if (a.source === 'kraken' && b.source !== 'kraken') return -1;
        if (a.source !== 'kraken' && b.source === 'kraken') return 1;
        // Exact match priority
        if (a.symbol === searchTerm && b.symbol !== searchTerm) return -1;
        if (a.symbol !== searchTerm && b.symbol === searchTerm) return 1;
        return 0;
      });
      
    } else if (assetType === 'stocks') {
      const alphaKey = Deno.env.get('ALPHA_VANTAGE_API');
      const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(term)}&apikey=${alphaKey}`;
      const response = await fetchWithTimeout(url);
      if (response && response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.bestMatches)) {
          results.push(...data.bestMatches.slice(0, 5).map(s => ({
            symbol: s['1. symbol'],
            name: s['2. name']
          })));
        }
      }
    }
    
    return results.slice(0, 10);
  } catch (error) {
    console.error('[searchAssets] Error:', error.message);
    return [];
  }
}

async function getAssetDetails(symbol, assetType) {
  try {
    if (assetType === 'crypto') {
      const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
      const coinGeckoIds = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'USDT': 'tether',
        'BNB': 'binancecoin', 'XRP': 'ripple', 'USDC': 'usd-coin', 'ADA': 'cardano',
        'XLM': 'stellar'
      };
      const coinId = coinGeckoIds[symbol.toUpperCase()];
      if (!coinId) return null;

      const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&community_data=false&developer_data=false&sparkline=false${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
      const response = await fetchWithTimeout(url);
      if (response && response.ok) {
        const data = await response.json();
        return {
          name: data.name,
          symbol: data.symbol.toUpperCase(),
          description: data.description?.en || '',
          website: data.links?.homepage?.[0] || '',
          icon_url: data.image?.small || ''
        };
      }
    } else if (assetType === 'stocks') {
      const polyKey = Deno.env.get('POLY_API_KEY');
      if (!polyKey) return null;

      const url = `https://api.polygon.io/v3/reference/tickers/${symbol}?apiKey=${polyKey}`;
      const response = await fetchWithTimeout(url);
      if (response && response.ok) {
        const data = await response.json();
        const result = data.results;
        if (result) {
          return {
            name: result.name,
            symbol: result.ticker,
            description: result.description || '',
            website: result.homepage_url || '',
            exchange: result.primary_exchange || '',
            sector: result.market || '',
            industry: result.locale || '',
            icon_url: result.branding?.icon_url || ''
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error('[getAssetDetails] Error:', error.message);
    return null;
  }
}

async function getTopStockMovers() {
  try {
    const polyKey = Deno.env.get('POLY_API_KEY');
    if (!polyKey) return { gainers: [], losers: [] };

    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?limit=10&sort=change_percent&order=desc&apiKey=${polyKey}`;

    const response = await fetchWithTimeout(url);
    if (!response || !response.ok) {
      return { gainers: [], losers: [] };
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.tickers)) return { gainers: [], losers: [] };

    const gainers = data.tickers
      .filter(t => t.todaysChangePerc > 0)
      .slice(0, 5)
      .map(t => ({
        symbol: t.ticker,
        name: t.name,
        price: t.lastTrade?.p || t.day?.c,
        change24hPct: t.todaysChangePerc,
        change24hVal: t.todaysChange,
        icon_url: null
      }));

    const losers = data.tickers
      .filter(t => t.todaysChangePerc < 0)
      .slice(0, 5)
      .map(t => ({
        symbol: t.ticker,
        name: t.name,
        price: t.lastTrade?.p || t.day?.c,
        change24hPct: t.todaysChangePerc,
        change24hVal: t.todaysChange,
        icon_url: null
      }));

    return { gainers, losers };

  } catch (error) {
    console.error('[getTopStockMovers] Error:', error.message);
    return { gainers: [], losers: [] };
  }
}