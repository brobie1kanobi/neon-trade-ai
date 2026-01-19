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

/**
 * Kraken price decimal requirements per asset
 * Reference: https://support.kraken.com/hc/en-us/articles/4521313131540-Price-and-volume-decimal-precision
 */
const PRICE_DECIMALS = {
  'BTC': 1,
  'XBT': 1,
  'ETH': 2,
  'XRP': 5,  // XRP trades around $2, needs 5 decimals
  'LTC': 2,
  'SOL': 2,
  'ADA': 5,  // ADA trades around $0.40
  'DOT': 3,
  'DOGE': 5, // DOGE trades around $0.10
  'XDG': 5,
  'LINK': 3,
  'UNI': 3,
  'MATIC': 4,
  'POL': 4,
  'ATOM': 3,
  'AVAX': 2,
  'BCH': 2,
  'TRX': 5,
  'SHIB': 8, // SHIB trades very low
  'XLM': 5,  // XLM trades around $0.20
  'ALGO': 4,
  'FIL': 3,
  'NEAR': 3,
  'APT': 3,
  'ARB': 4,
  'OP': 3,
  'INJ': 2,
  'PEPE': 9, // PEPE trades very low
  'SUI': 4
};

/**
 * Round price to Kraken's required decimal precision for the asset
 */
function roundPriceForKraken(price, symbol) {
  const baseSymbol = String(symbol || '').replace('/USD', '').toUpperCase();
  const decimals = PRICE_DECIMALS[baseSymbol] ?? 4; // Default to 4 decimals if unknown
  const factor = Math.pow(10, decimals);
  return Math.round(price * factor) / factor;
}

