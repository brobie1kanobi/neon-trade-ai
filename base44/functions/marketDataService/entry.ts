import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * CENTRALIZED MARKET DATA SERVICE
 * 
 * Provides normalized, cached market data from multiple sources.
 * Implements stale-while-revalidate pattern for optimal performance.
 * 
 * Data Sources:
 * - Kraken (primary for crypto in live mode)
 * - Coingecko (crypto backup)
 * - Alpha Vantage (stocks)
 * - Polygon.io (stocks backup)
 * 
 * Features:
 * - TTL caching with stale-while-revalidate
 * - Rate limit batching
 * - Normalized response format
 * - Automatic failover
 */

// Cache TTLs in milliseconds
const CACHE_TTL = {
  PRICE: 30 * 1000,           // 30 seconds for live prices
  PRICE_STALE: 5 * 60 * 1000, // 5 minutes stale threshold
  CHART: 5 * 60 * 1000,       // 5 minutes for chart data
  METADATA: 24 * 60 * 60 * 1000 // 24 hours for asset metadata
};

// In-memory cache
const cache = new Map();

function getCacheKey(type, symbol, params = {}) {
  return `${type}:${symbol}:${JSON.stringify(params)}`;
}

function setCache(key, data, ttl) {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return { data: null, isStale: true, exists: false };
  
  const age = Date.now() - entry.timestamp;
  const isExpired = age > entry.ttl;
  const isStale = age > entry.ttl / 2; // Consider stale at half TTL
  
  return {
    data: entry.data,
    isStale,
    isExpired,
    exists: true,
    age
  };
}

/**
 * Normalize price data to standard format
 */
function normalizePrice(rawData, source) {
  return {
    symbol: rawData.symbol,
    price: parseFloat(rawData.price || rawData.current_price || 0),
    change_24h: parseFloat(rawData.change_24h || rawData.price_change_24h || 0),
    change_24h_percent: parseFloat(rawData.change_24h_percent || rawData.price_change_percentage_24h || rawData.changePct || 0),
    volume_24h: parseFloat(rawData.volume_24h || rawData.total_volume || 0),
    market_cap: parseFloat(rawData.market_cap || 0),
    high_24h: parseFloat(rawData.high_24h || 0),
    low_24h: parseFloat(rawData.low_24h || 0),
    last_updated: rawData.last_updated || new Date().toISOString(),
    source
  };
}

/**
 * Fetch price from Kraken
 */
