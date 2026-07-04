import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Get Kraken Balance — Routes through krakenApi to respect rate limits.
 * No direct Kraken calls — everything goes via krakenApi proxy.
 */

const KRAKEN_PUBLIC_API = 'https://api.kraken.com/0/public/Ticker';

function parseKrakenAsset(krakenCode) {
  const code = String(krakenCode || '').toUpperCase();
  const cleaned = code.replace(/\.\w+$/, '');
  const map = {
    'XXBT': 'BTC', 'XBT': 'BTC',
    'XETH': 'ETH', 'ETH': 'ETH', 'ETH2': 'ETH',
    'XXRP': 'XRP', 'XRP': 'XRP',
    'XXLM': 'XLM', 'XLM': 'XLM',
    'XLTC': 'LTC', 'LTC': 'LTC',
    'XDG': 'DOGE', 'XXDG': 'DOGE', 'DOGE': 'DOGE',
    'ZUSD': 'USD', 'USD': 'USD',
    'SOL': 'SOL', 'ADA': 'ADA', 'DOT': 'DOT',
    'LINK': 'LINK', 'AVAX': 'AVAX', 'ATOM': 'ATOM',
    'UNI': 'UNI', 'MATIC': 'MATIC', 'BCH': 'BCH',
    'TRX': 'TRX', 'PEPE': 'PEPE', 'SHIB': 'SHIB',
    'NEAR': 'NEAR', 'ALGO': 'ALGO', 'ICP': 'ICP',
    'SUI': 'SUI', 'HBAR': 'HBAR', 'TRUMP': 'TRUMP',
    'BONK': 'BONK', 'FLOKI': 'FLOKI', 'BABY': 'BABY',
  };
  if (map[cleaned]) return map[cleaned];
  let symbol = cleaned;
  if (symbol.startsWith('Z') && symbol.length >= 4) symbol = symbol.substring(1);
  if (symbol.startsWith('X') && symbol.length >= 4) symbol = symbol.substring(1);
  if (map[symbol]) return map[symbol];
  return symbol;
}

function knownPair(symbol) {
  const map = {
    BTC: 'XXBTZUSD', ETH: 'XETHZUSD', XRP: 'XXRPZUSD', LTC: 'XLTCZUSD', SOL: 'SOLUSD', ADA: 'ADAUSD',
    DOT: 'DOTUSD', DOGE: 'XDGUSD', LINK: 'LINKUSD', UNI: 'UNIUSD', MATIC: 'MATICUSD', ATOM: 'ATOMUSD',
    AVAX: 'AVAXUSD', BCH: 'BCHUSD', TRX: 'TRXUSD', PEPE: 'PEPEUSD', XLM: 'XXLMZUSD',
    SHIB: 'SHIBUSD', NEAR: 'NEARUSD', ALGO: 'ALGOUSD', ICP: 'ICPUSD', FIL: 'FILUSD',
    SAND: 'SANDUSD', MANA: 'MANAUSD', APE: 'APEUSD', OP: 'OPUSD', ARB: 'ARBUSD',
    INJ: 'INJUSD', SUI: 'SUIUSD', TAO: 'TAOUSD', WIF: 'WIFUSD', FLOKI: 'FLOKIUSD',
    BONK: 'BONKUSD', BABY: 'BABYUSD', HBAR: 'HBARUSD', TRUMP: 'TRUMPUSD',
  };
  return map[symbol] || `${symbol}USD`;
}

