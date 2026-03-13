import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

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
    this.decayRate = 1.66;
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
  
  // Handle Kraken's X and Z prefixes
  // XXBT -> XBT -> BTC, XXLM -> XLM, XXRP -> XRP, etc.
  if (krakenCode.startsWith('XX')) {
    symbol = krakenCode.substring(1); // XXBT -> XBT, XXLM -> XLM
  } else if (krakenCode.startsWith('X') && krakenCode.length === 4 && krakenCode !== 'XETH') {
    symbol = krakenCode.substring(1); // XBT -> BT (but handle in symbolMap)
  }
  if (krakenCode.startsWith('Z')) symbol = krakenCode.substring(1);
  
  const symbolMap = {
    'XBT': 'BTC', 'XXBT': 'BTC', 'BT': 'BTC',
    'ETH': 'ETH', 'XETH': 'ETH',
    'SOL': 'SOL',
    'XRP': 'XRP', 'XXRP': 'XRP',
    'XLM': 'XLM', 'XXLM': 'XLM',  // Stellar - was showing as LM
    'ADA': 'ADA', 'DOT': 'DOT',
    'DOGE': 'DOGE', 'XDG': 'DOGE',  // Dogecoin
    'LINK': 'LINK', 'UNI': 'UNI',
    'MATIC': 'MATIC', 'ATOM': 'ATOM',
    'LTC': 'LTC', 'BCH': 'BCH',
    'AVAX': 'AVAX', 'BNB': 'BNB',
    'TRX': 'TRX',
    'USDT': 'USDT', 'USDC': 'USDC', 'USD': 'USD'
  };
  
  return symbolMap[symbol] || symbol;
}

