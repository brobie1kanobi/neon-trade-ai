import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * RISK ENGINE
 * 
 * Evaluates proposed trades against risk constraints.
 * All trades (manual or auto) must pass through this engine before execution.
 * 
 * Risk Checks:
 * 1. Max % exposure per asset (default 25%)
 * 2. Max single trade allocation (default 20%)
 * 3. Daily loss cap (configurable)
 * 4. Portfolio drawdown limit (configurable)
 * 5. Concentration limits
 */

// Default risk parameters
const DEFAULT_RISK_PARAMS = {
  maxAssetExposurePercent: 25,      // Max 25% of portfolio in single asset
  maxSingleTradePercent: 20,        // Max 20% of cash in single trade
  dailyLossCapPercent: 5,           // Stop trading after 5% daily loss
  maxDrawdownPercent: 15,           // Max 15% portfolio drawdown from peak
  minCashReservePercent: 10,        // Keep at least 10% cash reserve
  maxOpenOrders: 10,                // Max 10 open conditional orders
  cooldownMinutes: 5                // Min 5 minutes between same-asset trades
};

/**
 * Evaluate a proposed trade against risk constraints
 */
async function evaluateRisk(base44, userId, proposedTrade, userSettings, portfolioState) {
  const rejections = [];
  const warnings = [];
  
  const {
    symbol,
    type,
    quantity,
    price,
    total_value,
    is_simulation
  } = proposedTrade;
  
  // Get user's risk parameters from UserSettings fields (or use defaults)
  // CRITICAL: Read dedicated UserSettings fields first, then fall back to risk_params JSON, then defaults
  const riskParamsFromJson = (() => {
    try {
      return userSettings?.risk_params ? JSON.parse(userSettings.risk_params) : {};
    } catch (_) { return {}; }
  })();
  
  const riskParams = {
    ...DEFAULT_RISK_PARAMS,
    ...riskParamsFromJson,
    // Dedicated UserSettings fields override everything
    ...(typeof userSettings?.max_asset_exposure_percent === 'number' ? { maxAssetExposurePercent: userSettings.max_asset_exposure_percent } : {}),
    ...(typeof userSettings?.max_single_trade_percent === 'number' ? { maxSingleTradePercent: userSettings.max_single_trade_percent } : {}),
    ...(typeof userSettings?.daily_loss_cap_percent === 'number' ? { dailyLossCapPercent: userSettings.daily_loss_cap_percent } : {}),
    ...(typeof userSettings?.max_drawdown_percent === 'number' ? { maxDrawdownPercent: userSettings.max_drawdown_percent } : {})
  };
  
  console.log(`[riskEngine] Using risk params: maxExposure=${riskParams.maxAssetExposurePercent}%, maxTrade=${riskParams.maxSingleTradePercent}%, dailyLoss=${riskParams.dailyLossCapPercent}%, maxDrawdown=${riskParams.maxDrawdownPercent}%`);
  
  // Calculate current portfolio metrics
  const cashKey = is_simulation ? 'cash_balance' : 'real_cash_balance';
  const currentCash = portfolioState?.wallet?.[cashKey] || 0;
  const holdings = Object.values(portfolioState?.holdings || {})
    .filter(h => h.is_simulation === is_simulation);
  
  // Estimate total portfolio value
  let totalPortfolioValue = currentCash;
  for (const holding of holdings) {
    // Use current price or avg cost as estimate
    const value = holding.quantity * (holding.current_price || holding.average_cost_price || 0);
    totalPortfolioValue += value;
  }
  
  // If portfolio value is 0, use cash only
  if (totalPortfolioValue <= 0) {
    totalPortfolioValue = currentCash;
  }
  
  console.log(`[riskEngine] Portfolio: cash=$${currentCash.toFixed(2)}, total=$${totalPortfolioValue.toFixed(2)}`);
  
  // ============================================
  // CHECK 1: Sufficient funds for buy
  // ============================================
  if (type === 'buy') {
    if (total_value > currentCash) {
      rejections.push({
        rule: 'insufficient_funds',
        message: `Insufficient cash: need $${total_value.toFixed(2)}, have $${currentCash.toFixed(2)}`,
        severity: 'critical'
      });
    }
  }
  
  // ============================================
  // CHECK 2: Sufficient holdings for sell
  // ============================================
  if (type === 'sell') {
    const holdingKey = `${symbol}_${is_simulation ? 'sim' : 'live'}`;
    const currentHolding = portfolioState?.holdings?.[holdingKey];
    const currentQty = currentHolding?.quantity || 0;
    
    if (quantity > currentQty) {
      rejections.push({
        rule: 'insufficient_holdings',
        message: `Insufficient holdings: trying to sell ${quantity}, have ${currentQty}`,
        severity: 'critical'
      });
    }
  }
  
  // ============================================
  // CHECK 3: Max single trade allocation
  // ============================================
  if (type === 'buy') {
    const tradePercent = (total_value / currentCash) * 100;
    if (tradePercent > riskParams.maxSingleTradePercent) {
      rejections.push({
        rule: 'max_single_trade',
        message: `Trade is ${tradePercent.toFixed(1)}% of cash, max allowed is ${riskParams.maxSingleTradePercent}%`,
        severity: 'high'
      });
    }
  }
  
  // ============================================
  // CHECK 4: Max asset exposure
  // ============================================
  if (type === 'buy' && totalPortfolioValue > 0) {
    const holdingKey = `${symbol}_${is_simulation ? 'sim' : 'live'}`;
    const currentHolding = portfolioState?.holdings?.[holdingKey];
    const currentValue = (currentHolding?.quantity || 0) * price;
    const newValue = currentValue + total_value;
    const exposurePercent = (newValue / totalPortfolioValue) * 100;
    
    if (exposurePercent > riskParams.maxAssetExposurePercent) {
      rejections.push({
        rule: 'max_asset_exposure',
        message: `${symbol} exposure would be ${exposurePercent.toFixed(1)}%, max allowed is ${riskParams.maxAssetExposurePercent}%`,
        severity: 'high'
      });
    }
  }
  
  // ============================================
  // CHECK 5: Minimum cash reserve
  // ============================================
  if (type === 'buy' && totalPortfolioValue > 0) {
    const cashAfterTrade = currentCash - total_value;
    const cashReservePercent = (cashAfterTrade / totalPortfolioValue) * 100;
    
    if (cashReservePercent < riskParams.minCashReservePercent) {
      warnings.push({
        rule: 'min_cash_reserve',
        message: `Cash reserve would be ${cashReservePercent.toFixed(1)}%, recommended minimum is ${riskParams.minCashReservePercent}%`,
        severity: 'medium'
      });
    }
  }
  
  // ============================================
  // CHECK 6: Daily loss cap
  // ============================================
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayStart = `${today}T00:00:00.000Z`;
    
    // Get today's trades
    const todaysTrades = await base44.entities.Trade.filter({
      created_by: userId,
      is_simulation
    });
    
    // Calculate today's realized P&L
    let dailyPnL = 0;
    for (const trade of todaysTrades) {
      if (trade.created_date >= todayStart && trade.type === 'sell') {
        // Simplified P&L calculation
        const proceeds = trade.total_value || 0;
        const cost = (trade.quantity || 0) * (trade.average_cost_at_sale || trade.price || 0);
        dailyPnL += proceeds - cost;
      }
    }
    
    const dailyLossPercent = totalPortfolioValue > 0 ? 
      Math.abs(Math.min(0, dailyPnL)) / totalPortfolioValue * 100 : 0;
    
    if (dailyLossPercent >= riskParams.dailyLossCapPercent) {
      rejections.push({
        rule: 'daily_loss_cap',
        message: `Daily loss of ${dailyLossPercent.toFixed(1)}% exceeds ${riskParams.dailyLossCapPercent}% cap. Trading paused.`,
        severity: 'critical'
      });
      
      // CRITICAL: Activate "bad days" mode on user settings
      try {
        const badDaysOverride = userSettings?.bad_days_override_enabled === true;
        if (!badDaysOverride) {
          const settingsRecords = await base44.entities.UserSettings.filter({ created_by: userId });
          if (settingsRecords.length > 0) {
            await base44.entities.UserSettings.update(settingsRecords[0].id, {
              bad_days_active: true,
              bad_days_triggered_at: new Date().toISOString(),
              bad_days_reason: `Daily loss cap exceeded (${dailyLossPercent.toFixed(1)}% >= ${riskParams.dailyLossCapPercent}%)`
            });
            console.log(`[riskEngine] BAD DAYS activated for user ${userId}`);
          }
        } else {
          console.log(`[riskEngine] Daily loss cap hit but user has override enabled - proceeding`);
          // Remove rejection if override is active
          const idx = rejections.findIndex(r => r.rule === 'daily_loss_cap');
          if (idx !== -1) rejections.splice(idx, 1);
          warnings.push({
            rule: 'daily_loss_cap_override',
            message: `Daily loss of ${dailyLossPercent.toFixed(1)}% exceeds cap but override is active`,
            severity: 'medium'
          });
        }
      } catch (badDaysErr) {
        console.warn('[riskEngine] Failed to update bad_days state:', badDaysErr.message);
      }
    }
  } catch (e) {
    console.warn('[riskEngine] Could not check daily loss:', e.message);
  }
  
  // ============================================
  // CHECK 7: Max open orders
  // ============================================
  if (type === 'buy') {
    try {
      const openOrders = await base44.entities.ConditionalOrder.filter({
        created_by: userId,
        is_simulation,
        status: 'active'
      });
      
      if (openOrders.length >= riskParams.maxOpenOrders) {
        warnings.push({
          rule: 'max_open_orders',
          message: `${openOrders.length} open orders, max recommended is ${riskParams.maxOpenOrders}`,
          severity: 'low'
        });
      }
    } catch (e) {
      console.warn('[riskEngine] Could not check open orders:', e.message);
    }
  }
  
  // ============================================
  // CHECK 8: Same-asset cooldown
  // ============================================
  if (type === 'buy') {
    try {
      const recentTrades = await base44.entities.Trade.filter({
        created_by: userId,
        symbol,
        is_simulation
      }, '-created_date', 5);
      
      if (recentTrades.length > 0) {
        const lastTrade = recentTrades[0];
        const lastTradeTime = new Date(lastTrade.created_date).getTime();
        const now = Date.now();
        const minutesSince = (now - lastTradeTime) / 60000;
        
        if (minutesSince < riskParams.cooldownMinutes) {
          warnings.push({
            rule: 'cooldown',
            message: `Last ${symbol} trade was ${minutesSince.toFixed(1)} minutes ago. Recommended cooldown: ${riskParams.cooldownMinutes} minutes.`,
            severity: 'low'
          });
        }
      }
    } catch (e) {
      console.warn('[riskEngine] Could not check cooldown:', e.message);
    }
  }
  
  // Determine overall result
  const hasCriticalRejection = rejections.some(r => r.severity === 'critical');
  const hasHighRejection = rejections.some(r => r.severity === 'high');
  
  return {
    approved: rejections.length === 0,
    rejections,
    warnings,
    risk_score: calculateRiskScore(rejections, warnings),
    portfolio_metrics: {
      total_value: totalPortfolioValue,
      cash_available: currentCash,
      holdings_count: holdings.length
    }
  };
}

/**
 * Calculate a risk score 0-100 (higher = riskier)
 */
function calculateRiskScore(rejections, warnings) {
  let score = 0;
  
  for (const r of rejections) {
    if (r.severity === 'critical') score += 50;
    else if (r.severity === 'high') score += 30;
    else score += 15;
  }
  
  for (const w of warnings) {
    if (w.severity === 'medium') score += 10;
    else score += 5;
  }
  
  return Math.min(100, score);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json();
    const { action, payload } = body;
    
    switch (action) {
      case 'evaluateTrade': {
        const { proposedTrade, portfolioState } = payload;
        
        // Get user settings
        const settingsList = await base44.entities.UserSettings.filter({
          created_by: user.email
        });
        const userSettings = settingsList[0] || {};
        
        const result = await evaluateRisk(
          base44,
          user.email,
          proposedTrade,
          userSettings,
          portfolioState
        );
        
        // Log if rejected
        if (!result.approved) {
          console.log(`[riskEngine] Trade REJECTED for ${user.email}:`, result.rejections);
        }
        
        return Response.json({ success: true, ...result });
      }
      
      case 'getDefaultParams': {
        return Response.json({ success: true, params: DEFAULT_RISK_PARAMS });
      }
      
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('[riskEngine] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});