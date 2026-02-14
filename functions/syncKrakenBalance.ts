import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Sync Kraken Balance - WITH AGGRESSIVE TIMEOUT
 * SECURITY FIX: Returns 401 for unauthorized users
 */

const BALANCE_TIMEOUT_MS = 12000; // 12 seconds max (Kraken can be slow)
const TRADES_TIMEOUT_MS = 12000; // 12 seconds max

function parseKrakenAsset(krakenCode) {
  let symbol = krakenCode;
  if (krakenCode.startsWith('X') && krakenCode !== 'XRP') {
    symbol = krakenCode.substring(1);
  }
  if (krakenCode.startsWith('Z')) {
    symbol = krakenCode.substring(1);
  }
  
  const symbolMap = {
    'XBT': 'BTC', 'ETH': 'ETH', 'SOL': 'SOL', 'XRP': 'XRP',
    'ADA': 'ADA', 'DOT': 'DOT', 'DOGE': 'DOGE', 'LINK': 'LINK',
    'UNI': 'UNI', 'MATIC': 'MATIC', 'ATOM': 'ATOM', 'LTC': 'LTC',
    'BCH': 'BCH', 'AVAX': 'AVAX', 'BNB': 'BNB', 'TRX': 'TRX',
    'USDT': 'USDT', 'USDC': 'USDC', 'USD': 'USD'
  };
  
  return symbolMap[symbol] || symbol;
}

function extractBaseAsset(pair) {
  let cleaned = pair.replace(/^X+|^Z+/g, '');
  cleaned = cleaned.replace(/ZUSD$|USD$|EUR$|GBP$/g, '');
  return parseKrakenAsset(cleaned);
}

async function fetchWithTimeout(promise, timeoutMs, errorMessage) {
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  );
  return Promise.race([promise, timeoutPromise]);
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  // CRITICAL: 25-second HARD timeout for entire function (Kraken API can be slow)
  const globalTimeout = setTimeout(() => {
    console.error('[syncKrakenBalance] ⏰ GLOBAL TIMEOUT (25s)');
  }, 25000);
  
  try {
    const result = await Promise.race([
      handleSync(req, startTime),
      new Promise((resolve) => setTimeout(() => {
        console.warn('[syncKrakenBalance] ⏰ Function timeout');
        resolve(Response.json({ 
          error: 'Sync timeout - please try again',
          success: false,
          duration: Date.now() - startTime
        }, { status: 408 }));
      }, 25000))
    ]);
    
    clearTimeout(globalTimeout);
    return result;
    
  } catch (error) {
    clearTimeout(globalTimeout);
    console.error('[syncKrakenBalance] Fatal error:', error);
    return Response.json({ 
      error: error.message || 'Internal error',
      success: false,
      duration: Date.now() - startTime
    }, { status: 500 });
  }
});