function buildKrakenPair(symbol) {
  const pairMap = {
    'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'XRP': 'XXRPZUSD',
    'LTC': 'XLTCZUSD', 'SOL': 'SOLUSD', 'ADA': 'ADAUSD',
    'DOT': 'DOTUSD', 'DOGE': 'XDGUSD', 'LINK': 'LINKUSD',
    'UNI': 'UNIUSD', 'MATIC': 'MATICUSD', 'ATOM': 'ATOMUSD',
    'AVAX': 'AVAXUSD', 'BCH': 'BCHUSD', 'TRX': 'TRXUSD',
    'PEPE': 'PEPEUSD', 'LM': 'LMUSD', 'BABY': 'BABYUSD'
  };
  
  return pairMap[symbol] || `${symbol}USD`;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    const userKey = user.email;
    if (!rateLimiters.has(userKey)) {
      rateLimiters.set(userKey, new RateLimiter());
    }
    const limiter = rateLimiters.get(userKey);

    const hasBalanceSecrets = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
    if (!hasBalanceSecrets) {
      console.log('[getKrakenBalance] Missing Kraken balance secrets');
      return Response.json({
        error: 'Not connected',
        connected: false,
        success: false,
        usd_balance: 0,
        total_usd_balance: 0,
        available_usd_balance: 0,
        holdings: [],
        total_assets: 0,
        total_crypto_value_usd: 0,
        total_portfolio_value_usd: 0
      }, { status: 200 });
    }

    // Wait for rate limit capacity (but don't wait forever)
    await Promise.race([
      limiter.waitForCapacity(1),
      new Promise(resolve => setTimeout(resolve, 1000)) // Max 1s wait
    ]);
    limiter.recordCall(1);

    // CRITICAL: Fetch BOTH balance AND extended balance (includes locked amounts)
    // CRITICAL: Balance endpoints must use BALANCE key (separate from trade)
    const extendedBalanceResponse = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getExtendedBalance' }); // uses balance key internally

    let extendedData = extendedBalanceResponse?.data || extendedBalanceResponse;
    if (extendedData?.data) extendedData = extendedData.data;

    // Derive a simple balance map from extended data for downstream logic
    let balanceData = { success: true, balance: {} };
    if (extendedData?.success && extendedData?.balance) {
      for (const [asset, info] of Object.entries(extendedData.balance)) {
        const num = typeof info === 'object' && info !== null ? parseFloat(info.balance ?? info.total ?? 0) : parseFloat(info || 0);
        balanceData.balance[asset] = isNaN(num) ? 0 : num;
      }
    }
    
    // CRITICAL: If not connected, return early with success=false
    if (extendedData?.success === false || extendedData?.connected === false) {
      return Response.json({
        success: false,
        connected: false,
        error: balanceData?.error || 'Kraken not connected',
        usd_balance: 0,
        total_usd_balance: 0,
        available_usd_balance: 0,
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
    
    // Use extended balance if available - it has more detailed breakdown
    let extendedBalance = null;
    if (extendedData?.success && extendedData?.balance) {
      extendedBalance = extendedData.balance;
      console.log('[getKrakenBalance] Using extended balance');
    }
    
    if (!krakenBalance) throw new Error('Invalid balance response');

    // USD balances
    // Available = 'balance' (excludes hold_trade), Total = 'total' (includes held)
    const availableUsdBalance = parseFloat(
      (extendedBalance?.USD?.balance ?? extendedBalance?.ZUSD?.balance ?? krakenBalance.USD ?? krakenBalance.ZUSD ?? 0)
    );

    const totalUsdBalance = parseFloat(
      (extendedBalance?.USD?.total ?? extendedBalance?.ZUSD?.total ?? (
        (extendedBalance?.USD?.balance ?? extendedBalance?.ZUSD?.balance ?? 0) + (extendedBalance?.USD?.hold_trade ?? extendedBalance?.ZUSD?.hold_trade ?? 0)
      ) ?? krakenBalance.USD ?? krakenBalance.ZUSD ?? 0)
    );
    
    const cryptoHoldings = [];
    const symbols = [];
    
    // CRITICAL: Use extended balance where available. Use the BALANCE field for quantity
    // to avoid double-counting amounts reserved in open orders (hold_trade).
    const balanceSource = extendedBalance || krakenBalance;
    
    for (const [asset, balanceInfo] of Object.entries(balanceSource)) {
      // Handle both simple balance (number/string) and extended balance (object with total/balance/hold_trade)
      let qty;
      if (typeof balanceInfo === 'object' && balanceInfo !== null) {
        // Use BALANCE primarily; total can double-count if entire amount is on hold
        qty = parseFloat((balanceInfo.balance ?? balanceInfo.total ?? 0));
      } else {
        // Simple balance format
        qty = parseFloat(balanceInfo);
      }
      
      if (asset === 'ZUSD' || asset === 'USD' || qty <= 0.00001) continue;
      
      const symbol = parseKrakenAsset(asset);
      cryptoHoldings.push({ symbol, quantity: qty });
      symbols.push(symbol);
    }

    // CRITICAL: Fetch prices - fetch individually for known pairs, skip unknown
    let prices = {};
    if (symbols.length > 0) {
      try {
        // Only fetch prices for known pairs (some tokens like BABY may not have public tickers)
        const knownPairs = {
          'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'XRP': 'XXRPZUSD',
          'LTC': 'XLTCZUSD', 'SOL': 'SOLUSD', 'ADA': 'ADAUSD',
          'DOT': 'DOTUSD', 'DOGE': 'XDGUSD', 'LINK': 'LINKUSD',
          'UNI': 'UNIUSD', 'MATIC': 'MATICUSD', 'ATOM': 'ATOMUSD',
          'AVAX': 'AVAXUSD', 'BCH': 'BCHUSD', 'TRX': 'TRXUSD',
          'PEPE': 'PEPEUSD', 'XLM': 'XXLMZUSD'  // Stellar
        };
        
        const validPairs = symbols
          .filter(sym => knownPairs[sym])
          .map(sym => knownPairs[sym]);
        
        if (validPairs.length === 0) {
          console.log('[getKrakenBalance] No known pairs to fetch prices for');
        } else {
          const pairString = validPairs.join(',');
          console.log('[getKrakenBalance] Fetching prices for pairs:', pairString);
          
          const priceResponse = await Promise.race([
            fetch(`${KRAKEN_PUBLIC_API}?pair=${pairString}`, {
              method: 'GET',
              headers: { 'User-Agent': 'NeonTrade-AI/1.0' }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
          ]);

          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            console.log('[getKrakenBalance] Price response keys:', Object.keys(priceData?.result || {}));
            
            if (priceData?.result) {
              for (const [pair, ticker] of Object.entries(priceData.result)) {
                // Parse symbol from pair - handle various formats like XXBTZUSD, SOLUSD, PEPEUSD
                let symbol = pair;
                // Remove USD suffix variations
                symbol = symbol.replace(/ZUSD$/, '').replace(/USD$/, '');
                // Handle Kraken's X prefix for some assets
                if (symbol.startsWith('X') && symbol.length === 4) {
                  symbol = symbol.substring(1);
                }
                // Convert XBT to BTC
                if (symbol === 'XBT') symbol = 'BTC';
                // Handle XDG -> DOGE
                if (symbol === 'XDG') symbol = 'DOGE';
                
                const price = parseFloat(ticker.c?.[0]) || 0;
                if (price > 0) {
                  prices[symbol] = price;
                  console.log('[getKrakenBalance] Price found:', symbol, '=', price);
                }
              }
            }
          } else {
            console.warn('[getKrakenBalance] Price fetch failed:', priceResponse.status);
          }
        }
      } catch (e) {
        console.warn('[getKrakenBalance] Prices failed (non-critical):', e.message);
        // Continue without prices - we'll return holdings anyway
      }
    }

    // Build holdings with prices (dedup by symbol to avoid double-counting)
    const holdingsWithValues = [];
    let totalCryptoValue = 0;

    const qtyBySymbol = cryptoHoldings.reduce((acc, h) => {
      const sym = String(h.symbol || '').toUpperCase();
      acc[sym] = (acc[sym] || 0) + (Number(h.quantity) || 0);
      return acc;
    }, {});

    for (const [sym, qty] of Object.entries(qtyBySymbol)) {
      const currentPrice = prices[sym] || 0;
      const usdValue = qty * currentPrice;
      totalCryptoValue += usdValue;

      holdingsWithValues.push({
        symbol: sym,
        quantity: qty,
        current_price: currentPrice,
        current_price_usd: currentPrice,
        total_value_usd: usdValue,
        price_available: currentPrice > 0,
        asset_type: 'crypto',
        is_simulation: false
      });
    }

    let costBasisAvailable = false;

    // CRITICAL: Only try cost basis if rate limit allows
    if (limiter.canMakeCall(2)) {
      try {
        console.log('[getKrakenBalance] Attempting cost basis fetch');
        
        await limiter.waitForCapacity(2);
        limiter.recordCall(2);
        
        const tradesResponse = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getTradesHistory' });

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
              holding.average_cost_price = avgCost;
              holding.cost_basis_per_unit = avgCost;
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
      console.warn('[getKrakenBalance] Skipping cost basis (rate limited)');
    }

    const totalValue = totalUsdBalance + totalCryptoValue;
    const totalCostBasis = holdingsWithValues.reduce((sum, h) => sum + (h.total_cost_basis || 0), 0);
    const totalUnrealizedPnL = totalCostBasis > 0 ? totalCryptoValue - totalCostBasis : 0;

    console.log('[getKrakenBalance] ✅ Success:', {
      duration_ms: Date.now() - startTime,
      usd: totalUsdBalance.toFixed(2),
      crypto: totalCryptoValue.toFixed(2),
      total: totalValue.toFixed(2),
      assets: holdingsWithValues.length,
      prices_available: Object.keys(prices).length > 0
    });

    return Response.json({
      success: true,
      connected: true,
      usd_balance: totalUsdBalance,
      total_usd_balance: totalUsdBalance,
      available_usd_balance: availableUsdBalance,
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
    console.error('[getKrakenBalance] Error:', error.message);
    
    // CRITICAL: Always return graceful error response with empty data
    return Response.json({
      success: false,
      error: error.message,
      connected: false,
      usd_balance: 0,
      total_usd_balance: 0,
      available_usd_balance: 0,
      holdings: [],
      total_assets: 0,
      total_crypto_value_usd: 0,
      total_portfolio_value_usd: 0,
      duration_ms: Date.now() - startTime
    }, { status: 200 });
  }
});