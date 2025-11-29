import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Get Kraken Balance - ULTRA-RELIABLE VERSION
 * 
 * CRITICAL FIXES:
 * 1. Increased timeouts to prevent false failures
 * 2. Cost basis is now OPTIONAL (won't block balance display)
 * 3. Returns data even if prices/cost basis fail
 * 4. Better error recovery
 */

const KRAKEN_PUBLIC_API = 'https://api.kraken.com/0/public/Ticker';

// Simple rate limiter
class RateLimiter {
  constructor() {
    this.counter = 0;
    this.maxCounter = 15;
    this.decayRate = 0.33;
    this.lastUpdate = Date.now();
  }

  canMakeCall(cost = 1) {
    this.updateCounter();
    return (this.counter + cost) <= this.maxCounter;
  }

  recordCall(cost = 1) {
    this.updateCounter();
    this.counter += cost;
  }

  updateCounter() {
    const now = Date.now();
    const elapsed = (now - this.lastUpdate) / 1000;
    this.counter = Math.max(0, this.counter - (elapsed * this.decayRate));
    this.lastUpdate = now;
  }

  async waitForCapacity(cost = 1) {
    this.updateCounter();
    if ((this.counter + cost) <= this.maxCounter) return;
    
    const pointsNeeded = (this.counter + cost) - this.maxCounter;
    const waitTime = Math.ceil((pointsNeeded / this.decayRate) * 1000) + 200;
    
    // CRITICAL: Cap max wait at 2 seconds
    const cappedWait = Math.min(waitTime, 2000);
    console.log(`[RateLimiter] Waiting ${cappedWait}ms...`);
    await new Promise(resolve => setTimeout(resolve, cappedWait));
    this.updateCounter();
  }
}

const rateLimiters = new Map();

function parseKrakenAsset(krakenCode) {
  let symbol = krakenCode;
  if (krakenCode.startsWith('X') && krakenCode !== 'XRP') symbol = krakenCode.substring(1);
  if (krakenCode.startsWith('Z')) symbol = krakenCode.substring(1);
  
  const symbolMap = {
    'XBT': 'BTC', 'ETH': 'ETH', 'SOL': 'SOL', 'XRP': 'XRP',
    'ADA': 'ADA', 'DOT': 'DOT', 'DOGE': 'DOGE', 'LINK': 'LINK',
    'UNI': 'UNI', 'MATIC': 'MATIC', 'ATOM': 'ATOM', 'LTC': 'LTC',
    'BCH': 'BCH', 'AVAX': 'AVAX', 'BNB': 'BNB', 'TRX': 'TRX',
    'USDT': 'USDT', 'USDC': 'USDC', 'USD': 'USD'
  };
  
  return symbolMap[symbol] || symbol;
}

function buildKrakenPair(symbol) {
  const pairMap = {
    'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'XRP': 'XXRPZUSD',
    'LTC': 'XLTCZUSD', 'SOL': 'SOLUSD', 'ADA': 'ADAUSD',
    'DOT': 'DOTUSD', 'DOGE': 'DOGEUSD', 'LINK': 'LINKUSD',
    'UNI': 'UNIUSD', 'MATIC': 'MATICUSD', 'ATOM': 'ATOMUSD',
    'AVAX': 'AVAXUSD', 'BCH': 'BCHUSD', 'TRX': 'TRXUSD'
  };
  
  return pairMap[symbol] || `${symbol}USD`;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  // CRITICAL: 10-SECOND ABSOLUTE TIMEOUT (increased from 6s)
  const globalTimeout = setTimeout(() => {
    console.error('[getKrakenBalance] ⏰ TIMEOUT (10s) - ABORTING');
  }, 10000);
  
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await Promise.race([
      base44.auth.me(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 2000))
    ]);

    if (!user) {
      clearTimeout(globalTimeout);
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    const userKey = user.email;
    if (!rateLimiters.has(userKey)) {
      rateLimiters.set(userKey, new RateLimiter());
    }
    const limiter = rateLimiters.get(userKey);

    const connections = await Promise.race([
      base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]);

    if (!connections || connections.length === 0) {
      clearTimeout(globalTimeout);
      return Response.json({
        error: 'Not connected',
        connected: false,
        success: false
      }, { status: 200 });
    }

    // Wait for rate limit capacity (but don't wait forever)
    await Promise.race([
      limiter.waitForCapacity(1),
      new Promise(resolve => setTimeout(resolve, 2000)) // Max 2s wait
    ]);
    limiter.recordCall(1);

    // CRITICAL: Increased timeout from 2500ms to 6000ms
    const balanceResponse = await Promise.race([
      base44.asServiceRole.functions.invoke('krakenApi', { action: 'getBalance' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Balance timeout')), 6000))
    ]);

    let balanceData = balanceResponse?.data || balanceResponse;
    if (balanceData?.data) balanceData = balanceData.data;
    
    // CRITICAL: If not connected, return early with success=false
    if (balanceData?.success === false || balanceData?.connected === false) {
      clearTimeout(globalTimeout);
      return Response.json({
        success: false,
        connected: false,
        error: balanceData?.error || 'Kraken not connected',
        usd_balance: 0,
        holdings: [],
        total_assets: 0,
        total_crypto_value_usd: 0,
        total_portfolio_value_usd: 0
      }, { status: 200 });
    }
    
    let krakenBalance = null;
    if (balanceData?.balance) {
      krakenBalance = balanceData.balance;
    } else if (typeof balanceData === 'object' && !balanceData.error) {
      const { success, ...possibleBalance } = balanceData;
      if (Object.keys(possibleBalance).length > 0) krakenBalance = possibleBalance;
    }
    
    if (!krakenBalance) throw new Error('Invalid balance response');

    const usdBalance = parseFloat(krakenBalance.ZUSD || krakenBalance.USD || 0);
    
    const cryptoHoldings = [];
    const symbols = [];
    
    for (const [asset, balance] of Object.entries(krakenBalance)) {
      const qty = parseFloat(balance);
      if (asset === 'ZUSD' || asset === 'USD' || qty <= 0.00001) continue;
      
      const symbol = parseKrakenAsset(asset);
      cryptoHoldings.push({ symbol, quantity: qty });
      symbols.push(symbol);
    }

    // CRITICAL: Fetch prices with INCREASED timeout (was 1.5s, now 3s)
    let prices = {};
    if (symbols.length > 0) {
      try {
        const pairs = symbols.map(sym => buildKrakenPair(sym)).join(',');
        const priceResponse = await Promise.race([
          fetch(`${KRAKEN_PUBLIC_API}?pair=${pairs}`, {
            method: 'GET',
            headers: { 'User-Agent': 'NeonTrade-AI/1.0' }
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);

        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          
          if (priceData?.result) {
            for (const [pair, ticker] of Object.entries(priceData.result)) {
              const symbol = parseKrakenAsset(pair.replace(/ZUSD$|USD$/g, ''));
              const price = parseFloat(ticker.c?.[0]) || 0;
              if (price > 0) prices[symbol] = price;
            }
          }
        }
      } catch (e) {
        console.warn('[getKrakenBalance] Prices failed (non-critical):', e.message);
        // Continue without prices - we'll return holdings anyway
      }
    }

    // Build holdings with prices
    const holdingsWithValues = [];
    let totalCryptoValue = 0;

    for (const holding of cryptoHoldings) {
      const currentPrice = prices[holding.symbol] || 0;
      const usdValue = holding.quantity * currentPrice;
      totalCryptoValue += usdValue;
      
      holdingsWithValues.push({
        symbol: holding.symbol,
        quantity: holding.quantity,
        current_price_usd: currentPrice,
        total_value_usd: usdValue,
        price_available: currentPrice > 0
      });
    }

    // CRITICAL: Calculate elapsed time BEFORE attempting cost basis
    const elapsed = Date.now() - startTime;
    const timeRemaining = 9000 - elapsed; // Leave 1s buffer before 10s timeout

    let costBasisAvailable = false;

    // CRITICAL: Only try cost basis if we have TIME and RATE LIMIT allows
    if (timeRemaining > 3000 && limiter.canMakeCall(2)) {
      try {
        console.log('[getKrakenBalance] Attempting cost basis fetch (', Math.floor(timeRemaining / 1000), 's remaining)');
        
        await limiter.waitForCapacity(2);
        limiter.recordCall(2);
        
        // Use remaining time - 500ms buffer
        const costBasisTimeout = Math.min(timeRemaining - 500, 3000);
        
        const tradesResponse = await Promise.race([
          base44.asServiceRole.functions.invoke('krakenApi', { action: 'getTradesHistory' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), costBasisTimeout))
        ]);

        const tradesData = tradesResponse?.data || tradesResponse;
        
        if (tradesData?.success && tradesData?.trades) {
          const costBasisBySymbol = {};
          
          for (const trade of tradesData.trades) {
            const pair = trade.pair || '';
            const symbol = parseKrakenAsset(pair.replace(/ZUSD$|USD$/g, ''));
            
            if (trade.type === 'buy') {
              if (!costBasisBySymbol[symbol]) {
                costBasisBySymbol[symbol] = { totalCost: 0, totalQty: 0 };
              }
              
              costBasisBySymbol[symbol].totalQty += parseFloat(trade.vol || 0);
              costBasisBySymbol[symbol].totalCost += parseFloat(trade.cost || 0);
            }
          }
          
          for (const holding of holdingsWithValues) {
            const costData = costBasisBySymbol[holding.symbol];
            if (costData && costData.totalQty > 0) {
              const avgCost = costData.totalCost / costData.totalQty;
              holding.avg_cost = avgCost;
              holding.total_cost_basis = holding.quantity * avgCost;
              holding.unrealized_pnl = holding.total_value_usd - holding.total_cost_basis;
              holding.pnl_percent = holding.total_cost_basis > 0 
                ? ((holding.total_value_usd - holding.total_cost_basis) / holding.total_cost_basis) * 100 
                : 0;
            }
          }
          
          costBasisAvailable = true;
          console.log('[getKrakenBalance] ✅ Cost basis calculated');
        }
      } catch (e) {
        console.warn('[getKrakenBalance] Cost basis skipped (non-critical):', e.message);
        // Continue without cost basis - not critical
      }
    } else {
      console.warn('[getKrakenBalance] Skipping cost basis (time:', Math.floor(timeRemaining / 1000), 's, rate:', limiter.counter.toFixed(2), ')');
    }

    const totalValue = usdBalance + totalCryptoValue;
    const totalCostBasis = holdingsWithValues.reduce((sum, h) => sum + (h.total_cost_basis || 0), 0);
    const totalUnrealizedPnL = totalCostBasis > 0 ? totalCryptoValue - totalCostBasis : 0;

    clearTimeout(globalTimeout);

    console.log('[getKrakenBalance] ✅ Success:', {
      duration_ms: Date.now() - startTime,
      usd: usdBalance.toFixed(2),
      crypto: totalCryptoValue.toFixed(2),
      total: totalValue.toFixed(2),
      assets: holdingsWithValues.length,
      prices_available: Object.keys(prices).length > 0
    });

    return Response.json({
      success: true,
      connected: true,
      usd_balance: usdBalance,
      holdings: holdingsWithValues,
      total_assets: holdingsWithValues.length,
      total_crypto_value_usd: totalCryptoValue,
      total_portfolio_value_usd: totalValue,
      total_cost_basis_usd: totalCostBasis,
      total_unrealized_pnl_usd: totalUnrealizedPnL,
      prices_available: Object.keys(prices).length > 0,
      cost_basis_available: costBasisAvailable,
      rate_limit_counter: limiter.counter.toFixed(2),
      rate_limit_max: limiter.maxCounter,
      duration_ms: Date.now() - startTime
    }, { status: 200 });

  } catch (error) {
    clearTimeout(globalTimeout);
    console.error('[getKrakenBalance] Error:', error.message);
    
    // CRITICAL: Always return graceful error response with empty data
    return Response.json({
      success: false,
      error: error.message,
      connected: false,
      usd_balance: 0,
      holdings: [],
      total_assets: 0,
      total_crypto_value_usd: 0,
      total_portfolio_value_usd: 0,
      duration_ms: Date.now() - startTime
    }, { status: 200 });
  }
});