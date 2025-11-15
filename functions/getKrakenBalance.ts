import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Get Kraken Balance - FIXED asset normalization (XXRP → XRP)
 */

const KRAKEN_PUBLIC_API = 'https://api.kraken.com/0/public/Ticker';

// CRITICAL: Normalize all Kraken asset codes to standard symbols
function parseKrakenAsset(krakenCode) {
  // Remove leading X or Z (Kraken prefixes)
  let symbol = krakenCode;
  if (krakenCode.startsWith('X') && krakenCode.length > 3) {
    symbol = krakenCode.substring(1); // XXRP → XRP, XXBT → XBT
  }
  if (krakenCode.startsWith('Z') && krakenCode.length > 3) {
    symbol = krakenCode.substring(1); // ZUSD → USD
  }
  
  // Map known codes to standard symbols
  const symbolMap = {
    'XBT': 'BTC',
    'XDG': 'DOGE',
    'USD': 'USD',
    'ETH': 'ETH',
    'SOL': 'SOL',
    'XRP': 'XRP',
    'ADA': 'ADA',
    'DOT': 'DOT',
    'DOGE': 'DOGE',
    'LINK': 'LINK',
    'UNI': 'UNI',
    'MATIC': 'MATIC',
    'ATOM': 'ATOM',
    'LTC': 'LTC',
    'BCH': 'BCH',
    'AVAX': 'AVAX',
    'BNB': 'BNB',
    'TRX': 'TRX',
    'USDT': 'USDT',
    'USDC': 'USDC'
  };
  
  return symbolMap[symbol] || symbol;
}

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
    'TRX': 'TRXUSD'
  };
  
  return pairMap[symbol] || `${symbol}USD`;
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

    const balanceResponse = await Promise.race([
      base44.asServiceRole.functions.invoke('krakenApi', { action: 'getBalance' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Balance timeout')), 6000))
    ]);

    const balanceData = balanceResponse?.data || balanceResponse;

    if (!balanceData?.success) {
      throw new Error(balanceData?.error || 'Failed to get balance');
    }

    const balances = balanceData.balance || {};
    
    // Get USD balance
    const usdBalance = parseFloat(balances['ZUSD'] || balances['USD'] || 0);
    
    // Build holdings with normalized symbols
    const holdings = [];
    const symbols = [];
    
    for (const [asset, balance] of Object.entries(balances)) {
      if (asset === 'ZUSD' || asset === 'USD') continue;
      
      const amount = parseFloat(balance);
      if (amount > 0.0001) {
        const normalizedSymbol = parseKrakenAsset(asset);
        holdings.push({
          symbol: normalizedSymbol,
          quantity: amount,
          current_price_usd: 0,
          total_value_usd: 0
        });
        symbols.push(normalizedSymbol);
      }
    }

    // Get prices
    let totalCryptoValue = 0;
    if (symbols.length > 0) {
      try {
        const pairs = symbols.map(sym => buildKrakenPair(sym)).join(',');
        const priceResponse = await Promise.race([
          fetch(`${KRAKEN_PUBLIC_API}?pair=${pairs}`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);

        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          
          if (priceData?.result) {
            for (const [pair, ticker] of Object.entries(priceData.result)) {
              const symbol = parseKrakenAsset(pair.replace(/ZUSD$|USD$/g, ''));
              const price = parseFloat(ticker.c?.[0]) || 0;
              
              const holding = holdings.find(h => h.symbol === symbol);
              if (holding && price > 0) {
                holding.current_price_usd = price;
                holding.total_value_usd = holding.quantity * price;
                totalCryptoValue += holding.total_value_usd;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[getKrakenBalance] Prices failed:', e.message);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log('[getKrakenBalance] ✅ Success:', elapsed, 'ms');

    return Response.json({
      success: true,
      usd_balance: usdBalance,
      total_crypto_value_usd: totalCryptoValue,
      total_portfolio_value_usd: usdBalance + totalCryptoValue,
      holdings,
      asset_count: holdings.length
    }, { status: 200 });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[getKrakenBalance] Error after ${elapsed}ms:`, error.message);
    
    return Response.json({
      success: false,
      error: error.message,
      usd_balance: 0,
      total_crypto_value_usd: 0,
      total_portfolio_value_usd: 0,
      holdings: []
    }, { status: 200 });
  }
});