Deno.serve(async (req) => {
  const start = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });

    const hasBal = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
    if (!hasBal) {
      return Response.json({
        success: false, connected: false, error: 'Not connected',
        usd_balance: 0, total_usd_balance: 0, available_usd_balance: 0,
        holdings: [], total_assets: 0, total_crypto_value_usd: 0, total_portfolio_value_usd: 0
      }, { status: 200 });
    }

    // Route through krakenApi to respect the shared rate limiter
    const balanceRes = await base44.functions.invoke('krakenApi', { action: 'getExtendedBalance' });
    const balanceData = balanceRes?.data || balanceRes;
    
    if (!balanceData?.success) {
      return Response.json({
        success: false, connected: false,
        error: balanceData?.error || 'Kraken BalanceEx failed',
        usd_balance: 0, total_usd_balance: 0, available_usd_balance: 0,
        holdings: [], total_assets: 0, total_crypto_value_usd: 0, total_portfolio_value_usd: 0
      }, { status: 200 });
    }

    const ext = balanceData.balance || {};

    // USD balances
    const usdInfo = ext['USD'] || {};
    const availableUsd = usdInfo.balance || 0;
    const totalUsd = usdInfo.total || usdInfo.balance || 0;

    // Build holdings and fetch prices
    // CRITICAL: Normalize Kraken's internal symbols (XDG, XXBT, XETH, etc.) to
    // standard symbols (DOGE, BTC, ETH) using parseKrakenAsset. This prevents
    // flickering caused by symbol mismatches between REST and WS data sources.
    const rawHoldings = [];
    const symbols = [];
    for (const [asset, info] of Object.entries(ext)) {
      const normalizedAsset = parseKrakenAsset(asset);
      if (normalizedAsset === 'USD') continue;
      const qty = info.balance || info.total || 0;
      if (qty <= 0.00001) continue;
      rawHoldings.push({ symbol: normalizedAsset, quantity: qty });
      symbols.push(normalizedAsset);
    }

    let prices = {};
    const pairs = symbols.map(s => knownPair(s)).filter(Boolean);
    if (pairs.length > 0) {
      try {
        const resp = await Promise.race([
          fetch(`${KRAKEN_PUBLIC_API}?pair=${pairs.join(',')}`, { headers: { 'User-Agent': 'NeonTrade-AI/1.0' } }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
        ]);
        if (resp.ok) {
          const data = await resp.json();
          for (const [pair, ticker] of Object.entries(data?.result || {})) {
            let sym = pair.replace(/ZUSD$|USD$/g, '');
            if (sym.startsWith('X') && sym.length === 4) sym = sym.substring(1);
            if (sym === 'XBT') sym = 'BTC';
            if (sym === 'XDG') sym = 'DOGE';
            const price = parseFloat(ticker.c?.[0]) || 0;
            if (price > 0) prices[sym] = price;
          }
        }
      } catch (_e) { /* Non-critical */ }
    }

    // Fetch cost basis from DB holdings
    let costBasisMap = {};
    try {
      const dbHoldings = await base44.entities.Holding.filter({ is_simulation: false });
      for (const h of (dbHoldings || [])) {
        if (h.symbol && h.average_cost_price > 0) {
          costBasisMap[h.symbol] = h.average_cost_price;
        }
      }
    } catch (_e) { }

    const holdings = [];
    let totalCryptoValue = 0;
    const qtyBySymbol = rawHoldings.reduce((acc, h) => { acc[h.symbol] = (acc[h.symbol] || 0) + h.quantity; return acc; }, {});
    for (const [sym, qty] of Object.entries(qtyBySymbol)) {
      const p = prices[sym] || 0;
      const val = qty * p;
      const avgCost = costBasisMap[sym] || 0;
      totalCryptoValue += val;
      holdings.push({
        symbol: sym, quantity: qty, current_price: p, current_price_usd: p,
        total_value_usd: val, avg_cost: avgCost, cost_basis_total: avgCost > 0 ? avgCost * qty : 0,
        asset_type: 'crypto', is_simulation: false, price_available: p > 0
      });
    }

    const total = totalUsd + totalCryptoValue;

    return Response.json({
      success: true, connected: true,
      usd_balance: totalUsd, total_usd_balance: totalUsd, available_usd_balance: availableUsd,
      holdings, total_assets: holdings.length,
      total_crypto_value_usd: totalCryptoValue, total_portfolio_value_usd: total,
      prices_available: Object.keys(prices).length > 0,
      duration_ms: Date.now() - start
    }, { status: 200 });
  } catch (error) {
    return Response.json({
      success: false, error: error.message, connected: false,
      usd_balance: 0, total_usd_balance: 0, available_usd_balance: 0,
      holdings: [], total_assets: 0, total_crypto_value_usd: 0, total_portfolio_value_usd: 0,
      duration_ms: Date.now() - start
    }, { status: 200 });
  }
});