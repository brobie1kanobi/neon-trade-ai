import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * CRITICAL: Auto-Trader - BUY and SELL with Live Kraken Holdings
 * - LIVE mode: Uses Kraken API for real trades with real money
 * - SIM mode: Uses database for simulated trades
 * - SELL: Monitors holdings for take-profit and stop-loss conditions
 */

function round2(n) {
  const x = Number(n || 0);
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function round6(n) {
  const x = Number(n || 0);
  return Math.round((x + Number.EPSILON) * 1000000) / 1000000;
}

async function getLatestWallet(base44, email) {
  const list = await base44.entities.Wallet.filter({ created_by: email }, "-updated_date");
  return list[0] || null;
}

async function getPrices(base44, cryptoSymbols, stockSymbols) {
  const payload = { cryptoSymbols, stockSymbols };
  const res = await base44.functions.invoke('getMarketData', { action: 'getWatchlistData', payload });
  const arr = Array.isArray(res?.data) ? res.data : [];
  const map = new Map();
  for (const p of arr) {
    const sym = (p.symbol || '').toUpperCase();
    const price = typeof p.price === 'number' ? p.price : (typeof p.current_price === 'number' ? p.current_price : null);
    if (sym && price != null) map.set(sym, price);
  }
  return map;
}

async function getKrakenHoldings(base44) {
  try {
    const res = await base44.functions.invoke('getKrakenBalance', {});
    const data = res?.data || res;
    if (data?.success && Array.isArray(data?.holdings)) {
      return data.holdings;
    }
    return [];
  } catch (e) {
    console.error('[runAutoTrader] Failed to get Kraken holdings:', e.message);
    return [];
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = settingsList[0] || {};
    
    if (!settings.auto_trading_enabled) {
      return Response.json({ success: true, message: 'Auto-trading disabled', trades_count: 0 });
    }

    const isSimMode = settings.sim_trading_mode !== false;

    // Load ALL preferences (for both buy and sell logic)
    const prefs = await base44.entities.AutoBuyPreference.filter({ 
      created_by: user.email, 
      enabled: true,
      is_simulation: isSimMode 
    }, "-updated_date");
    
    if (!Array.isArray(prefs) || prefs.length === 0) {
      return Response.json({ success: true, message: 'No preferences', trades_count: 0 });
    }

    // Create preference map for quick lookup
    const prefMap = new Map();
    for (const p of prefs) {
      prefMap.set((p.symbol || '').toUpperCase(), p);
    }

    let wallet = await getLatestWallet(base44, user.email);
    if (!wallet) {
      return Response.json({ success: true, message: 'No wallet for user', trades_count: 0 });
    }

    // === STEP 1: GET HOLDINGS (from Kraken for LIVE, from DB for SIM) ===
    let holdings = [];
    
    if (!isSimMode) {
      // LIVE MODE: Get holdings directly from Kraken
      holdings = await getKrakenHoldings(base44);
      console.log('[runAutoTrader] LIVE Kraken holdings:', holdings.length);
    } else {
      // SIM MODE: Get holdings from database
      const dbHoldings = await base44.entities.Holding.filter({
        created_by: user.email,
        is_simulation: true
      });
      holdings = (dbHoldings || []).map(h => ({
        symbol: (h.symbol || '').toUpperCase(),
        quantity: Number(h.quantity || 0),
        average_cost_price: Number(h.average_cost_price || 0),
        current_price_usd: 0, // Will be filled in
        total_value_usd: 0
      }));
    }

    // Get all symbols we need prices for
    const allSymbols = new Set([
      ...prefs.map(p => (p.symbol || '').toUpperCase()),
      ...holdings.map(h => (h.symbol || '').toUpperCase())
    ]);
    
    const cryptoSymbols = [...allSymbols].filter(s => {
      const pref = prefMap.get(s);
      return !pref || (pref.asset_type || '').toLowerCase() === 'crypto';
    });
    const stockSymbols = [...allSymbols].filter(s => {
      const pref = prefMap.get(s);
      return pref && (pref.asset_type || '').toLowerCase() === 'stock';
    });
    
    const priceMap = await getPrices(base44, cryptoSymbols, stockSymbols);

    const tradesPlaced = [];
    
    // === STEP 2: SELL LOGIC - Check holdings for take-profit/stop-loss ===
    for (const holding of holdings) {
      const sym = (holding.symbol || '').toUpperCase();
      if (!sym || sym === 'USD' || sym === 'ZUSD') continue;
      
      const qty = Number(holding.quantity || 0);
      if (qty <= 0.0000001) continue;
      
      const pref = prefMap.get(sym);
      if (!pref) continue; // No preference for this asset
      if (!pref.auto_sell_enabled && pref.auto_sell_enabled !== undefined) continue;
      
      const avgCost = Number(holding.average_cost_price || pref.purchase_price || 0);
      let currentPrice = priceMap.get(sym) || Number(holding.current_price_usd || 0);
      
      if (currentPrice <= 0) {
        console.log(`[runAutoTrader] No price for ${sym}, skipping sell check`);
        continue;
      }
      
      // Calculate P&L
      const gainPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      
      const gainMargin = Number(pref.gain_margin || 10);
      const lossMargin = Number(pref.loss_margin || 5);
      
      let shouldSell = false;
      let sellReason = '';
      
      // Check take-profit
      if (gainPercent >= gainMargin) {
        shouldSell = true;
        sellReason = `Take profit at +${gainPercent.toFixed(2)}% (target: +${gainMargin}%)`;
      }
      
      // Check stop-loss
      if (gainPercent <= -lossMargin) {
        shouldSell = true;
        sellReason = `Stop loss at ${gainPercent.toFixed(2)}% (limit: -${lossMargin}%)`;
      }
      
      // Trailing stop logic
      if (pref.trailing_stop_enabled && !shouldSell) {
        const trailingPct = Number(pref.trailing_stop_percent || 3);
        const highestPrice = Number(pref.highest_price || currentPrice);
        
        // Update highest price if current is higher
        if (currentPrice > highestPrice) {
          await base44.entities.AutoBuyPreference.update(pref.id, { highest_price: currentPrice });
        } else if (highestPrice > 0) {
          const dropFromHigh = ((highestPrice - currentPrice) / highestPrice) * 100;
          if (dropFromHigh >= trailingPct && gainPercent > 0) {
            shouldSell = true;
            sellReason = `Trailing stop: dropped ${dropFromHigh.toFixed(2)}% from high of $${highestPrice.toFixed(2)}`;
          }
        }
      }
      
      if (!shouldSell) continue;
      
      console.log(`[runAutoTrader] SELL SIGNAL: ${sym} - ${sellReason}`);
      
      const sellQty = qty;
      const total_value = round2(sellQty * currentPrice);
      
      // Execute sell
      if (!isSimMode) {
        // LIVE MODE: Use Kraken API
        try {
          const krakenResponse = await base44.functions.invoke('krakenTrade', {
            action: 'place_order',
            symbol: sym,
            side: 'sell',
            quantity: sellQty,
            orderType: 'market'
          });

          if (!krakenResponse?.data?.success) {
            throw new Error(krakenResponse?.data?.error || 'Kraken sell failed');
          }

          await base44.entities.Trade.create({
            symbol: sym,
            type: 'sell',
            asset_type: 'crypto',
            quantity: sellQty,
            price: currentPrice,
            total_value,
            status: 'executed',
            is_auto_trade: true,
            is_simulation: false,
            created_by: user.email
          });

          tradesPlaced.push({
            symbol: sym,
            type: 'sell',
            qty: sellQty,
            price: currentPrice,
            total_value,
            reason: sellReason
          });

        } catch (krakenError) {
          console.error(`[runAutoTrader] Kraken sell failed for ${sym}:`, krakenError.message);
          continue;
        }
      } else {
        // SIM MODE: Database only
        await base44.entities.Trade.create({
          symbol: sym,
          type: 'sell',
          asset_type: 'crypto',
          quantity: sellQty,
          price: currentPrice,
          total_value,
          status: 'executed',
          is_auto_trade: true,
          is_simulation: true,
          created_by: user.email
        });

        // Update SIM holdings
        const existing = await base44.entities.Holding.filter({
          created_by: user.email,
          symbol: sym,
          is_simulation: true
        });
        
        if (existing?.length > 0) {
          const h = existing[0];
          const newQty = round6(Number(h.quantity || 0) - sellQty);
          if (newQty <= 0.0000001) {
            await base44.entities.Holding.delete(h.id);
          } else {
            await base44.entities.Holding.update(h.id, { quantity: newQty });
          }
        }

        tradesPlaced.push({
          symbol: sym,
          type: 'sell',
          qty: sellQty,
          price: currentPrice,
          total_value,
          reason: sellReason
        });
      }
      
      // Reset highest price after sell
      if (pref.trailing_stop_enabled) {
        await base44.entities.AutoBuyPreference.update(pref.id, { highest_price: null });
      }
    }

    // === STEP 3: BUY LOGIC (existing) ===
    let availableCash = isSimMode ? (wallet.cash_balance || 0) : (wallet.real_cash_balance || 0);
    const cashBefore = availableCash;
    
    if (availableCash > 0.99) {
      for (const pref of prefs) {
        if (!pref?.enabled) continue;
        const sym = (pref.symbol || '').toUpperCase();
        const typ = (pref.asset_type || '').toLowerCase();
        if (!sym || !typ) continue;

        const price = priceMap.get(sym);
        if (price == null || price <= 0) continue;

        wallet = await getLatestWallet(base44, user.email);
        availableCash = isSimMode ? (wallet?.cash_balance || availableCash) : (wallet?.real_cash_balance || availableCash);

        const pct = Math.max(1, Number(pref.percentage || 0));
        const budget = round2((availableCash * pct) / 100);
        if (budget < 1) continue;

        const qty = price > 0 ? (budget / price) : 0;
        if (qty <= 0) continue;

        const total_value = round2(qty * price);
        if (total_value > availableCash) continue;

        if (!isSimMode) {
          try {
            const krakenResponse = await base44.functions.invoke('krakenTrade', {
              action: 'place_order',
              symbol: sym,
              side: 'buy',
              quantity: qty,
              orderType: 'market'
            });

            if (!krakenResponse?.data?.success) {
              throw new Error(krakenResponse?.data?.error || 'Kraken trade failed');
            }

            await base44.entities.Trade.create({
              symbol: sym,
              type: 'buy',
              asset_type: typ,
              quantity: qty,
              price: price,
              total_value,
              status: 'executed',
              is_auto_trade: true,
              is_simulation: false,
              created_by: user.email
            });

          } catch (krakenError) {
            console.error('[runAutoTrader] Kraken buy failed:', krakenError.message);
            continue;
          }
        } else {
          await base44.entities.Trade.create({
            symbol: sym,
            type: 'buy',
            asset_type: typ,
            quantity: qty,
            price: price,
            total_value,
            status: 'executed',
            is_auto_trade: true,
            is_simulation: true,
            created_by: user.email
          });
        }

        // Update holdings
        const existing = await base44.entities.Holding.filter({
          created_by: user.email,
          symbol: sym,
          asset_type: typ,
          is_simulation: isSimMode
        });
        
        if (existing?.length > 0) {
          const h = existing[0];
          const oldQty = Number(h.quantity || 0);
          const oldAvg = Number(h.average_cost_price || 0);
          const newQty = oldQty + qty;
          const newCost = oldQty * oldAvg + total_value;
          const newAvg = newQty > 0 ? (newCost / newQty) : 0;
          await base44.entities.Holding.update(h.id, { quantity: newQty, average_cost_price: newAvg });
        } else {
          await base44.entities.Holding.create({
            symbol: sym,
            asset_type: typ,
            quantity: qty,
            average_cost_price: price,
            is_simulation: isSimMode,
            created_by: user.email
          });
        }

        availableCash = round2(availableCash - total_value);

        tradesPlaced.push({
          symbol: sym,
          type: 'buy',
          asset_type: typ,
          qty,
          price,
          total_value
        });

        if (availableCash < 1) break;
      }
    }

    // Reconcile wallet
    try {
      await base44.functions.invoke('reconcileWallet', { mode: isSimMode ? 'sim' : 'real' });
    } catch (e) {
      console.error('[runAutoTrader] Reconcile error:', e.message);
    }

    const buys = tradesPlaced.filter(t => t.type === 'buy');
    const sells = tradesPlaced.filter(t => t.type === 'sell');

    return Response.json({
      success: true,
      mode: isSimMode ? 'sim' : 'live',
      trades_count: tradesPlaced.length,
      buys_count: buys.length,
      sells_count: sells.length,
      cash_before: cashBefore,
      cash_after_estimated: availableCash,
      trades: tradesPlaced
    });
  } catch (error) {
    console.error('[runAutoTrader] Error:', error);
    return Response.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
});