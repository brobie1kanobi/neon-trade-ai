import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Get Kraken PnL - Calculates realized and unrealized PnL from Kraken trade history
 * CRITICAL: Uses user auth (NOT service role) to call krakenApi
 */

// Known Kraken pair → base asset mapping
// Kraken uses inconsistent pair naming (XXBTZUSD, SOLUSD, XXLMZUSD, etc.)
const PAIR_TO_BASE = {
  'XXBTZUSD': 'BTC', 'XBTUSDT': 'BTC', 'XBTUSD': 'BTC',
  'XETHZUSD': 'ETH', 'ETHUSDT': 'ETH', 'ETHUSD': 'ETH',
  'SOLUSD': 'SOL', 'SOLUSDT': 'SOL',
  'XXRPZUSD': 'XRP', 'XRPUSDT': 'XRP', 'XRPUSD': 'XRP',
  'ADAUSD': 'ADA', 'ADAUSDT': 'ADA',
  'DOTUSD': 'DOT', 'DOTUSDT': 'DOT',
  'XXLMZUSD': 'XLM', 'XLMUSDT': 'XLM', 'XLMUSD': 'XLM',
  'XDGUSD': 'DOGE', 'XXDGZUSD': 'DOGE', 'DOGEUSD': 'DOGE', 'DOGEUSDT': 'DOGE',
  'LINKUSD': 'LINK', 'LINKUSDT': 'LINK',
  'MATICUSD': 'MATIC', 'MATICUSDT': 'MATIC',
  'AVAXUSD': 'AVAX', 'AVAXUSDT': 'AVAX',
  'UNIUSD': 'UNI', 'UNIUSDT': 'UNI',
  'ATOMUSD': 'ATOM', 'ATOMUSDT': 'ATOM',
  'XLTCZUSD': 'LTC', 'LTCUSD': 'LTC', 'LTCUSDT': 'LTC',
  'BCHUSD': 'BCH', 'BCHUSDT': 'BCH',
  'TRXUSD': 'TRX', 'TRXUSDT': 'TRX',
  'SHIBUSD': 'SHIB', 'SHIBUSDT': 'SHIB',
  'PEPEUSD': 'PEPE', 'PEPEUSDT': 'PEPE',
  'AABORUSD': 'AABOR',
  'BABYUSD': 'BABY', 'BABYDOGEUSD': 'BABYDOGE',
  'NEARUSD': 'NEAR',
  'ALGOUSD': 'ALGO',
  'ICPUSD': 'ICP',
  'FILUSD': 'FIL',
  'SANDUSD': 'SAND',
  'MANAUSD': 'MANA',
  'APEUSD': 'APE',
  'GMTUSD': 'GMT',
  'OPUSD': 'OP',
  'ARBUSD': 'ARB',
  'INJUSD': 'INJ',
  'SUIUSD': 'SUI',
  'TAOUSD': 'TAO',
  'RENDUSD': 'REND',
  'WIFUSD': 'WIF',
  'FLOKIUSD': 'FLOKI',
  'BONKUSD': 'BONK',
};

