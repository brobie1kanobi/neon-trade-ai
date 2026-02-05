import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * CRITICAL: Auto-Trader - RESPECTS MODE SETTING
 * - LIVE mode: Uses Kraken API for real trades with real money
 * - SIM mode: Uses database for simulated trades
 * 
 * LEGAL COMPLIANCE: Never mixes real and fake money
 * 
 * AUTO-EXECUTION THRESHOLD: 70% confidence (dynamic based on history)
 * Assets at 70%+ confidence with "buy" action are auto-executed with TP/SL
 * 
 * ENHANCED FEATURES:
 * - Dynamic TP/SL based on historical win rates and optimal zones
 * - Proactive emerging prospect detection and execution
 * - Risk-adjusted position sizing based on asset performance history
 * - Confidence adjustment from trade history data
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

/**
 * Calculate dynamic TP/SL levels based on historical trade data
 * Uses actual win rates and average gains to optimize exit points
 */
function calculateDynamicLevels(symbol, historyData, defaultGainMargin, defaultLossMargin) {
  const assetHistory = historyData?.asset_analytics?.[symbol?.toUpperCase()];
  
  if (!assetHistory || assetHistory.total_trades < 3) {
    // Not enough history - use defaults
    return {
      gainMargin: defaultGainMargin,
      lossMargin: defaultLossMargin,
      confidence_boost: 0,
      source: 'default'
    };
  }
  
  const winRate = assetHistory.win_rate || 50;
  const avgGain = assetHistory.avg_successful_gain_pct || defaultGainMargin;
  const optimalBuyZone = assetHistory.optimal_buy_zone || {};
  
  // Dynamic gain margin based on historical average successful gains
  // Use 80% of historical average to be conservative
  let dynamicGainMargin = Math.max(defaultGainMargin, avgGain * 0.8);
  dynamicGainMargin = Math.min(dynamicGainMargin, 15); // Cap at 15%
  
  // Dynamic loss margin based on win rate
  // Higher win rate = can afford tighter stops, lower = need wider stops
  let dynamicLossMargin = defaultLossMargin;
  if (winRate > 70) {
    // High performer - tighter stop is ok
    dynamicLossMargin = Math.max(1, defaultLossMargin * 0.8);
  } else if (winRate < 50) {
    // Lower performer - wider stop to give more room
    dynamicLossMargin = Math.min(5, defaultLossMargin * 1.3);
  }
  
  // Confidence boost based on historical performance
  let confidenceBoost = 0;
  if (winRate > 75) confidenceBoost = 10;
  else if (winRate > 65) confidenceBoost = 5;
  else if (winRate < 40 && assetHistory.total_trades > 5) confidenceBoost = -10;
  
  return {
    gainMargin: round2(dynamicGainMargin),
    lossMargin: round2(dynamicLossMargin),
    confidence_boost: confidenceBoost,
    win_rate: winRate,
    historical_avg_gain: avgGain,
    optimal_buy_zone: optimalBuyZone,
    source: 'historical'
  };
}

/**
 * Evaluate emerging prospects from market intelligence
 * Returns prospects that meet risk tolerance and allocation criteria
 */
function evaluateEmergingProspects(marketIntelligence, currentHoldings, cashAvailable, riskTolerance) {
  const emergingProspects = marketIntelligence?.emerging_prospects || [];
  const avoidList = marketIntelligence?.avoid_list || [];
  
  if (emergingProspects.length === 0) return [];
  
  // Calculate current allocation by asset
  const holdingSymbols = new Set((currentHoldings || []).map(h => h.symbol?.toUpperCase()));
  
  // Filter and score emerging prospects
  const viable = emergingProspects
    .filter(ep => {
      // Skip if on avoid list
      if (avoidList.includes(ep.symbol)) return false;
      // Skip if we already hold this asset (avoid over-concentration)
      if (holdingSymbols.has(ep.symbol?.toUpperCase())) return false;
      return true;
    })
    .map(ep => {
      // Risk-adjusted scoring
      const potentialGain = ep.potential_gain_pct || 5;
      const riskScore = riskTolerance === 'high' ? 1.2 : riskTolerance === 'low' ? 0.7 : 1.0;
      
      return {
        ...ep,
        adjusted_score: potentialGain * riskScore,
        max_allocation: Math.min(cashAvailable * 0.15, 50) // Max 15% of cash or $50
      };
    })
    .sort((a, b) => b.adjusted_score - a.adjusted_score);
  
  return viable.slice(0, 2); // Max 2 emerging prospects per run
}

