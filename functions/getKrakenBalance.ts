import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Get Kraken Balance - FIXED with timeout and caching
 * Returns USD balance and total crypto value
 */

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

    // CRITICAL: Get Kraken connection with timeout
    const connections = await Promise.race([
      base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection fetch timeout')), 3000))
    ]);

    if (!connections || connections.length === 0) {
      return Response.json({
        success: false,
        error: 'Kraken not connected',
        usd_balance: 0,
        total_crypto_value: 0,
        total_portfolio_value: 0,
        holdings: []
      }, { status: 200 });
    }

    const connection = connections[0];

    // CRITICAL: Call krakenApi with SHORT timeout
    const balanceResponse = await Promise.race([
      base44.functions.invoke('krakenApi', { 
        action: 'getBalance'
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Kraken API timeout')), 5000))
    ]);

    const balanceData = balanceResponse?.data || balanceResponse;

    if (!balanceData?.success) {
      throw new Error(balanceData?.error || 'Failed to get balance');
    }

    const balances = balanceData.balance || {};
    
    // Get USD balance
    const usdBalance = parseFloat(balances['ZUSD'] || balances['USD'] || 0);
    
    // Calculate total crypto value (approximate - would need price data for exact)
    const holdings = [];
    let totalCryptoValue = 0;

    for (const [asset, balance] of Object.entries(balances)) {
      if (asset === 'ZUSD' || asset === 'USD') continue;
      
      const amount = parseFloat(balance);
      if (amount > 0.0001) {
        holdings.push({
          symbol: asset,
          quantity: amount,
          current_price_usd: 0, // Would need price data
          total_value_usd: 0
        });
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[getKrakenBalance] Completed in ${elapsed}ms`);

    return Response.json({
      success: true,
      usd_balance: usdBalance,
      total_crypto_value: totalCryptoValue,
      total_portfolio_value: usdBalance + totalCryptoValue,
      holdings,
      asset_count: holdings.length
    }, { status: 200 });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[getKrakenBalance] Error after ${elapsed}ms:`, error.message);
    
    // CRITICAL: Return success=false but don't throw
    return Response.json({
      success: false,
      error: error.message,
      usd_balance: 0,
      total_crypto_value: 0,
      total_portfolio_value: 0,
      holdings: []
    }, { status: 200 });
  }
});