function extractBaseAsset(pair) {
  // First check the known mapping
  const upper = (pair || '').toUpperCase();
  if (PAIR_TO_BASE[upper]) return PAIR_TO_BASE[upper];
  
  // Fallback: heuristic parsing for unknown pairs
  // Try stripping common quote suffixes
  let base = upper;
  if (base.endsWith('ZUSD')) base = base.slice(0, -4);
  else if (base.endsWith('USDT')) base = base.slice(0, -4);
  else if (base.endsWith('USD')) base = base.slice(0, -3);
  
  // Strip Kraken's X/Z prefix (only if 4-char code like XXBT, XETH)
  if (base.length === 4 && (base.startsWith('X') || base.startsWith('Z'))) {
    base = base.substring(1);
  }
  // Double prefix like XX
  if (base.length >= 2 && base.startsWith('XX')) {
    base = base.substring(2);
  }
  
  // Final known remaps
  if (base === 'XBT') return 'BTC';
  if (base === 'XDG') return 'DOGE';
  
  return base;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await Promise.race([
      base44.auth.me(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
    ]);

    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    // Check Kraken connectivity via secrets
    const hasSecrets = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
    if (!hasSecrets) {
      return Response.json({ success: false, error: 'Kraken not connected', pnl_24h: 0, pnl_lifetime: 0, realized_pnl: 0, unrealized_pnl: 0 }, { status: 200 });
    }

    // CRITICAL: Fetch ALL trades (paginate) for accurate cost basis
    // krakenApi getTradesHistory returns max 50 trades per page
    let allTradesEntries = [];
    let offset = 0;
    let hasMore = true;
    const MAX_PAGES = 10; // Safety limit (500 trades max)
    let page = 0;
    
    while (hasMore && page < MAX_PAGES) {
      const tradesResponse = await Promise.race([
        base44.functions.invoke('krakenApi', { 
          action: 'getTradesHistory', 
          payload: { ofs: offset },
          internal: true 
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Trades timeout')), 12000))
      ]);

      const tradesData = tradesResponse?.data || tradesResponse;
      const tradesArray = tradesData?.trades || [];
      const entries = Array.isArray(tradesArray)
        ? tradesArray.map(t => [t.trade_id || t.txid, t])
        : Object.entries(tradesArray);
      
      if (entries.length === 0) {
        hasMore = false;
      } else {
        allTradesEntries = allTradesEntries.concat(entries);
        offset += entries.length;
        // Kraken returns exactly 50 per page; if less, we've got all
        if (entries.length < 50) hasMore = false;
      }
      page++;
    }
    
    // Sort trades by time ascending (oldest first) for correct avg cost calculation
    allTradesEntries.sort((a, b) => {
      const timeA = parseFloat(a[1].time) || 0;
      const timeB = parseFloat(b[1].time) || 0;
      return timeA - timeB;
    });
    
    // Calculate realized PnL from trades
    const positionMap = {};
    let totalRealizedPnL = 0;
    let realizedPnL24h = 0;
    
    const now = Date.now();
    const ms24h = 24 * 60 * 60 * 1000;

    for (const [txid, trade] of allTradesEntries) {
      const pair = trade.pair || '';
      const type = trade.type || '';
      const vol = parseFloat(trade.vol) || 0;
      const cost = parseFloat(trade.cost) || 0;
      const price = parseFloat(trade.price) || 0;
      const time = parseFloat(trade.time) * 1000;
      
      if (!pair || vol === 0) continue;
      
      const symbol = extractBaseAsset(pair);
      
      if (!positionMap[symbol]) {
        positionMap[symbol] = { 
          totalCost: 0, 
          totalQuantity: 0, 
          avgPrice: 0,
          realizedPnL: 0
        };
      }
      
      if (type === 'buy') {
        positionMap[symbol].totalCost += cost;
        positionMap[symbol].totalQuantity += vol;
        
        if (positionMap[symbol].totalQuantity > 0) {
          positionMap[symbol].avgPrice = positionMap[symbol].totalCost / positionMap[symbol].totalQuantity;
        }
      } else if (type === 'sell') {
        const avgCost = positionMap[symbol].avgPrice || 0;
        const sellRevenue = cost;
        const sellCost = avgCost * vol;
        const pnl = sellRevenue - sellCost;
        
        positionMap[symbol].realizedPnL += pnl;
        totalRealizedPnL += pnl;
        
        if (now - time <= ms24h) {
          realizedPnL24h += pnl;
        }
        
        // Update position after sell
        if (positionMap[symbol].totalQuantity > 0) {
          const sellRatio = Math.min(vol / positionMap[symbol].totalQuantity, 1);
          positionMap[symbol].totalCost -= positionMap[symbol].totalCost * sellRatio;
          positionMap[symbol].totalQuantity = Math.max(0, positionMap[symbol].totalQuantity - vol);
          
          if (positionMap[symbol].totalQuantity > 0) {
            positionMap[symbol].avgPrice = positionMap[symbol].totalCost / positionMap[symbol].totalQuantity;
          }
        }
      }
    }

    // Fetch current balances (krakenApi already normalizes asset names)
    const balanceResponse = await Promise.race([
      base44.functions.invoke('krakenApi', { action: 'getBalance', internal: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Balance timeout')), 10000))
    ]);

    const balanceData = balanceResponse?.data || balanceResponse;
    // krakenApi getBalance returns normalized keys: { SOL: 1.14, BTC: 0.00022, XLM: 190.45, ... }
    const balances = balanceData?.balance || {};
    
    // Get symbols that have a balance (krakenApi already normalized: BTC, SOL, XLM, etc.)
    const symbols = Object.keys(balances)
      .filter(asset => asset !== 'USD' && asset !== 'ZUSD');

    let totalUnrealizedPnL = 0;

    if (symbols.length > 0) {
      try {
        // Fetch current prices from Kraken public API
        const pairMap = {
          BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', XRP: 'XXRPZUSD',
          ADA: 'ADAUSD', DOGE: 'XDGUSD', DOT: 'DOTUSD', LINK: 'LINKUSD',
          MATIC: 'MATICUSD', AVAX: 'AVAXUSD', UNI: 'UNIUSD', ATOM: 'ATOMUSD',
          LTC: 'XLTCZUSD', BCH: 'BCHUSD', XLM: 'XXLMZUSD', TRX: 'TRXUSD',
          SHIB: 'SHIBUSD', PEPE: 'PEPEUSD', NEAR: 'NEARUSD', ALGO: 'ALGOUSD',
          ICP: 'ICPUSD', FIL: 'FILUSD', SAND: 'SANDUSD', MANA: 'MANAUSD',
          APE: 'APEUSD', OP: 'OPUSD', ARB: 'ARBUSD', INJ: 'INJUSD',
          SUI: 'SUIUSD', TAO: 'TAOUSD', WIF: 'WIFUSD', FLOKI: 'FLOKIUSD',
          BONK: 'BONKUSD', BABY: 'BABYUSD',
        };
        
        const pairs = symbols.map(s => pairMap[s] || `${s}USD`).filter(Boolean);
        
        if (pairs.length) {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 5000);
          const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`, { signal: ctrl.signal });
          clearTimeout(to);
          
          if (resp.ok) {
            const data = await resp.json();
            const tickerResults = data?.result || {};
            
            // Build price map from ticker results
            const priceMap = {};
            for (const [tickerPair, tickerData] of Object.entries(tickerResults)) {
              const sym = extractBaseAsset(tickerPair);
              priceMap[sym] = parseFloat(tickerData.c?.[0]) || 0;
            }
            
            // Calculate unrealized PnL for each held asset
            for (const sym of symbols) {
              const currentPrice = priceMap[sym] || 0;
              // Balance keys are already normalized by krakenApi (SOL, BTC, XLM, etc.)
              const balance = parseFloat(balances[sym]) || 0;
              const position = positionMap[sym];
              
              if (position && balance > 0 && currentPrice > 0) {
                const currentValue = balance * currentPrice;
                const costBasis = position.avgPrice * balance;
                totalUnrealizedPnL += (currentValue - costBasis);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[getKrakenPnL] Price fetch failed (soft):', e.message);
      }
    }

    const totalPnL = totalRealizedPnL + totalUnrealizedPnL;

    console.log('[getKrakenPnL] ✅ Success:', {
      realized24h: realizedPnL24h.toFixed(2),
      realizedTotal: totalRealizedPnL.toFixed(2),
      unrealized: totalUnrealizedPnL.toFixed(2),
      total: totalPnL.toFixed(2),
      positions: Object.entries(positionMap).map(([s, d]) => `${s}: avg=$${d.avgPrice.toFixed(4)}, qty=${d.totalQuantity.toFixed(6)}`),
      duration: Date.now() - startTime
    });

    return Response.json({
      success: true,
      pnl_24h: realizedPnL24h,
      pnl_lifetime: totalPnL,
      realized_pnl: totalRealizedPnL,
      unrealized_pnl: totalUnrealizedPnL,
      positions: Object.entries(positionMap).map(([symbol, data]) => ({
        symbol,
        quantity: data.totalQuantity,
        avgPrice: data.avgPrice,
        realizedPnL: data.realizedPnL
      }))
    });

  } catch (error) {
    console.error('[getKrakenPnL] Error:', error.message);
    
    return Response.json({
      success: false,
      error: error.message,
      pnl_24h: 0,
      pnl_lifetime: 0,
      realized_pnl: 0,
      unrealized_pnl: 0
    }, { status: 200 });
  }
});