// Small helper sleep
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Invoke krakenTrade with robust retries and token refresh on permission errors
async function invokeKrakenTrade(base44, payload, maxAttempts = 4, wsToken = null) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await base44.functions.invoke('krakenTrade', wsToken ? { ...payload, wsToken } : payload);
      const data = res?.data || res;
      if (data?.success === false) {
        const msg = String(data?.error || '');
        if (/permission denied/i.test(msg)) {
          await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade', forceRefresh: true } });
          wsToken = null; // force refetch on next loop
        }
        if (/rate limit|429|timeout|websocket|nonce/i.test(msg)) { throw new Error(msg); }
      }
      return data;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      if (/permission denied/i.test(msg)) {
        await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade', forceRefresh: true } });
        wsToken = null; // force refetch on next loop
      }
      if (/rate limit|429|timeout|websocket|nonce/i.test(msg) && attempt < maxAttempts - 1) {
        const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 800);
        console.warn(`[runAutoTrader] Rate/WS limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
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

    // CRITICAL: Auto-execution threshold - 70% confidence (use integer comparison to avoid float issues)
    const AUTO_EXECUTE_THRESHOLD = 70;
    
    // Filter prospects that qualify for auto-execution:
    // 1. Confidence >= 70%
    // 2. Action is "buy" 
    // 3. Not blocked
    // 4. Would execute (has sufficient funds)
    const eligibleProspects = prospects.filter(p => {
      const confidenceScore = Number(p.confidence_score || 0); // Keep as integer (e.g., 70)
      const action = (p.optimal_action || 'buy').toLowerCase();
      const isBuy = action === 'buy' || action === 'strong_buy';
      const notBlocked = !p.is_blocked;
      const wouldExecute = p.would_execute_now === true;
      
      // FIXED: Use integer comparison (70 >= 70) instead of float (0.70 >= 0.70)
      const meetsConfidence = confidenceScore >= AUTO_EXECUTE_THRESHOLD;
      const eligible = meetsConfidence && isBuy && notBlocked && wouldExecute;
      
      console.log(`[runAutoTrader] ${p.symbol}: confidence=${confidenceScore}%, action=${action}, blocked=${p.is_blocked}, wouldExecute=${wouldExecute}`);
      
      if (eligible) {
        console.log(`[runAutoTrader] ✅ ${p.symbol} ELIGIBLE for auto-execution`);
      } else {
        const reasons = [];
        if (!meetsConfidence) reasons.push(`confidence ${confidenceScore}% < ${AUTO_EXECUTE_THRESHOLD}%`);
        if (!isBuy) reasons.push(`action is ${action}`);
        if (p.is_blocked) reasons.push(`blocked: ${p.block_reason}`);
        if (!wouldExecute) reasons.push('would_execute_now=false');
        console.log(`[runAutoTrader] ⏭️ ${p.symbol} SKIPPED: ${reasons.join(', ')}`);
      }
      
      return eligible;
    });

    console.log(`[runAutoTrader] ${eligibleProspects.length} prospects eligible for auto-execution (70%+ confidence)`);

    if (eligibleProspects.length === 0) {
      // Debug: log why each prospect was skipped
      console.log('[runAutoTrader] No eligible prospects. Summary:');
      prospects.forEach(p => {
        console.log(`  - ${p.symbol}: ${p.confidence_score}% conf, action=${p.optimal_action}, blocked=${p.is_blocked}, would_execute=${p.would_execute_now}`);
      });
      
      return Response.json({ 
        success: true, 
        message: 'No prospects meet 70% confidence threshold', 
        trades_count: 0,
        mode: isSimMode ? 'sim' : 'live',
        total_prospects: prospects.length,
        threshold: AUTO_EXECUTE_THRESHOLD,
        prospect_summary: prospects.map(p => ({
          symbol: p.symbol,
          confidence: p.confidence_score,
          action: p.optimal_action,
          blocked: p.is_blocked,
          would_execute: p.would_execute_now
        }))
      });
    }

    const tradesPlaced = [];
    const gainMargin = settings.gain_margin || 3;
    const lossMargin = settings.loss_margin || 1;
    const trailingEnabled = settings.trailing_takeprofit_enabled !== false;
    const trailingMargin = settings.trailing_takeprofit_margin || 3;
    
    // Fetch a single TRADE WebSocket token once for this run (reuse to avoid rate limits)
    let wsToken = null;
    try {
      const tokenRes = await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade' } });
      const tokenData = tokenRes?.data || tokenRes;
      wsToken = tokenData?.token || null;
    } catch (e) {
      console.warn('[runAutoTrader] Could not prefetch trade WS token (will let krakenTrade fetch):', e.message);
    }

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
        // LIVE MODE: Use Kraken API with ADVANCED orders (Trailing Stop + Take Profit)
        try {
          // Calculate TP price (static) and trailing stop percentage
          // CRITICAL: Round prices to Kraken's required decimal precision per asset
          const rawTpPrice = price * (1 + gainMargin / 100);
          const rawSlPrice = price * (1 - lossMargin / 100);
          const takeProfitPrice = roundPriceForKraken(rawTpPrice, sym);
          const staticStopLossPrice = roundPriceForKraken(rawSlPrice, sym);
          
          console.log(`[runAutoTrader] Price precision for ${sym}: TP ${rawTpPrice} -> ${takeProfitPrice}, SL ${rawSlPrice} -> ${staticStopLossPrice}`);
          
          console.log(`[runAutoTrader] 🚀 Executing LIVE buy: ${sym} qty=${qty} @ $${price}`);
          console.log(`[runAutoTrader] 📊 TP: $${takeProfitPrice} (+${gainMargin}%)`);
          console.log(`[runAutoTrader] 📊 Trailing SL: ${trailingMargin}% from peak (fallback static: $${staticStopLossPrice})`);
          
          // Step 1: Place market BUY order (with pacing)
          await sleep(300 + Math.floor(Math.random() * 700));
          const buyData = await invokeKrakenTrade(base44, {
            action: 'place_order',
            symbol: sym,
            side: 'buy',
            quantity: qty,
            orderType: 'market'
          }, 4, wsToken);
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
          
          // Step 2: Place TAKE PROFIT order (limit at TP price)
          await new Promise(res => setTimeout(res, 2000));
          
          let tpOrderId = null;
          let slOrderId = null;
          
          // Place Take Profit order
          try {
            console.log(`[runAutoTrader] 📤 Placing Take Profit at $${takeProfitPrice}...`);
            const tpData = await invokeKrakenTrade(base44, {
              action: 'place_order',
              symbol: sym,
              side: 'sell',
              quantity: qty,
              orderType: 'take-profit',
              triggerPrice: takeProfitPrice,
              timeInForce: 'gtc'
            }, 4, wsToken);
            console.log(`[runAutoTrader] TP response:`, JSON.stringify(tpData));
            
            if (tpData?.success) {
              tpOrderId = tpData.order_id;
              console.log(`[runAutoTrader] ✅ Take Profit order placed: ${tpOrderId}`);
            } else if (tpData?.order_id) {
              // Sometimes success is not explicitly set but order_id exists
              tpOrderId = tpData.order_id;
              console.log(`[runAutoTrader] ✅ Take Profit order placed (implicit): ${tpOrderId}`);
            } else {
              console.warn(`[runAutoTrader] ⚠️ Take Profit failed: ${tpData?.error || 'Unknown error'}`);
            }
          } catch (tpError) {
            console.error('[runAutoTrader] Take Profit order failed:', tpError.message);
          }
          
          // Step 3: Place TRAILING STOP order (locks in profits as price rises)
          await new Promise(res => setTimeout(res, 2000));
          
          try {
            // Use trailing stop if enabled, otherwise use static stop-loss
            if (trailingEnabled && trailingMargin > 0) {
              console.log(`[runAutoTrader] 📤 Placing Trailing Stop (${trailingMargin}% from peak)...`);
              const slData = await invokeKrakenTrade(base44, {
                action: 'place_trailing_stop',
                symbol: sym,
                quantity: qty,
                trailingPercent: trailingMargin,
                trailingPriceType: 'pct',
                triggerReference: 'last',
                useLimit: false // Use market order on trigger for guaranteed execution
              });
              if (slData?.success) {
                slOrderId = slData.order_id;
                console.log(`[runAutoTrader] ✅ Trailing Stop order placed: ${slOrderId} (${trailingMargin}% trail)`);
              } else {
                console.warn(`[runAutoTrader] ⚠️ Trailing Stop failed: ${slData?.error}, falling back to static SL`);
                // Fallback to static stop-loss
                const fallbackData = await invokeKrakenTrade(base44, {
                  action: 'place_order',
                  symbol: sym,
                  side: 'sell',
                  quantity: qty,
                  orderType: 'stop-loss',
                  stopPrice: staticStopLossPrice,
                  timeInForce: 'gtc'
                });
                if (fallbackData?.success) {
                  slOrderId = fallbackData.order_id;
                  console.log(`[runAutoTrader] ✅ Fallback Stop-Loss placed: ${slOrderId} @ $${staticStopLossPrice}`);
                }
              }
            } else {
              // Use static stop-loss if trailing not enabled
              console.log(`[runAutoTrader] 📤 Placing Static Stop-Loss at $${staticStopLossPrice}...`);
              const slData = await invokeKrakenTrade(base44, {
                action: 'place_order',
                symbol: sym,
                side: 'sell',
                quantity: qty,
                orderType: 'stop-loss',
                stopPrice: staticStopLossPrice,
                timeInForce: 'gtc'
              });
              if (slData?.success) {
                slOrderId = slData.order_id;
                console.log(`[runAutoTrader] ✅ Stop-Loss order placed: ${slOrderId}`);
              } else {
                console.warn(`[runAutoTrader] ⚠️ Stop-Loss failed: ${slData?.error}`);
              }
            }
          } catch (slError) {
            console.error('[runAutoTrader] Stop-Loss order failed:', slError.message);
          }
          
          // Store Kraken order IDs for tracking
          krakenOrderIds = [buyOrderId, tpOrderId, slOrderId].filter(Boolean).join(',');
          
          console.log(`[runAutoTrader] 📋 Order IDs saved: ${krakenOrderIds}`);

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

      // Pace between prospects to avoid Kraken burst limits
      // Extra pacing between orders to avoid WS bursts
      await sleep(2200 + Math.floor(Math.random() * 1800));

      if (availableCash < 1) break;
    }

    // Reconcile wallet
    try {
      await base44.functions.invoke('reconcileWallet', { mode: isSimMode ? 'sim' : 'real' });
    } catch (e) {
      console.error('[runAutoTrader] Reconcile error:', e.message);
    }

    console.log(`[runAutoTrader] ✅ Completed: ${tradesPlaced.length} trades executed`);
    
    // Summary of advanced orders placed
    const advancedOrderSummary = tradesPlaced.map(t => ({
      symbol: t.symbol,
      qty: t.qty,
      entry_price: t.price,
      tp_target: round2(t.price * (1 + gainMargin / 100)),
      trailing_stop: trailingEnabled ? `${trailingMargin}% from peak` : `Static SL at ${round2(t.price * (1 - lossMargin / 100))}`,
      confidence: t.ai_confidence
    }));

    return Response.json({
      success: true,
      mode: isSimMode ? 'sim' : 'live',
      trades_count: tradesPlaced.length,
      cash_before: cashBefore,
      cash_after_estimated: availableCash,
      trades: tradesPlaced,
      advanced_orders: advancedOrderSummary,
      auto_execute_threshold: 70,
      total_prospects_analyzed: prospects.length,
      order_settings: {
        gain_margin: gainMargin,
        loss_margin: lossMargin,
        trailing_enabled: trailingEnabled,
        trailing_margin: trailingMargin
      }
    });
  } catch (error) {
    console.error('[runAutoTrader] Fatal error:', error);
    return Response.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
});