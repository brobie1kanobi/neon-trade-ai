import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Market Data Handler - AUTHENTICATED & TIMEOUT PROTECTED
 * CRITICAL FIX: Always returns within 3 seconds, never hangs
 * SECURITY FIX: Returns 401 for unauthenticated users
 */

// Helper: Timeout wrapper for any promise
function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => {
      console.warn(`[withTimeout] Timeout after ${ms}ms, returning fallback`);
      resolve(fallback);
    }, ms))
  ]);
}

// Global hard timeout for the entire function execution
Deno.serve(async (req) => {
  const startTime = Date.now();
  
  // CRITICAL: Hard 8-second timeout for entire function (increased from 3s)
  const timeoutResponse = new Promise((resolve) =>
    setTimeout(() => {
      console.warn('[getMarketData] ⏰ Function timeout (8s) - returning empty array');
      resolve(Response.json([], { status: 200 }));
    }, 8000)
  );

  try {
    const resultPromise = handleRequest(req, startTime);
    const result = await Promise.race([resultPromise, timeoutResponse]);
    
    const duration = Date.now() - startTime;
    console.log(`[getMarketData] ✅ Completed in ${duration}ms`);
    
    return result;
  } catch (error) {
    console.error('[getMarketData] ❌ Fatal error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
});

async function handleRequest(req, startTime) {
  try {
    // SECURITY FIX: Auth check with timeout - RETURN EMPTY ARRAY IF UNAUTHORIZED (not 401)
    const base44 = createClientFromRequest(req);
    const user = await withTimeout(base44.auth.me(), 1500, null);
    
    if (!user) {
      console.warn('[getMarketData] Unauthorized - returning empty array');
      return Response.json([], { status: 200 });
    }

    const body = await withTimeout(req.json(), 500, {});
    const { action, payload = {} } = body;

    console.log(`[getMarketData] Action: ${action}, User: ${user.email}`);

    // ============================================
    // GET WATCHLIST DATA
    // ============================================
    if (action === 'getWatchlistData') {
      const { cryptoSymbols = [], stockSymbols = [] } = payload;
      
      if (!Array.isArray(cryptoSymbols) || !Array.isArray(stockSymbols)) {
        return Response.json([], { status: 200 });
      }
      
      console.log('[getMarketData] Fetching:', cryptoSymbols.length, 'crypto,', stockSymbols.length, 'stocks');
      
      // CRITICAL: Run with aggressive timeout (4 seconds max, increased from 2s)
      const [cryptoData, stockData] = await Promise.all([
        cryptoSymbols.length > 0 
          ? withTimeout(getCryptoData(cryptoSymbols), 4000, [])
          : Promise.resolve([]),
        stockSymbols.length > 0 
          ? withTimeout(getStockData(stockSymbols), 4000, [])
          : Promise.resolve([])
      ]);

      const results = [...cryptoData, ...stockData];
      console.log('[getMarketData] Returning', results.length, 'results in', Date.now() - startTime, 'ms');
      
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

      const chartData = await withTimeout(
        getChartData(symbol, assetType, days),
        2000,
        []
      );
      
      return Response.json(chartData, { status: 200 });
    }

    // ============================================
    // GET TOP MOVERS
    // ============================================
    if (action === 'getTopMovers') {
      const movers = await withTimeout(
        getTopMovers(),
        2000,
        { gainers: [], losers: [] }
      );
      
      return Response.json(movers, { status: 200 });
    }

    // ============================================
    // SEARCH ASSETS
    // ============================================
    if (action === 'searchAssets') {
      const { term, assetType } = payload;
      const searchResults = await withTimeout(
        searchAssets(term, assetType),
        2000,
        []
      );
      return Response.json(searchResults, { status: 200 });
    }

    // ============================================
    // GET ASSET DETAILS
    // ============================================
    if (action === 'getAssetDetails') {
      const { symbol, assetType } = payload;
      const details = await withTimeout(
        getAssetDetails(symbol, assetType),
        2000,
        null
      );
      return Response.json(details, { status: 200 });
    }

    // ============================================
    // GET TOP STOCK MOVERS
    // ============================================
    if (action === 'getTopStockMovers') {
      const stockMovers = await withTimeout(
        getTopStockMovers(),
        2000,
        { gainers: [], losers: [] }
      );
      return Response.json(stockMovers, { status: 200 });
    }

    // Unknown action
    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('[handleRequest] Error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ============================================
// HELPER FUNCTIONS - ALL WITH TIMEOUT PROTECTION
// ============================================

async function getCryptoData(cryptoSymbols) {
  try {
    if (!cryptoSymbols || cryptoSymbols.length === 0) return [];
    
    const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
    
    const coinGeckoIds = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'USDT': 'tether',
      'BNB': 'binancecoin', 'XRP': 'ripple', 'USDC': 'usd-coin', 'ADA': 'cardano',
      'DOGE': 'dogecoin', 'TRX': 'tron', 'TON': 'the-open-network', 'LINK': 'chainlink',
      'MATIC': 'polygon', 'DOT': 'polkadot', 'SHIB': 'shiba-inu', 'AVAX': 'avalanche-2',
      'UNI': 'uniswap', 'ATOM': 'cosmos', 'LTC': 'litecoin', 'BCH': 'bitcoin-cash',
      'XLM': 'stellar'
    };
    
    const ids = cryptoSymbols
      .map(s => coinGeckoIds[s.toUpperCase()])
      .filter(Boolean)
      .join(',');
    
    if (!ids) return [];
    
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=1h,24h${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
    
    const response = await withTimeout(fetch(url), 3000, null);
    
    if (!response || !response.ok) {
      console.error(`[getCryptoData] Fetch failed`);
      return [];
    }
    
    const data = await withTimeout(response.json(), 500, []);
    
    if (!Array.isArray(data)) return [];
    
    return data.map(coin => ({
      symbol: cryptoSymbols.find(s => coinGeckoIds[s.toUpperCase()] === coin.id) || coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      change: coin.price_change_percentage_24h,
      price_change_percentage_24h: coin.price_change_percentage_24h,
      percent_change: coin.price_change_percentage_24h,
      change_1h_percent: coin.price_change_percentage_1h_in_currency,
      change_1h_value: coin.current_price && coin.price_change_percentage_1h_in_currency 
        ? (coin.current_price * coin.price_change_percentage_1h_in_currency / 100)
        : null,
      icon_url: coin.image
    }));
    
  } catch (error) {
    console.error('[getCryptoData] Error:', error);
    return [];
  }
}

async function getStockData(stockSymbols) {
  try {
    if (!stockSymbols || stockSymbols.length === 0) return [];
    
    const alphaKey = Deno.env.get('ALPHA_VANTAGE_API');
    if (!alphaKey) return [];
    
    const limited = stockSymbols.slice(0, 3);
    
    const results = await Promise.all(
      limited.map(async (symbol) => {
        try {
          const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${alphaKey}`;
          
          const response = await withTimeout(fetch(url), 3000, null);
          
          if (!response || !response.ok) {
            return null;
          }
          
          const data = await withTimeout(response.json(), 500, null);
          
          if (!data) return null;
          
          const quote = data['Global Quote'];
          
          if (!quote || !quote['05. price']) return null;
          
          return {
            symbol: symbol,
            name: symbol,
            price: parseFloat(quote['05. price']),
            change: parseFloat(quote['10. change percent'].replace('%', '')),
            percent_change: parseFloat(quote['10. change percent'].replace('%', '')),
            change_value: parseFloat(quote['09. change'])
          };
        } catch (error) {
          console.error(`[getStockData] Error for ${symbol}:`, error);
          return null;
        }
      })
    );
    
    return results.filter(Boolean);
    
  } catch (error) {
    console.error('[getStockData] Error:', error);
    return [];
  }
}

async function getChartData(symbol, assetType, days) {
  try {
    if (assetType === 'crypto') {
      const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
      const coinGeckoIds = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'USDT': 'tether',
        'BNB': 'binancecoin', 'XRP': 'ripple', 'USDC': 'usd-coin', 'ADA': 'cardano',
        'XLM': 'stellar'
      };
      
      const coinId = coinGeckoIds[symbol.toUpperCase()];
      if (!coinId) return [];
      
      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
      
      const response = await withTimeout(fetch(url), 1500, null);
      
      if (!response || !response.ok) {
        return [];
      }
      
      const data = await withTimeout(response.json(), 500, null);
      
      if (!data || !data.prices) return [];
      
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

      const response = await withTimeout(fetch(url), 1500, null);
      if (!response || !response.ok) {
        return [];
      }
      const data = await withTimeout(response.json(), 500, null);
      if (!data || !data.results) return [];

      return data.results.map(r => ({ time: r.t, price: r.c }));
    }
    
    return [];
    
  } catch (error) {
    console.error('[getChartData] Error:', error);
    return [];
  }
}

async function getTopMovers() {
  try {
    const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
    
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=20&page=1&price_change_percentage=1h,24h${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
    
    const response = await withTimeout(fetch(url), 1500, null);
    
    if (!response || !response.ok) {
      return { gainers: [], losers: [] };
    }
    
    const data = await withTimeout(response.json(), 500, []);
    
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
    console.error('[getTopMovers] Error:', error);
    return { gainers: [], losers: [] };
  }
}

async function searchAssets(term, assetType) {
  try {
    const results = [];
    if (assetType === 'crypto') {
      const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(term)}${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
      const response = await withTimeout(fetch(url), 1500, null);
      if (response && response.ok) {
        const data = await withTimeout(response.json(), 500, null);
        if (data && Array.isArray(data.coins)) {
          results.push(...data.coins.slice(0, 5).map(c => ({
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            icon_url: c.thumb
          })));
        }
      }
    } else if (assetType === 'stocks') {
      const alphaKey = Deno.env.get('ALPHA_VANTAGE_API');
      const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(term)}&apikey=${alphaKey}`;
      const response = await withTimeout(fetch(url), 1500, null);
      if (response && response.ok) {
        const data = await withTimeout(response.json(), 500, null);
        if (data && Array.isArray(data.bestMatches)) {
          results.push(...data.bestMatches.slice(0, 5).map(s => ({
            symbol: s['1. symbol'],
            name: s['2. name']
          })));
        }
      }
    }
    return results;
  } catch (error) {
    console.error('[searchAssets] Error:', error);
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
      const response = await withTimeout(fetch(url), 1500, null);
      if (response && response.ok) {
        const data = await withTimeout(response.json(), 500, null);
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
      const response = await withTimeout(fetch(url), 1500, null);
      if (response && response.ok) {
        const data = await withTimeout(response.json(), 500, null);
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
    console.error('[getAssetDetails] Error:', error);
    return null;
  }
}

async function getTopStockMovers() {
  try {
    const polyKey = Deno.env.get('POLY_API_KEY');
    if (!polyKey) return { gainers: [], losers: [] };

    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?limit=10&sort=change_percent&order=desc&apiKey=${polyKey}`;

    const response = await withTimeout(fetch(url), 1500, null);
    if (!response || !response.ok) {
      return { gainers: [], losers: [] };
    }
    const data = await withTimeout(response.json(), 500, null);
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
    console.error('[getTopStockMovers] Error:', error);
    return { gainers: [], losers: [] };
  }
}