import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Market Data Handler - FIXED VERSION
 * CRITICAL: Uses AbortController for proper timeout handling
 */

const FETCH_TIMEOUT = 4000;
const AUTH_TIMEOUT = 2000;

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
      
      const [cryptoData, stockData] = await Promise.all([
        Array.isArray(cryptoSymbols) && cryptoSymbols.length > 0 
          ? getCryptoData(base44, cryptoSymbols)
          : [],
        Array.isArray(stockSymbols) && stockSymbols.length > 0 
          ? getStockData(stockSymbols)
          : []
      ]);

      const results = [...cryptoData, ...stockData];
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

      const chartData = await getChartData(symbol, assetType, days);
      return Response.json(chartData, { status: 200 });
    }

    // ============================================
    // GET TOP MOVERS
    // ============================================
    if (action === 'getTopMovers') {
      const movers = await getTopMovers();
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
      const stockMovers = await getTopStockMovers();
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

async function getCryptoData(base44, cryptoSymbols) {
  try {
    if (!cryptoSymbols || cryptoSymbols.length === 0) return [];

    const upper = cryptoSymbols.map(s => String(s).toUpperCase().trim());
    const results = [];
    const foundMap = {};

    // 1) Try Kraken first (fast, real-time)
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('kraken-timeout')), 2500));
      const krakenRes = await Promise.race([
        base44.functions.invoke('getKrakenMarketPrices', { symbols: upper }),
        timeout
      ]);
      const k = krakenRes?.data || krakenRes;
      if (k && k.success && k.prices) {
        for (const sym of upper) {
          const p = k.prices[sym];
          if (p && typeof p.price === 'number' && p.price > 0) {
            foundMap[sym] = {
              symbol: sym,
              name: sym,
              price: p.price,
              change: typeof p.change_24h_percent === 'number' ? p.change_24h_percent : null,
              price_change_percentage_24h: typeof p.change_24h_percent === 'number' ? p.change_24h_percent : null,
              percent_change: typeof p.change_24h_percent === 'number' ? p.change_24h_percent : null,
              change_1h_percent: null,
              change_1h_value: null,
              icon_url: null
            };
          }
        }
      }
    } catch (_e) {
      // Kraken unavailable, will fall back
    }

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
    
    const results = await Promise.all(
      limited.map(async (symbol) => {
        try {
          const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${alphaKey}`;
          
          const response = await fetchWithTimeout(url);
          
          if (!response || !response.ok) {
            return null;
          }
          
          const data = await response.json();
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
          return null;
        }
      })
    );
    
    return results.filter(Boolean);
    
  } catch (error) {
    console.error('[getStockData] Error:', error.message);
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
      
      const response = await fetchWithTimeout(url);
      
      if (!response || !response.ok) {
        return [];
      }
      
      const data = await response.json();
      
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
    if (assetType === 'crypto') {
      const coinGeckoKey = Deno.env.get('COINGECKO_API_KEY');
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(term)}${coinGeckoKey ? `&x_cg_demo_api_key=${coinGeckoKey}` : ''}`;
      const response = await fetchWithTimeout(url);
      if (response && response.ok) {
        const data = await response.json();
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
    return results;
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