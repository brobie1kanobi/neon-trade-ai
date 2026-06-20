import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Sync Kraken Balance — Routes ALL Kraken calls through krakenApi
 * to respect the shared rate limiter. No direct Kraken API calls.
 */

function parseKrakenAsset(krakenCode) {
  const code = String(krakenCode || '').toUpperCase();
  const cleaned = code.replace(/\.\w+$/, '');
  const map = {
    'XXBT': 'BTC', 'XBT': 'BTC', 'XETH': 'ETH', 'ETH': 'ETH', 'ETH2': 'ETH',
    'XXRP': 'XRP', 'XRP': 'XRP', 'XXLM': 'XLM', 'XLM': 'XLM',
    'XLTC': 'LTC', 'LTC': 'LTC', 'XDG': 'DOGE', 'XXDG': 'DOGE', 'DOGE': 'DOGE',
    'SOL': 'SOL', 'ADA': 'ADA', 'DOT': 'DOT', 'LINK': 'LINK',
    'UNI': 'UNI', 'MATIC': 'MATIC', 'ATOM': 'ATOM', 'BCH': 'BCH',
    'AVAX': 'AVAX', 'BNB': 'BNB', 'TRX': 'TRX', 'USDT': 'USDT',
    'USDC': 'USDC', 'ZUSD': 'USD', 'USD': 'USD'
  };
  if (map[cleaned]) return map[cleaned];
  let symbol = cleaned;
  if (symbol.startsWith('Z')) symbol = symbol.substring(1);
  if (symbol.startsWith('X') && symbol.length > 3) symbol = symbol.substring(1);
  return map[symbol] || symbol;
}

