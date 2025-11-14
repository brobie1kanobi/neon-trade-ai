import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

/**
 * Get Kraken Market Prices - FOR AI ASSISTANT
 * Fetches real-time market prices for crypto assets from Kraken's public API
 * This function provides the AI assistant with current USD prices for all holdings
 */

const KRAKEN_PUBLIC_API = 'https://api.kraken.com/0/public/Ticker';

// Map Kraken asset codes to standard symbols
function parseKrakenSymbol(krakenCode) {
  const symbolMap = {
    'XXBT': 'BTC',
    'XBT': 'BTC',
    'XETH': 'ETH',
    'ETH': 'ETH',
    'XXRP': 'XRP',
    'XRP': 'XRP',
    'XLTC': 'LTC',
    'LTC': 'LTC',
    'XXLM': 'XLM',
    'XLM': 'XLM',
    'XZEC': 'ZEC',
    'ZEC': 'ZEC',
    'ADA': 'ADA',
    'SOL': 'SOL',
    'DOT': 'DOT',
    'DOGE': 'DOGE',
    'LINK': 'LINK',
    'UNI': 'UNI',
    'MATIC': 'MATIC',
    'ATOM': 'ATOM',
    'AVAX': 'AVAX',
    'BCH': 'BCH',
    'TRX': 'TRX',
    'USDT': 'USDT',
    'USDC': 'USDC',
    'ZUSD': 'USD',
    'USD': 'USD'
  };
  
  // Remove X or Z prefix
  let cleaned = krakenCode;
  if (krakenCode.startsWith('X') && krakenCode !== 'XRP') {
    cleaned = krakenCode.substring(1);
  }
  if (krakenCode.startsWith('Z')) {
    cleaned = krakenCode.substring(1);
  }
  
  return symbolMap[cleaned] || symbolMap[krakenCode] || cleaned;
}

// Build Kraken trading pair
function buildKrakenPair(symbol) {
  const pairMap = {
    'BTC': 'XXBTZUSD',
    'ETH': 'XETHZUSD',
    'XRP': 'XXRPZUSD',
    'LTC': 'XLTCZUSD',
    'SOL': 'SOLUSD',
    'ADA': 'ADAUSD',
    'DOT': 'DOTUSD',
    'DOGE': 'DOGEUSD',
    'LINK': 'LINKUSD',
    'UNI': 'UNIUSD',
    'MATIC': 'MATICUSD',
    'ATOM': 'ATOMUSD',
    'AVAX': 'AVAXUSD',
    'BCH': 'BCHUSD',
    'TRX': 'TRXUSD',
    'XLM': 'XXLMZUSD',
    'ZEC': 'XZECZUSD'
  };
  
  return pairMap[symbol] || `${symbol}USD`;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth with timeout
    const userPromise = base44.auth.me();
    const user = await Promise.race([
      userPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 2000))
    ]);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[getKrakenMarketPrices] User:', user.email);

    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // No body - that's okay, we'll fetch all prices
    }

    const { symbols, pairs } = body;

    // If specific symbols provided, build pairs
    let queryPairs = '';
    if (symbols && Array.isArray(symbols) && symbols.length > 0) {
      const krakenPairs = symbols.map(sym => buildKrakenPair(sym.toUpperCase()));
      queryPairs = krakenPairs.join(',');
      console.log('[getKrakenMarketPrices] Fetching specific pairs:', queryPairs);
    } else if (pairs && typeof pairs === 'string') {
      queryPairs = pairs;
      console.log('[getKrakenMarketPrices] Fetching pairs:', queryPairs);
    } else {
      console.log('[getKrakenMarketPrices] Fetching all pairs');
    }

    // Fetch from Kraken public API
    const url = queryPairs 
      ? `${KRAKEN_PUBLIC_API}?pair=${queryPairs}`
      : KRAKEN_PUBLIC_API;

    console.log('[getKrakenMarketPrices] Calling:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'NeonTrade-AI-Assistant/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error && data.error.length > 0) {
      console.error('[getKrakenMarketPrices] Kraken API error:', data.error);
      return Response.json({
        success: false,
        error: data.error.join(', ')
      }, { status: 200 });
    }

    // Parse ticker data
    const prices = {};
    const result = data.result || {};

    for (const [pair, ticker] of Object.entries(result)) {
      try {
        // Extract base asset from pair
        let baseAsset = pair;
        
        // Remove common USD suffixes
        baseAsset = baseAsset.replace(/ZUSD$|USD$/g, '');
        
        // Parse to standard symbol
        const symbol = parseKrakenSymbol(baseAsset);
        
        // Get current price (last trade)
        const lastPrice = parseFloat(ticker.c?.[0]) || 0;
        const bidPrice = parseFloat(ticker.b?.[0]) || 0;
        const askPrice = parseFloat(ticker.a?.[0]) || 0;
        const volume24h = parseFloat(ticker.v?.[1]) || 0;
        const high24h = parseFloat(ticker.h?.[1]) || 0;
        const low24h = parseFloat(ticker.l?.[1]) || 0;
        const vwap24h = parseFloat(ticker.p?.[1]) || 0;
        const openPrice = parseFloat(ticker.o) || 0;
        
        // Calculate 24h change
        const change24h = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0;
        
        prices[symbol] = {
          symbol,
          pair,
          price: lastPrice,
          bid: bidPrice,
          ask: askPrice,
          volume_24h: volume24h,
          high_24h: high24h,
          low_24h: low24h,
          vwap_24h: vwap24h,
          open_price: openPrice,
          change_24h_percent: change24h,
          timestamp: new Date().toISOString()
        };
        
        console.log(`[getKrakenMarketPrices] ${symbol}: $${lastPrice.toFixed(2)}`);
        
      } catch (err) {
        console.error('[getKrakenMarketPrices] Error parsing', pair, ':', err.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log('[getKrakenMarketPrices] ✅ Fetched', Object.keys(prices).length, 'prices in', duration, 'ms');

    return Response.json({
      success: true,
      prices,
      count: Object.keys(prices).length,
      timestamp: new Date().toISOString(),
      duration
    }, { status: 200 });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[getKrakenMarketPrices] ❌ Error:', error.message);
    
    return Response.json({
      success: false,
      error: error.message || 'Failed to fetch market prices',
      duration
    }, { status: 200 });
  }
});