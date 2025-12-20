import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * CRITICAL: Auto-Trader - RESPECTS MODE SETTING
 * - LIVE mode: Uses Kraken API for real trades with real money
 * - SIM mode: Uses database for simulated trades
 * 
 * LEGAL COMPLIANCE: Never mixes real and fake money
 */

function round2(n) {
  const x = Number(n || 0);
  return Math.round((x + Number.EPSILON) * 100) / 100;
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // CRITICAL: Load user settings to determine mode
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = settingsList[0] || {};
    
    if (!settings.auto_trading_enabled) {
      return Response.json({ success: true, message: 'Auto-trading disabled', trades_count: 0 });
    }

    // CRITICAL: Respect user's mode setting - NEVER force sim mode
    const isSimMode = settings.sim_trading_mode !== false;

    // Load preferences
    const prefs = await base44.entities.AutoBuyPreference.filter({ 
      created_by: user.email, 
      enabled: true,
      is_simulation: isSimMode 
    }, "-updated_date");
    
    if (!Array.isArray(prefs) || prefs.length === 0) {
      return Response.json({ success: true, message: 'No preferences', trades_count: 0 });
    }

    let wallet = await getLatestWallet(base44, user.email);
    if (!wallet) {
      return Response.json({ success: true, message: 'No wallet for user', trades_count: 0 });
    }

    // CRITICAL: Use correct balance based on mode
    let availableCash = isSimMode ? (wallet.cash_balance || 0) : (wallet.real_cash_balance || 0);
    const cashBefore = availableCash;
    
    if (availableCash <= 0.99) {
      return Response.json({ 
        success: true, 
        message: 'Insufficient cash', 
        trades_count: 0, 
        mode: isSimMode ? 'sim' : 'live' 
      });
    }

    // Price lookup
    const cryptoSymbols = prefs.filter(p => (p.asset_type || '').toLowerCase() === 'crypto').map(p => (p.symbol || '').toUpperCase());
    const stockSymbols = prefs.filter(p => (p.asset_type || '').toLowerCase() === 'stock').map(p => (p.symbol || '').toUpperCase());
    const priceMap = await getPrices(base44, cryptoSymbols, stockSymbols);

    // Get AI analysis for intelligent execution decisions
    let aiAnalysis = {};
    try {
      const analysisResponse = await Promise.race([
        base44.functions.invoke('analyzeSmallGains', {
          symbols: [...cryptoSymbols, ...stockSymbols],
          includeMarketIntelligence: true
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 15000))
      ]);
      const analysisData = analysisResponse?.data || analysisResponse;
      if (analysisData?.success && Array.isArray(analysisData?.recommendations)) {
        for (const rec of analysisData.recommendations) {
          const sym = (rec.symbol || '').toUpperCase();
          aiAnalysis[sym] = {
            confidence: (rec.confidence_score || 50) / 100,
            action: (rec.optimal_action || rec.action || 'hold').toLowerCase(),
            reasoning: rec.reasoning || '',
            timingWindow: rec.timing_window || 'short_term', // 'immediate', 'short_term', 'wait'
            technicalPattern: rec.technical_pattern || null
          };
        }
      }
    } catch (e) {
      console.log('[runAutoTrader] AI analysis unavailable, using defaults');
    }

    const tradesPlaced = [];
    const MIN_CONFIDENCE_THRESHOLD = 0.55; // Only execute if AI confidence >= 55%
    
    for (const pref of prefs) {
      if (!pref?.enabled) continue;
      const sym = (pref.symbol || '').toUpperCase();
      const typ = (pref.asset_type || '').toLowerCase();
      if (!sym || !typ) continue;

      const price = priceMap.get(sym);
      if (price == null || price <= 0) continue;

      // Check AI recommendation - skip if AI says don't buy or low confidence
      const ai = aiAnalysis[sym] || { confidence: 0.6, action: 'buy', timingWindow: 'short_term' };
      if (ai.action !== 'buy' && ai.action !== 'strong_buy') {
        console.log(`[runAutoTrader] Skipping ${sym} - AI recommends: ${ai.action}`);
        continue;
      }
      if (ai.confidence < MIN_CONFIDENCE_THRESHOLD) {
        console.log(`[runAutoTrader] Skipping ${sym} - AI confidence too low: ${(ai.confidence * 100).toFixed(0)}%`);
        continue;
      }
      
      // CRITICAL: In LIVE mode, only execute if timing is "immediate" (NOW) or confidence > 75%
      // This prevents spending money on trades that aren't ready yet
      if (!isSimMode) {
        const isImmediateTiming = ai.timingWindow === 'immediate';
        const isHighConfidence = ai.confidence >= 0.75;
        
        if (!isImmediateTiming && !isHighConfidence) {
          console.log(`[runAutoTrader] Skipping ${sym} - timing: ${ai.timingWindow}, confidence: ${(ai.confidence * 100).toFixed(0)}% (need 'immediate' or 75%+)`);
          continue;
        }
        console.log(`[runAutoTrader] ✅ ${sym} ready for LIVE execution - timing: ${ai.timingWindow}, confidence: ${(ai.confidence * 100).toFixed(0)}%`);
      }

      // Re-fetch latest wallet
      wallet = await getLatestWallet(base44, user.email);
      availableCash = isSimMode ? (wallet?.cash_balance || availableCash) : (wallet?.real_cash_balance || availableCash);

      const pct = Math.max(1, Number(pref.percentage || 0));
      const budget = round2((availableCash * pct) / 100);
      if (budget < 1) continue;

      const qty = price > 0 ? (budget / price) : 0;
      if (qty <= 0) continue;

      const total_value = round2(qty * price);
      if (total_value > availableCash) continue;

      // CRITICAL: Execute trade based on mode
      if (!isSimMode) {
        // LIVE MODE: Use Kraken API with bracket orders (TP + SL)
        try {
          // Calculate TP and SL prices
          const gainMargin = settings.gain_margin || 10;
          const lossMargin = settings.loss_margin || 5;
          const takeProfitPrice = round2(price * (1 + gainMargin / 100));
          const stopLossPrice = round2(price * (1 - lossMargin / 100));
          
          console.log(`[runAutoTrader] Executing LIVE buy: ${sym} qty=${qty} @ $${price}`);
          console.log(`[runAutoTrader] TP: $${takeProfitPrice} (+${gainMargin}%), SL: $${stopLossPrice} (-${lossMargin}%)`);
          
          // Step 1: Place market BUY order
          const buyResponse = await base44.functions.invoke('krakenTrade', {
            action: 'place_order',
            symbol: sym,
            side: 'buy',
            quantity: qty,
            orderType: 'market',
            timeInForce: 'ioc'
          });

          const buyData = buyResponse?.data || buyResponse;
          if (!buyData?.success) {
            throw new Error(buyData?.error || 'Kraken buy failed');
          }
          
          const buyOrderId = buyData.order_id;
          console.log(`[runAutoTrader] ✅ BUY executed: ${buyOrderId}`);
          
          // Record LIVE trade immediately
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
          
          // Step 2: Place bracket orders (TP + SL) with delay
          await new Promise(res => setTimeout(res, 2000));
          
          let tpOrderId = null;
          let slOrderId = null;
          
          try {
            const bracketResponse = await base44.functions.invoke('krakenTrade', {
              action: 'place_bracket_orders',
              symbol: sym,
              quantity: qty,
              takeProfitPrice: takeProfitPrice,
              stopLossPrice: stopLossPrice
            });
            
            const bracketData = bracketResponse?.data || bracketResponse;
            if (bracketData?.tp_success) {
              tpOrderId = bracketData.tp_order_id;
              console.log(`[runAutoTrader] ✅ TP order placed: ${tpOrderId}`);
            }
            if (bracketData?.sl_success) {
              slOrderId = bracketData.sl_order_id;
              console.log(`[runAutoTrader] ✅ SL order placed: ${slOrderId}`);
            }
          } catch (bracketError) {
            console.error('[runAutoTrader] Bracket orders failed:', bracketError.message);
            // Continue even if bracket orders fail - we still have the position
          }
          
          // Store Kraken order IDs for tracking
          const krakenOrderIds = [buyOrderId, tpOrderId, slOrderId].filter(Boolean).join(',');

        } catch (krakenError) {
          console.error('[runAutoTrader] Kraken buy failed:', krakenError.message);
          continue;
        }
      } else {
        // SIM MODE: Database only
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

      // Create conditional order for stop-loss/take-profit management
      const gainMargin = settings.gain_margin || 10;
      const lossMargin = settings.loss_margin || 5;
      const trailingEnabled = settings.trailing_takeprofit_enabled !== false;
      const trailingMargin = settings.trailing_takeprofit_margin || 3;

      // For LIVE mode, include Kraken order IDs in conditional order
      const conditionalOrderData = {
        symbol: sym,
        asset_type: typ,
        quantity: qty,
        purchase_price: price,
        gain_margin: gainMargin,
        loss_margin: lossMargin,
        status: 'active',
        trailing_enabled: trailingEnabled,
        highest_price: price,
        trailing_margin: trailingMargin,
        is_simulation: isSimMode,
        created_by: user.email
      };
      
      // Add Kraken order IDs if in LIVE mode
      if (!isSimMode && typeof krakenOrderIds !== 'undefined' && krakenOrderIds) {
        conditionalOrderData.kraken_order_id = krakenOrderIds;
      }
      
      await base44.entities.ConditionalOrder.create(conditionalOrderData);

      tradesPlaced.push({
        symbol: sym,
        asset_type: typ,
        qty,
        price,
        total_value,
        ai_confidence: Math.round(ai.confidence * 100)
      });

      if (availableCash < 1) break;
    }

    // Reconcile wallet
    try {
      await base44.functions.invoke('reconcileWallet', { mode: isSimMode ? 'sim' : 'real' });
    } catch (e) {
      console.error('[runAutoTrader] Reconcile error:', e.message);
    }

    return Response.json({
      success: true,
      mode: isSimMode ? 'sim' : 'live',
      trades_count: tradesPlaced.length,
      cash_before: cashBefore,
      cash_after_estimated: availableCash,
      trades: tradesPlaced
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
});