async function fetchKrakenPrice(symbol) {
  try {
    const pair = symbol.includes('/') ? symbol : `${symbol}/USD`;
    const krakenPair = pair.replace('/', '');
    
    const response = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`);
    const data = await response.json();
    
    if (data.error && data.error.length > 0) {
      throw new Error(data.error[0]);
    }
    
    const result = Object.values(data.result || {})[0];
    if (!result) throw new Error('No data');
    
    return normalizePrice({
      symbol,
      price: result.c?.[0] || result.a?.[0],
      high_24h: result.h?.[1],
      low_24h: result.l?.[1],
      volume_24h: result.v?.[1],
      change_24h_percent: ((parseFloat(result.c?.[0]) - parseFloat(result.o)) / parseFloat(result.o)) * 100
    }, 'kraken');
  } catch (e) {
    console.warn(`[marketDataService] Kraken price failed for ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Fetch price from Coingecko
 */
async function fetchCoingeckoPrice(symbol, apiKey) {
  try {
    // Map common symbols to Coingecko IDs
    const idMap = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
      'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin',
      'DOT': 'polkadot', 'LINK': 'chainlink', 'AVAX': 'avalanche-2',
      'MATIC': 'matic-network', 'POL': 'matic-network'
    };
    
    const id = idMap[symbol.toUpperCase()] || symbol.toLowerCase();
    
    const url = apiKey 
      ? `https://pro-api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true&x_cg_pro_api_key=${apiKey}`
      : `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data[id]) throw new Error('No data');
    
    const coin = data[id];
    return normalizePrice({
      symbol,
      price: coin.usd,
      change_24h_percent: coin.usd_24h_change,
      volume_24h: coin.usd_24h_vol,
      market_cap: coin.usd_market_cap
    }, 'coingecko');
  } catch (e) {
    console.warn(`[marketDataService] Coingecko price failed for ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Get price with caching and failover
 */
async function getPrice(symbol, options = {}) {
  const { preferKraken = true, apiKey } = options;
  const cacheKey = getCacheKey('price', symbol);
  
  // Check cache first
  const cached = getCache(cacheKey);
  if (cached.exists && !cached.isExpired) {
    // If stale but not expired, return cached and refresh in background
    if (cached.isStale) {
      // Fire-and-forget background refresh
      refreshPriceInBackground(symbol, options);
    }
    return { ...cached.data, fromCache: true };
  }
  
  // Fetch fresh data with failover
  let price = null;
  
  if (preferKraken) {
    price = await fetchKrakenPrice(symbol);
    if (!price) {
      price = await fetchCoingeckoPrice(symbol, apiKey);
    }
  } else {
    price = await fetchCoingeckoPrice(symbol, apiKey);
    if (!price) {
      price = await fetchKrakenPrice(symbol);
    }
  }
  
  if (price) {
    setCache(cacheKey, price, CACHE_TTL.PRICE);
    return { ...price, fromCache: false };
  }
  
  // Return stale data if fresh fetch failed
  if (cached.exists) {
    return { ...cached.data, fromCache: true, isStale: true };
  }
  
  return null;
}

async function refreshPriceInBackground(symbol, options) {
  try {
    const cacheKey = getCacheKey('price', symbol);
    let price = await fetchKrakenPrice(symbol);
    if (!price) {
      price = await fetchCoingeckoPrice(symbol, options.apiKey);
    }
    if (price) {
      setCache(cacheKey, price, CACHE_TTL.PRICE);
    }
  } catch (e) {
    // Ignore background refresh errors
  }
}

/**
 * Batch fetch prices for multiple symbols
 */
async function getBatchPrices(symbols, options = {}) {
  const results = {};
  const uncached = [];
  
  // First pass: get cached prices
  for (const symbol of symbols) {
    const cacheKey = getCacheKey('price', symbol);
    const cached = getCache(cacheKey);
    
    if (cached.exists && !cached.isExpired) {
      results[symbol] = { ...cached.data, fromCache: true };
      if (cached.isStale) {
        uncached.push(symbol);
      }
    } else {
      uncached.push(symbol);
    }
  }
  
  // Second pass: fetch uncached in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const promises = batch.map(sym => getPrice(sym, options));
    const prices = await Promise.all(promises);
    
    prices.forEach((price, idx) => {
      if (price) {
        results[batch[idx]] = price;
      }
    });
    
    // Rate limit between batches
    if (i + BATCH_SIZE < uncached.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  return results;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json().catch(() => ({}));
    const { action, symbols = [], symbol, options = {} } = body;
    
    // Get API key from environment
    const apiKey = Deno.env.get('COINGECKO_API_KEY');
    const fullOptions = { ...options, apiKey };
    
    switch (action) {
      case 'getPrice': {
        if (!symbol) {
          return Response.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const price = await getPrice(symbol, fullOptions);
        return Response.json({ success: true, price });
      }
      
      case 'getBatchPrices': {
        if (!symbols.length) {
          return Response.json({ error: 'Missing symbols' }, { status: 400 });
        }
        const prices = await getBatchPrices(symbols, fullOptions);
        return Response.json({ success: true, prices });
      }
      
      case 'clearCache': {
        cache.clear();
        return Response.json({ success: true, message: 'Cache cleared' });
      }
      
      case 'getCacheStats': {
        return Response.json({
          success: true,
          stats: {
            entries: cache.size,
            keys: Array.from(cache.keys())
          }
        });
      }
      
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('[marketDataService] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});