// Invoke krakenTrade with robust retries and token refresh on permission errors
// CRITICAL: Does NOT retry on insufficient funds or other order-specific errors
async function invokeKrakenTrade(base44, payload, maxAttempts = 4, wsToken = null) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await base44.functions.invoke('krakenTrade', wsToken ? { ...payload, wsToken } : payload);
      const data = res?.data || res;
      if (data?.success === false) {
        const msg = String(data?.error || '');
        
        // CRITICAL: Don't retry on insufficient funds - this won't resolve
        if (/insufficient funds/i.test(msg) || /EOrder:Insufficient funds/i.test(msg)) {
          console.error('[runAutoTrader] Insufficient funds - aborting order');
          return data; // Return the error response, don't retry
        }
        if (/insufficient margin/i.test(msg) || /EOrder:Insufficient margin/i.test(msg)) {
          console.error('[runAutoTrader] Insufficient margin - aborting order');
          return data;
        }
        // Don't retry other order-specific errors
        if (/invalid volume/i.test(msg) || /EOrder:Invalid volume/i.test(msg)) { return data; }
        if (/invalid price/i.test(msg) || /EOrder:Invalid price/i.test(msg)) { return data; }
        if (/unknown order/i.test(msg) || /EOrder:Unknown order/i.test(msg)) { return data; }
        
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
      
      // CRITICAL: Don't retry on insufficient funds or order errors - throw immediately
      if (/insufficient funds/i.test(msg) || /EOrder:Insufficient funds/i.test(msg)) { throw e; }
      if (/insufficient margin/i.test(msg) || /EOrder:Insufficient margin/i.test(msg)) { throw e; }
      if (/invalid volume/i.test(msg) || /EOrder:Invalid volume/i.test(msg)) { throw e; }
      if (/invalid price/i.test(msg) || /EOrder:Invalid price/i.test(msg)) { throw e; }
      
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
    let marketIntelligence = null;
    let tradeHistoryData = null;
    
    // Fetch trade history for dynamic TP/SL calculation
    try {
      console.log('[runAutoTrader] Fetching trade history for dynamic levels...');
      const historyResponse = await base44.functions.invoke('analyzeTradeHistory', {
        includeKrakenHistory: true,
        analyzePatterns: false // Skip AI analysis for speed
      });
      tradeHistoryData = historyResponse?.data || historyResponse;
      if (tradeHistoryData?.success) {
        console.log(`[runAutoTrader] Got history for ${Object.keys(tradeHistoryData.asset_analytics || {}).length} assets`);
      }
    } catch (histErr) {
      console.warn('[runAutoTrader] Trade history fetch failed (continuing with defaults):', histErr.message);
    }
    
    try {
      const prospectsResponse = await base44.functions.invoke('getAutoTraderProspects', {});
      const prospectsData = prospectsResponse?.data || prospectsResponse;
      
      if (prospectsData?.success && Array.isArray(prospectsData?.prospects)) {
        prospects = prospectsData.prospects;
        cashAvailable = prospectsData.cash_available || 0;
        marketIntelligence = prospectsData.market_intelligence || null;
        console.log(`[runAutoTrader] Got ${prospects.length} prospects, cash: $${cashAvailable.toFixed(2)}`);
        
        // CRITICAL: Log each prospect's allocation to verify user settings are being used
        prospects.forEach(p => {
          console.log(`[runAutoTrader] Prospect ${p.symbol}: user_allocation=${p.user_allocation_pct}%, actual=${p.allocation_percent}%, qty=${p.quantity}, value=$${p.total_value?.toFixed(2)}`);
        });
      } else {
        console.log('[runAutoTrader] No prospects available');
        return Response.json({ success: true, message: 'No prospects available', trades_count: 0 });
      }
    } catch (prospectError) {
      console.error('[runAutoTrader] Failed to fetch prospects:', prospectError.message);
      return Response.json({ success: false, error: 'Failed to fetch prospects: ' + prospectError.message });
    }
    
    // Fetch current holdings for emerging prospect evaluation
    let currentHoldings = [];
    try {
      currentHoldings = await base44.entities.Holding.filter({
        created_by: user.email,
        is_simulation: isSimMode
      });
    } catch (_e) {}
    
    // Determine user's risk tolerance based on settings
    const riskTolerance = settings.gain_margin > 8 ? 'high' : settings.gain_margin < 4 ? 'low' : 'medium';
    console.log(`[runAutoTrader] User risk tolerance: ${riskTolerance} (gain margin: ${settings.gain_margin}%)`);
    
    // Evaluate emerging prospects from market intelligence
    const emergingOpportunities = evaluateEmergingProspects(
      marketIntelligence, 
      currentHoldings, 
      cashAvailable,
      riskTolerance
    );
    
    if (emergingOpportunities.length > 0) {
      console.log(`[runAutoTrader] Found ${emergingOpportunities.length} emerging prospects:`);
      emergingOpportunities.forEach(ep => {
        console.log(`  - ${ep.symbol}: potential +${ep.potential_gain_pct}%, reason: ${ep.reason}`);
      });
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

    // CRITICAL: Auto-execution threshold - 75% confidence (raised from 70% to be more selective)
    // Only execute trades with HIGH confidence to avoid buying into downtrends
    const AUTO_EXECUTE_THRESHOLD = 75;
    
    // Filter prospects that qualify for auto-execution:
    // 1. Confidence >= 75% (raised threshold)
    // 2. Action is "buy" or "strong_buy" (explicit buy signal)
    // 3. Not blocked
    // 4. Would execute (has sufficient funds)
    // 5. NEW: 24h price change is not significantly negative (not buying into downtrend)
    const eligibleProspects = prospects.filter(p => {
      const confidenceScore = Number(p.confidence_score || 0);
      const action = (p.optimal_action || 'hold').toLowerCase(); // Default to hold, not buy
      const isBuy = action === 'buy' || action === 'strong_buy';
      const notBlocked = !p.is_blocked;
      const wouldExecute = p.would_execute_now === true;
      
      // CRITICAL: Check 24h price trend - don't buy into falling knives
      const change24h = Number(p.market_trend || p.current_24h_change || 0);
      const notFalling = change24h > -3; // Allow small dips but not major drops
      
      const meetsConfidence = confidenceScore >= AUTO_EXECUTE_THRESHOLD;
      const eligible = meetsConfidence && isBuy && notBlocked && wouldExecute && notFalling;
      
      console.log(`[runAutoTrader] ${p.symbol}: confidence=${confidenceScore}%, action=${action}, 24h=${change24h.toFixed(1)}%, blocked=${p.is_blocked}, wouldExecute=${wouldExecute}`);
      
      if (eligible) {
        console.log(`[runAutoTrader] ✅ ${p.symbol} ELIGIBLE for auto-execution`);
      } else {
        const reasons = [];
        if (!meetsConfidence) reasons.push(`confidence ${confidenceScore}% < ${AUTO_EXECUTE_THRESHOLD}%`);
        if (!isBuy) reasons.push(`action is "${action}" (need buy/strong_buy)`);
        if (!notFalling) reasons.push(`price falling ${change24h.toFixed(1)}% - avoiding downtrend`);
        if (p.is_blocked) reasons.push(`blocked: ${p.block_reason}`);
        if (!wouldExecute) reasons.push('would_execute_now=false');
        console.log(`[runAutoTrader] ⏭️ ${p.symbol} SKIPPED: ${reasons.join(', ')}`);
      }
      
      return eligible;
    });

    console.log(`[runAutoTrader] ${eligibleProspects.length} prospects eligible for auto-execution (${AUTO_EXECUTE_THRESHOLD}%+ confidence, not falling)`);

    if (eligibleProspects.length === 0) {
      // Debug: log why each prospect was skipped
      console.log('[runAutoTrader] No eligible prospects. Summary:');
      prospects.forEach(p => {
        const change24h = Number(p.market_trend || p.current_24h_change || 0);
        console.log(`  - ${p.symbol}: ${p.confidence_score}% conf, action=${p.optimal_action}, 24h=${change24h.toFixed(1)}%, blocked=${p.is_blocked}, would_execute=${p.would_execute_now}`);
      });
      
      return Response.json({ 
        success: true, 
        message: `No prospects meet ${AUTO_EXECUTE_THRESHOLD}% confidence threshold or are in downtrend`, 
        trades_count: 0,
        mode: isSimMode ? 'sim' : 'live',
        total_prospects: prospects.length,
        threshold: AUTO_EXECUTE_THRESHOLD,
        prospect_summary: prospects.map(p => ({
          symbol: p.symbol,
          confidence: p.confidence_score,
          action: p.optimal_action,
          change_24h: Number(p.market_trend || p.current_24h_change || 0),
          blocked: p.is_blocked,
          would_execute: p.would_execute_now
        }))
      });
    }

    const tradesPlaced = [];
    const defaultGainMargin = settings.gain_margin || 3;
    const defaultLossMargin = settings.loss_margin || 1;
    const trailingEnabled = settings.trailing_takeprofit_enabled !== false;
    const defaultTrailingMargin = settings.trailing_takeprofit_margin || 3;
    
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
      // CRITICAL: Use the quantity and total_value from prospects - these are calculated using user's allocation %
      const qty = prospect.quantity || 0;
      const total_value = prospect.total_value || 0;
      let confidence = prospect.confidence_score || 0;
      const userAllocationPct = prospect.user_allocation_pct || 10;
      
      // ENHANCED: Calculate dynamic TP/SL based on trade history
      const dynamicLevels = calculateDynamicLevels(sym, tradeHistoryData, defaultGainMargin, defaultLossMargin);
      const gainMargin = dynamicLevels.gainMargin;
      const lossMargin = dynamicLevels.lossMargin;
      const trailingMargin = defaultTrailingMargin;
      
      // Adjust confidence based on historical performance
      confidence = Math.max(0, Math.min(100, confidence + dynamicLevels.confidence_boost));
      
      console.log(`[runAutoTrader] Processing ${sym}: price=$${price}, qty=${qty}, value=$${total_value.toFixed(2)}, user_alloc=${userAllocationPct}%`);
      console.log(`[runAutoTrader] Dynamic levels for ${sym}: TP=${gainMargin}%, SL=${lossMargin}%, confidence_boost=${dynamicLevels.confidence_boost}, source=${dynamicLevels.source}`);
      if (dynamicLevels.win_rate) {
        console.log(`[runAutoTrader] ${sym} historical: win_rate=${dynamicLevels.win_rate.toFixed(1)}%, avg_gain=${dynamicLevels.historical_avg_gain?.toFixed(1)}%`);
      }
      
      if (price <= 0 || qty <= 0 || total_value <= 0) {
        console.log(`[runAutoTrader] Skipping ${sym} - invalid values (price=${price}, qty=${qty}, value=${total_value})`);
        continue;
      }
      
      // CRITICAL: Add buffer for slippage/fees (2% or $1 minimum)
      const requiredCash = total_value + Math.max(1.0, total_value * 0.02);
      if (requiredCash > availableCash) {
        console.log(`[runAutoTrader] Skipping ${sym} - exceeds available cash ($${requiredCash.toFixed(2)} needed > $${availableCash.toFixed(2)} available)`);
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
          
          // CRITICAL: Record LIVE trade with ACTUAL executed quantity from Kraken response
          // The Kraken order response tells us exactly how much was actually bought
          const executedQty = buyData.executed_qty || buyData.quantity || qty;
          const executedValue = executedQty * price;
          
          console.log(`[runAutoTrader] Recording trade: requested qty=${qty}, executed qty=${executedQty}, value=$${executedValue.toFixed(2)}`);
          
          await base44.entities.Trade.create({
            symbol: sym,
            type: 'buy',
            asset_type: typ,
            quantity: executedQty,  // Use ACTUAL executed quantity
            price: price,
            total_value: executedValue,  // Use ACTUAL executed value
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
              }, 4, wsToken);
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
                }, 4, wsToken);
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
              }, 4, wsToken);
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
      // ENHANCED: Include historical context for smarter order management
      const conditionalOrderData = {
        symbol: sym,
        asset_type: typ,
        quantity: qty,
        purchase_price: price,
        gain_margin: gainMargin,  // Dynamic based on history
        loss_margin: lossMargin,  // Dynamic based on history
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
        ai_confidence: confidence,
        dynamic_levels: dynamicLevels,
        effective_gain_margin: gainMargin,
        effective_loss_margin: lossMargin
      });

      console.log(`[runAutoTrader] ✅ Trade completed for ${sym}`);

      // Pace between prospects to avoid Kraken burst limits
      // Extra pacing between orders to avoid WS bursts
      await sleep(2200 + Math.floor(Math.random() * 1800));

      if (availableCash < 1) break;
    }

    // Process emerging prospects (if enabled and we have capacity)
    let emergingTradesPlaced = [];
    if (emergingOpportunities.length > 0 && availableCash > 10 && settings.auto_trading_enabled) {
      console.log(`[runAutoTrader] Processing ${emergingOpportunities.length} emerging prospects...`);
      
      for (const emerging of emergingOpportunities) {
        if (availableCash < 5) break;
        
        const emergingSymbol = (emerging.symbol || '').toUpperCase();
        
        // Fetch current price for emerging prospect
        let emergingPrice = 0;
        try {
          const priceRes = await base44.functions.invoke('getMarketData', {
            action: 'getWatchlistData',
            payload: { cryptoSymbols: [emergingSymbol], stockSymbols: [] }
          });
          const priceData = (priceRes?.data || [])[0];
          emergingPrice = priceData?.price || 0;
        } catch (_e) {}
        
        if (emergingPrice <= 0) {
          console.log(`[runAutoTrader] Skipping emerging ${emergingSymbol} - no price available`);
          continue;
        }
        
        // Calculate position size for emerging prospects (more conservative)
        const emergingAllocation = Math.min(emerging.max_allocation, availableCash * 0.1);
        const emergingQty = emergingAllocation / emergingPrice;
        
        if (emergingAllocation < 5) {
          console.log(`[runAutoTrader] Skipping emerging ${emergingSymbol} - allocation too small ($${emergingAllocation.toFixed(2)})`);
          continue;
        }
        
        console.log(`[runAutoTrader] 🌟 EMERGING: ${emergingSymbol} @ $${emergingPrice} - allocating $${emergingAllocation.toFixed(2)}`);
        
        // Use conservative levels for emerging (untested) assets
        const emergingGainMargin = defaultGainMargin;
        const emergingLossMargin = Math.min(defaultLossMargin * 1.5, 5); // Wider stop for new assets
        
        if (!isSimMode) {
          // LIVE: Execute via Kraken
          try {
            await sleep(500);
            const emergingBuyData = await invokeKrakenTrade(base44, {
              action: 'place_order',
              symbol: emergingSymbol,
              side: 'buy',
              quantity: emergingQty,
              orderType: 'market'
            }, 4, wsToken);
            
            if (emergingBuyData?.success) {
              console.log(`[runAutoTrader] ✅ Emerging buy executed: ${emergingBuyData.order_id}`);
              
              await base44.entities.Trade.create({
                symbol: emergingSymbol,
                type: 'buy',
                asset_type: 'crypto',
                quantity: emergingQty,
                price: emergingPrice,
                total_value: emergingAllocation,
                status: 'executed',
                is_auto_trade: true,
                is_simulation: false,
                created_by: user.email
              });
              
              emergingTradesPlaced.push({
                symbol: emergingSymbol,
                qty: emergingQty,
                price: emergingPrice,
                total_value: emergingAllocation,
                reason: emerging.reason,
                is_emerging: true
              });
              
              availableCash -= emergingAllocation;
            }
          } catch (emergingErr) {
            console.warn(`[runAutoTrader] Emerging trade failed for ${emergingSymbol}:`, emergingErr.message);
          }
        } else {
          // SIM: Database only
          await base44.entities.Trade.create({
            symbol: emergingSymbol,
            type: 'buy',
            asset_type: 'crypto',
            quantity: emergingQty,
            price: emergingPrice,
            total_value: emergingAllocation,
            status: 'executed',
            is_auto_trade: true,
            is_simulation: true,
            created_by: user.email
          });
          
          emergingTradesPlaced.push({
            symbol: emergingSymbol,
            qty: emergingQty,
            price: emergingPrice,
            total_value: emergingAllocation,
            reason: emerging.reason,
            is_emerging: true
          });
          
          availableCash -= emergingAllocation;
        }
        
        await sleep(1500);
      }
    }

    // Reconcile wallet
    try {
      await base44.functions.invoke('reconcileWallet', { mode: isSimMode ? 'sim' : 'real' });
    } catch (e) {
      console.error('[runAutoTrader] Reconcile error:', e.message);
    }

    const totalTrades = tradesPlaced.length + emergingTradesPlaced.length;
    console.log(`[runAutoTrader] ✅ Completed: ${tradesPlaced.length} standard + ${emergingTradesPlaced.length} emerging = ${totalTrades} total trades`);
    
    // Summary of advanced orders placed
    const advancedOrderSummary = tradesPlaced.map(t => ({
      symbol: t.symbol,
      qty: t.qty,
      entry_price: t.price,
      tp_target: round2(t.price * (1 + t.effective_gain_margin / 100)),
      tp_percent: t.effective_gain_margin,
      sl_percent: t.effective_loss_margin,
      trailing_stop: trailingEnabled ? `${defaultTrailingMargin}% from peak` : `Static SL at ${round2(t.price * (1 - t.effective_loss_margin / 100))}`,
      confidence: t.ai_confidence,
      levels_source: t.dynamic_levels?.source || 'default',
      historical_win_rate: t.dynamic_levels?.win_rate || null
    }));

    return Response.json({
      success: true,
      mode: isSimMode ? 'sim' : 'live',
      trades_count: totalTrades,
      standard_trades: tradesPlaced.length,
      emerging_trades: emergingTradesPlaced.length,
      cash_before: cashBefore,
      cash_after_estimated: availableCash,
      trades: tradesPlaced,
      emerging_trades_detail: emergingTradesPlaced,
      advanced_orders: advancedOrderSummary,
      auto_execute_threshold: AUTO_EXECUTE_THRESHOLD,
      total_prospects_analyzed: prospects.length,
      emerging_opportunities_found: emergingOpportunities.length,
      order_settings: {
        default_gain_margin: defaultGainMargin,
        default_loss_margin: defaultLossMargin,
        trailing_enabled: trailingEnabled,
        trailing_margin: defaultTrailingMargin,
        dynamic_levels_enabled: true
      },
      risk_tolerance: riskTolerance,
      trade_history_used: !!tradeHistoryData?.success
    });
  } catch (error) {
    console.error('[runAutoTrader] Fatal error:', error);
    return Response.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
});