function extractBaseAsset(pair) {
  const cleaned = String(pair || '')
    .toUpperCase()
    .replace(/\/USD$|ZUSD$|USD$|EUR$|GBP$/g, '');
  return parseKrakenAsset(cleaned);
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });

    console.log('[syncKrakenBalance] Starting for:', user.email);

    const hasBal = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
    if (!hasBal) {
      return Response.json({ error: 'Kraken not connected', connected: false, success: false }, { status: 200 });
    }

    // STEP 1: Fetch balance via krakenApi (rate-limited)
    let krakenHoldings = [];
    let usdBalance = 0;
    try {
      console.log('[syncKrakenBalance] Fetching balance via krakenApi...');
      const balanceRes = await base44.functions.invoke('krakenApi', { action: 'getExtendedBalance' });
      const balanceData = balanceRes?.data || balanceRes;

      if (!balanceData?.success) {
        throw new Error(balanceData?.error || 'Failed to fetch balance');
      }

      for (const [asset, info] of Object.entries(balanceData.balance || {})) {
        if (asset === 'USD') {
          usdBalance = info.balance || info.total || 0;
          continue;
        }
        const qty = info.balance || info.total || 0;
        if (qty <= 0.00001) continue;
        krakenHoldings.push({ symbol: asset, quantity: qty });
      }

      console.log('[syncKrakenBalance] Balance OK -', Date.now() - startTime, 'ms');
    } catch (balanceError) {
      console.error('[syncKrakenBalance] Balance failed:', balanceError.message);
      return Response.json({
        error: 'Failed to fetch balance: ' + balanceError.message,
        success: false, duration: Date.now() - startTime
      }, { status: 200 });
    }

    // STEP 2: Fetch trades via krakenApi (rate-limited) — with a small delay to avoid burst
    let costBasisMap = {};
    try {
      console.log('[syncKrakenBalance] Fetching trades via krakenApi...');
      // Small delay between consecutive Kraken API calls
      await new Promise(r => setTimeout(r, 1500));

      const tradesRes = await base44.functions.invoke('krakenApi', { action: 'getTradesHistory' });
      const tradesData = tradesRes?.data || tradesRes;

      if (tradesData?.success && Array.isArray(tradesData.trades)) {
        console.log('[syncKrakenBalance] Processing', tradesData.trades.length, 'trades');
        for (const trade of tradesData.trades) {
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
          if (data.totalQuantity > 0) data.avgPrice = data.totalCost / data.totalQuantity;
        }
        console.log('[syncKrakenBalance] Cost basis calculated');
      }
    } catch (tradesError) {
      console.warn('[syncKrakenBalance] Trades failed (continuing):', tradesError.message);
    }

    // STEP 3: Update Wallet
    console.log('[syncKrakenBalance] USD:', usdBalance);
    try {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ created_by: user.email });
      if (wallets.length === 0) {
        await base44.asServiceRole.entities.Wallet.create({
          cash_balance: 10000, total_deposits: 0, total_withdrawals: 0,
          real_cash_balance: usdBalance, real_total_deposits: 0, real_total_withdrawals: 0,
          created_by: user.email
        });
      } else {
        await base44.asServiceRole.entities.Wallet.update(wallets[0].id, { real_cash_balance: usdBalance });
      }
    } catch (walletError) {
      console.error('[syncKrakenBalance] Wallet update failed:', walletError);
      return Response.json({
        error: 'Wallet update failed: ' + walletError.message,
        success: false, duration: Date.now() - startTime
      }, { status: 200 });
    }

    // STEP 4: Update Holdings
    try {
      const existingHoldings = await base44.asServiceRole.entities.Holding.filter({
        created_by: user.email, is_simulation: false
      });
      await Promise.all(existingHoldings.map(h => base44.asServiceRole.entities.Holding.delete(h.id).catch(() => {})));
      console.log('[syncKrakenBalance] Deleted', existingHoldings.length, 'holdings');

      const holdings = [];
      const createPromises = [];
      for (const holding of krakenHoldings) {
        const qty = parseFloat(holding.quantity) || 0;
        if (qty <= 0.00001) continue;
        const symbol = parseKrakenAsset(holding.symbol);
        const costBasis = costBasisMap[symbol]?.avgPrice || 0;
        holdings.push({ symbol, balance: qty, avgCost: costBasis });
        createPromises.push(
          base44.asServiceRole.entities.Holding.create({
            symbol, asset_type: 'crypto', quantity: qty, average_cost_price: costBasis,
            is_simulation: false, created_by: user.email
          }).catch(e => console.error('[syncKrakenBalance] Create holding failed for', symbol, ':', e.message))
        );
      }
      await Promise.all(createPromises);
      console.log('[syncKrakenBalance] Created', holdings.length, 'holdings');

      await base44.asServiceRole.entities.KrakenLog.create({
        event_type: 'balance', status: 'success',
        message: `Synced ${holdings.length} holdings, $${usdBalance.toFixed(2)} USD`,
        details_json: JSON.stringify({ usdBalance, holdings, duration: Date.now() - startTime }),
        created_by: user.email
      }).catch(() => {});

      console.log('[syncKrakenBalance] ✅ Success in', Date.now() - startTime, 'ms');
      return Response.json({
        success: true, usdBalance, holdings,
        balance: { USD: usdBalance }, costBasis: costBasisMap,
        duration: Date.now() - startTime
      });
    } catch (holdingsError) {
      console.error('[syncKrakenBalance] Holdings update failed:', holdingsError);
      return Response.json({
        error: 'Holdings update failed: ' + holdingsError.message,
        success: false, duration: Date.now() - startTime
      }, { status: 200 });
    }
  } catch (error) {
    console.error('[syncKrakenBalance] ❌ Fatal:', error);
    if (error.message?.includes('Unauthorized') || error.message?.includes('Auth')) {
      return Response.json({ error: 'Unauthorized', success: false, duration: Date.now() - startTime }, { status: 401 });
    }
    return Response.json({ error: error.message || 'Internal error', success: false, duration: Date.now() - startTime }, { status: 200 });
  }
});