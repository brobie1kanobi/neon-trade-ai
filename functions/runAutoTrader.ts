import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * CRITICAL: Auto-Trader - RESPECTS MODE SETTING
 * - LIVE mode: Uses Kraken API for real trades with real money
 * - SIM mode: Uses database for simulated trades
 * 
 * LEGAL COMPLIANCE: Never mixes real and fake money
 * 
 * AUTO-EXECUTION THRESHOLD: 70% confidence
 * Assets at 70%+ confidence with "buy" action are auto-executed with TP/SL
 */

function round2(n) {
  const x = Number(n || 0);
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

async function getLatestWallet(base44, email) {
  const list = await base44.entities.Wallet.filter({ created_by: email }, "-updated_date");
  return list[0] || null;
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

    // CRITICAL: Fetch prospects from the same source as AutoTraderProspects page
    // This ensures consistency - we trade exactly what the prospects page shows
    console.log('[runAutoTrader] Fetching prospects for auto-execution...');
    
    let prospects = [];
    let cashAvailable = 0;
    
    try {
      const prospectsResponse = await base44.functions.invoke('getAutoTraderProspects', {});
      const prospectsData = prospectsResponse?.data || prospectsResponse;
      
      if (prospectsData?.success && Array.isArray(prospectsData?.prospects)) {
        prospects = prospectsData.prospects;
        cashAvailable = prospectsData.cash_available || 0;
        console.log(`[runAutoTrader] Got ${prospects.length} prospects, cash: $${cashAvailable.toFixed(2)}`);
      } else {
        console.log('[runAutoTrader] No prospects available');
        return Response.json({ success: true, message: 'No prospects available', trades_count: 0 });
      }
    } catch (prospectError) {
      console.error('[runAutoTrader] Failed to fetch prospects:', prospectError.message);
      return Response.json({ success: false, error: 'Failed to fetch prospects: ' + prospectError.message });
    }

    // For SIM mode, use wallet balance instead of Kraken
    let availableCash = cashAvailable;
    if (isSimMode) {
      const wallet = await getLatestWallet(base44, user.email);
      availableCash = wallet?.cash_balance || 0;
    }
    
    const cashBefore = availableCash;
    
    if (availableCash <= 0.99) {
      return Response.json({ 
        success: true, 
        message: 'Insufficient cash', 
        trades_count: 0, 
        mode: isSimMode ? 'sim' : 'live',
        available_cash: availableCash
      });
    }

    // CRITICAL: Auto-execution threshold - 70% confidence
    const AUTO_EXECUTE_THRESHOLD = 0.70;
    
    // Filter prospects that qualify for auto-execution:
    // 1. Confidence >= 70%
    // 2. Action is "buy" 
    // 3. Not blocked
    // 4. Would execute (has sufficient funds)
    const eligibleProspects = prospects.filter(p => {
      const confidence = (p.confidence_score || 0) / 100;
      const action = (p.optimal_action || 'buy').toLowerCase();
      const isBuy = action === 'buy' || action === 'strong_buy';
      const notBlocked = !p.is_blocked;
      const wouldExecute = p.would_execute_now === true;
      
      const eligible = confidence >= AUTO_EXECUTE_THRESHOLD && isBuy && notBlocked && wouldExecute;
      
      if (eligible) {
        console.log(`[runAutoTrader] ✅ ${p.symbol} ELIGIBLE: ${p.confidence_score}% confidence, action: ${action}`);
      } else {
        console.log(`[runAutoTrader] ⏭️ ${p.symbol} SKIPPED: ${p.confidence_score}% confidence (need ${AUTO_EXECUTE_THRESHOLD * 100}%+), action: ${action}, blocked: ${p.is_blocked}`);
      }
      
      return eligible;
    });

    console.log(`[runAutoTrader] ${eligibleProspects.length} prospects eligible for auto-execution (70%+ confidence)`);

    if (eligibleProspects.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No prospects meet 70% confidence threshold', 
        trades_count: 0,
        mode: isSimMode ? 'sim' : 'live',
        total_prospects: prospects.length,
        threshold: AUTO_EXECUTE_THRESHOLD * 100
      });
    }

    const tradesPlaced = [];
    const gainMargin = settings.gain_margin || 10;
    const lossMargin = settings.loss_margin || 5;
    const trailingEnabled = settings.trailing_takeprofit_enabled !== false;
    const trailingMargin = settings.trailing_takeprofit_margin || 3;
    
    // Process each eligible prospect
    for (const prospect of eligibleProspects) {
      const sym = (prospect.symbol || '').toUpperCase();
      const typ = (prospect.asset_type || 'crypto').toLowerCase();
      const price = prospect.current_price || 0;
      const qty = prospect.quantity || 0;
      const total_value = prospect.total_value || 0;
      const confidence = prospect.confidence_score || 0;
      
      if (price <= 0 || qty <= 0 || total_value <= 0) {
        console.log(`[runAutoTrader] Skipping ${sym} - invalid values`);
        continue;
      }
      
      if (total_value > availableCash) {
        console.log(`[runAutoTrader] Skipping ${sym} - exceeds available cash ($${total_value.toFixed(2)} > $${availableCash.toFixed(2)})`);
        continue;
      }

      console.log(`[runAutoTrader] 🚀 AUTO-EXECUTING ${sym}: ${qty} @ $${price} = $${total_value.toFixed(2)} (${confidence}% confidence)`);
      
      let krakenOrderIds = '';

      // CRITICAL: Execute trade based on mode
      if (!isSimMode) {
        // LIVE MODE: Use Kraken API with bracket orders (TP + SL)
        try {
          // Calculate TP and SL prices using user's settings
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
          krakenOrderIds = [buyOrderId, tpOrderId, slOrderId].filter(Boolean).join(',');

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
      if (!isSimMode && krakenOrderIds) {
        conditionalOrderData.kraken_order_id = krakenOrderIds;
      }
      
      await base44.entities.ConditionalOrder.create(conditionalOrderData);

      tradesPlaced.push({
        symbol: sym,
        asset_type: typ,
        qty,
        price,
        total_value,
        ai_confidence: confidence
      });

      console.log(`[runAutoTrader] ✅ Trade completed for ${sym}`);

      if (availableCash < 1) break;
    }

    // Reconcile wallet
    try {
      await base44.functions.invoke('reconcileWallet', { mode: isSimMode ? 'sim' : 'real' });
    } catch (e) {
      console.error('[runAutoTrader] Reconcile error:', e.message);
    }

    console.log(`[runAutoTrader] ✅ Completed: ${tradesPlaced.length} trades executed`);

    return Response.json({
      success: true,
      mode: isSimMode ? 'sim' : 'live',
      trades_count: tradesPlaced.length,
      cash_before: cashBefore,
      cash_after_estimated: availableCash,
      trades: tradesPlaced,
      auto_execute_threshold: 70,
      total_prospects_analyzed: prospects.length
    });
  } catch (error) {
    console.error('[runAutoTrader] Fatal error:', error);
    return Response.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
});