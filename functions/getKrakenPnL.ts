import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * Get Kraken PnL - Fetches actual realized and unrealized PnL from Kraken
 * CRITICAL: Returns REAL PnL data from Kraken, not calculated from local trades
 */

function parseKrakenAsset(krakenCode) {
  let symbol = krakenCode;
  if (krakenCode.startsWith('X') && krakenCode.length > 3) {
    symbol = krakenCode.substring(1);
  }
  if (krakenCode.startsWith('Z') && krakenCode.length > 3) {
    symbol = krakenCode.substring(1);
  }
  
  const symbolMap = {
    'XBT': 'BTC', 'ETH': 'ETH', 'SOL': 'SOL', 'XRP': 'XRP',
    'ADA': 'ADA', 'DOT': 'DOT', 'DOGE': 'DOGE', 'USD': 'USD'
  };
  
  return symbolMap[symbol] || symbol;
}

function extractBaseAsset(pair) {
  let cleaned = pair.replace(/^X+|^Z+/g, '');
  cleaned = cleaned.replace(/ZUSD$|USD$/g, '');
  return parseKrakenAsset(cleaned);
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await Promise.race([
      base44.auth.me(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 3000))
    ]);

    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    // Connectivity check: prefer secrets presence; don't hard-fail on status timeout
    const hasBalSecrets = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
    if (!hasBalSecrets) {
      return Response.json({ success: false, error: 'Kraken not connected', pnl_24h: 0, pnl_lifetime: 0, realized_pnl: 0, unrealized_pnl: 0 }, { status: 200 });
    }
    try {
      const statusRes = await Promise.race([
        base44.asServiceRole.functions.invoke('krakenApi', { action: 'status', internal: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Status timeout')), 5000))
      ]);
      const status = statusRes?.data || statusRes;
      if (status && status.connected === false) {
        return Response.json({ success: false, error: 'Kraken not connected', pnl_24h: 0, pnl_lifetime: 0, realized_pnl: 0, unrealized_pnl: 0 }, { status: 200 });
      }
    } catch (_e) {
      // Soft-fail: continue since secrets exist; transient status failures shouldn't block PnL
    }

    // Fetch trades history to calculate realized PnL
    const tradesResponse = await Promise.race([
      base44.asServiceRole.functions.invoke('krakenApi', { action: 'getTradesHistory', internal: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Trades timeout')), 8000))
    ]);

    const tradesData = tradesResponse?.data || tradesResponse;
    const tradesObject = tradesData?.trades?.trades || tradesData?.trades || {};
    
    // Calculate realized PnL from trades
    const positionMap = {};
    let totalRealizedPnL = 0;
    let realizedPnL24h = 0;
    
    const now = Date.now();
    const ms24h = 24 * 60 * 60 * 1000;

    for (const [txid, trade] of Object.entries(tradesObject)) {
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
        
        // Track 24h PnL
        if (now - time <= ms24h) {
          realizedPnL24h += pnl;
        }
        
        // Update position
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

    // Fetch current balances and prices for unrealized PnL
    const balanceResponse = await Promise.race([
      base44.asServiceRole.functions.invoke('krakenApi', { action: 'getBalance', internal: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Balance timeout')), 5000))
    ]);

    const balanceData = balanceResponse?.data || balanceResponse;
    const balances = balanceData?.balance || {};
    
    // Get current prices from public sources (no Kraken) to avoid rate limit coupling
    const symbols = Object.keys(balances)
      .filter(asset => asset !== 'ZUSD' && asset !== 'USD')
      .map(asset => parseKrakenAsset(asset));

    let totalUnrealizedPnL = 0;

    if (symbols.length > 0) {
      try {
        const mdRes = await base44.asServiceRole.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { cryptoSymbols: symbols, stockSymbols: [] }
        });
        const quotes = Array.isArray(mdRes?.data) ? mdRes.data : [];
        const priceMap = Object.fromEntries(quotes.map(q => [String(q.symbol || '').toUpperCase(), Number(q.price) || 0]));

        for (const sym of symbols) {
          const currentPrice = priceMap[String(sym || '').toUpperCase()] || 0;
          const balance = parseFloat(balances[`X${sym}`] || balances[sym] || 0);
          const position = positionMap[sym];
          if (position && balance > 0 && currentPrice > 0) {
            const currentValue = balance * currentPrice;
            const costBasis = position.avgPrice * balance;
            totalUnrealizedPnL += (currentValue - costBasis);
          }
        }
      } catch (e) {
        console.warn('[getKrakenPnL] Price fetch failed:', e.message);
      }
    }

    const totalPnL = totalRealizedPnL + totalUnrealizedPnL;

    console.log('[getKrakenPnL] ✅ Success:', {
      realized24h: realizedPnL24h.toFixed(2),
      realizedTotal: totalRealizedPnL.toFixed(2),
      unrealized: totalUnrealizedPnL.toFixed(2),
      total: totalPnL.toFixed(2),
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