async function handleSync(req, startTime) {
  try {
    const base44 = createClientFromRequest(req);
    
    // SECURITY FIX: 2-second timeout for auth - RETURN 401 IF UNAUTHORIZED
    const userPromise = base44.auth.me();
    const user = await Promise.race([
      userPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 2000))
    ]);
    
    if (!user) {
      return Response.json({ 
        error: 'Unauthorized',
        success: false 
      }, { status: 401 }); // SECURITY FIX: Changed from 200 to 401
    }

    console.log('[syncKrakenBalance] Starting for:', user.email);

    // CRITICAL: 2-second timeout for connection check
    const connectionsPromise = base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }, '-updated_date', 1);
    
    const connections = await Promise.race([
      connectionsPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection query timeout')), 2000))
    ]);

    if (!connections || connections.length === 0) {
      console.log('[syncKrakenBalance] No connection');
      return Response.json({ 
        error: 'Kraken not connected',
        connected: false,
        success: false
      }, { status: 200 });
    }

    // FETCH BALANCE
    let krakenBalance = null;
    try {
      console.log('[syncKrakenBalance] Fetching balance...');
      const balanceResponse = await fetchWithTimeout(
        base44.asServiceRole.functions.invoke('krakenApi', { action: 'getBalance' }),
        BALANCE_TIMEOUT_MS,
        'Balance fetch timeout'
      );

      let balanceData = balanceResponse?.data || balanceResponse;
      if (balanceData?.data) {
        balanceData = balanceData.data;
      }
      
      if (balanceData?.success === false) {
        throw new Error(balanceData.error || 'Balance fetch failed');
      }
      
      if (balanceData?.balance) {
        krakenBalance = balanceData.balance;
      } else if (typeof balanceData === 'object' && !balanceData.error) {
        const { success, ...possibleBalance } = balanceData;
        if (Object.keys(possibleBalance).length > 0) {
          krakenBalance = possibleBalance;
        }
      }
      
      if (!krakenBalance || typeof krakenBalance !== 'object') {
        throw new Error('Invalid balance response');
      }

      console.log('[syncKrakenBalance] Balance OK -', Date.now() - startTime, 'ms');
    } catch (balanceError) {
      console.error('[syncKrakenBalance] Balance failed:', balanceError.message);
      return Response.json({ 
        error: 'Failed to fetch balance: ' + balanceError.message,
        success: false,
        duration: Date.now() - startTime
      }, { status: 200 });
    }

    // FETCH TRADES
    let costBasisMap = {};
    try {
      console.log('[syncKrakenBalance] Fetching trades...');
      const tradesResponse = await fetchWithTimeout(
        base44.asServiceRole.functions.invoke('krakenApi', { action: 'getTradesHistory' }),
        TRADES_TIMEOUT_MS,
        'Trades fetch timeout'
      );

      let tradesData = tradesResponse?.data || tradesResponse;
      if (tradesData?.data) {
        tradesData = tradesData.data;
      }
      
      let tradesObject = {};
      
      if (tradesData?.success && tradesData?.trades) {
        tradesObject = tradesData.trades.trades || tradesData.trades || {};
      } else if (tradesData?.trades) {
        tradesObject = tradesData.trades;
      } else if (typeof tradesData === 'object' && !tradesData.success && !tradesData.error) {
        tradesObject = tradesData;
      }
      
      const tradesCount = Object.keys(tradesObject).length;
      console.log('[syncKrakenBalance] Processing', tradesCount, 'trades');

      for (const [txid, trade] of Object.entries(tradesObject)) {
        const pair = trade.pair || '';
        const type = trade.type || '';
        const vol = parseFloat(trade.vol) || 0;
        const cost = parseFloat(trade.cost) || 0;
        
        if (!pair || vol === 0) continue;
        
        const symbol = extractBaseAsset(pair);
        
        if (!costBasisMap[symbol]) {
          costBasisMap[symbol] = { totalCost: 0, totalQuantity: 0, avgPrice: 0 };
        }
        
        if (type === 'buy') {
          costBasisMap[symbol].totalCost += cost;
          costBasisMap[symbol].totalQuantity += vol;
        } else if (type === 'sell') {
          if (costBasisMap[symbol].totalQuantity > 0) {
            const sellRatio = vol / costBasisMap[symbol].totalQuantity;
            costBasisMap[symbol].totalCost -= costBasisMap[symbol].totalCost * sellRatio;
            costBasisMap[symbol].totalQuantity -= vol;
          }
        }
      }
      
      for (const symbol in costBasisMap) {
        const data = costBasisMap[symbol];
        if (data.totalQuantity > 0) {
          data.avgPrice = data.totalCost / data.totalQuantity;
        }
      }

      console.log('[syncKrakenBalance] Cost basis calculated');
    } catch (tradesError) {
      console.warn('[syncKrakenBalance] Trades failed (continuing):', tradesError.message);
    }

    // UPDATE WALLET
    const usdBalance = parseFloat(krakenBalance.ZUSD || krakenBalance.USD || 0);
    console.log('[syncKrakenBalance] USD:', usdBalance);

    try {
      // CRITICAL: 2-second timeout for wallet query
      const walletsPromise = base44.asServiceRole.entities.Wallet.filter({
        created_by: user.email
      });
      
      const wallets = await Promise.race([
        walletsPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Wallet query timeout')), 2000))
      ]);

      if (wallets.length === 0) {
        await base44.asServiceRole.entities.Wallet.create({
          cash_balance: 10000,
          total_deposits: 0,
          total_withdrawals: 0,
          real_cash_balance: usdBalance,
          real_total_deposits: 0,
          real_total_withdrawals: 0,
          created_by: user.email
        });
      } else {
        await base44.asServiceRole.entities.Wallet.update(wallets[0].id, {
          real_cash_balance: usdBalance
        });
      }
    } catch (walletError) {
      console.error('[syncKrakenBalance] Wallet update failed:', walletError);
      return Response.json({ 
        error: 'Wallet update failed: ' + walletError.message,
        success: false,
        duration: Date.now() - startTime
      }, { status: 200 });
    }

    // UPDATE HOLDINGS
    try {
      // CRITICAL: 2-second timeout for holdings query
      const existingPromise = base44.asServiceRole.entities.Holding.filter({
        created_by: user.email,
        is_simulation: false
      });
      
      const existingHoldings = await Promise.race([
        existingPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Holdings query timeout')), 2000))
      ]);
      
      const deletePromises = existingHoldings.map(h => 
        base44.asServiceRole.entities.Holding.delete(h.id).catch(() => {})
      );
      await Promise.all(deletePromises);
      
      console.log('[syncKrakenBalance] Deleted', existingHoldings.length, 'holdings');
      
      const holdings = [];
      const createPromises = [];
      
      for (const [asset, balance] of Object.entries(krakenBalance)) {
        const qty = parseFloat(balance);
        if (asset === 'ZUSD' || asset === 'USD' || qty <= 0.00001) continue;
        
        const symbol = parseKrakenAsset(asset);
        const costBasis = costBasisMap[symbol]?.avgPrice || 0;
        
        holdings.push({ symbol, balance: qty, avgCost: costBasis });
        
        createPromises.push(
          base44.asServiceRole.entities.Holding.create({
            symbol,
            asset_type: 'crypto',
            quantity: qty,
            average_cost_price: costBasis,
            is_simulation: false,
            created_by: user.email
          }).catch(e => {
            console.error('[syncKrakenBalance] Create holding failed for', symbol, ':', e.message);
          })
        );
      }

      await Promise.all(createPromises);
      console.log('[syncKrakenBalance] Created', holdings.length, 'holdings');

      await base44.asServiceRole.entities.KrakenLog.create({
        event_type: 'balance',
        status: 'success',
        message: `Synced ${holdings.length} holdings, $${usdBalance.toFixed(2)} USD`,
        details_json: JSON.stringify({ 
          usdBalance, 
          holdings,
          costBasis: Object.entries(costBasisMap).map(([sym, data]) => ({
            symbol: sym,
            avgPrice: data.avgPrice
          })),
          duration: Date.now() - startTime
        }),
        created_by: user.email
      }).catch(() => {}); // Don't fail if logging fails

      console.log('[syncKrakenBalance] ✅ Success in', Date.now() - startTime, 'ms');

      return Response.json({
        success: true,
        usdBalance,
        holdings,
        balance: krakenBalance,
        costBasis: costBasisMap,
        duration: Date.now() - startTime
      });

    } catch (holdingsError) {
      console.error('[syncKrakenBalance] Holdings update failed:', holdingsError);
      return Response.json({ 
        error: 'Holdings update failed: ' + holdingsError.message,
        success: false,
        duration: Date.now() - startTime
      }, { status: 200 });
    }

  } catch (error) {
    console.error('[syncKrakenBalance] ❌ Fatal:', error);
    
    // SECURITY FIX: Return 401 for auth errors, 500 for others
    if (error.message?.includes('Unauthorized') || error.message?.includes('Auth')) {
      return Response.json({ 
        error: 'Unauthorized',
        success: false,
        duration: Date.now() - startTime
      }, { status: 401 });
    }
    
    return Response.json({ 
      error: error.message || 'Internal error',
      success: false,
      duration: Date.now() - startTime
    }, { status: 500 });
  }
}