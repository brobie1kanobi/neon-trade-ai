import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user settings
    const settingsRecords = await base44.asServiceRole.entities.UserSettings.filter({ 
      created_by: user.email 
    }, "-updated_date", 1);
    const settings = settingsRecords[0];

    if (!settings?.auto_trading_enabled) {
      return Response.json({ 
        success: true, 
        prospects: [],
        message: "Auto-trading is disabled"
      });
    }

    const isSimMode = settings?.sim_trading_mode !== false;

    // Get wallet balance
    const wallets = await base44.asServiceRole.entities.Wallet.filter({ 
      created_by: user.email 
    }, "-updated_date", 1);
    const wallet = wallets[0];
    const cashAvailable = isSimMode 
      ? (wallet?.cash_balance || 0) 
      : (wallet?.real_cash_balance || 0);

    // Get auto-buy preferences
    const prefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({ 
      created_by: user.email, 
      is_simulation: isSimMode,
      enabled: true 
    }, "-created_date", 30);

    if (prefs.length === 0) {
      return Response.json({ 
        success: true, 
        prospects: [],
        message: "No auto-buy preferences configured"
      });
    }

    // Get current holdings
    const holdings = await base44.asServiceRole.entities.Holding.filter({ 
      created_by: user.email,
      is_simulation: isSimMode
    });

    // Fetch market data
    const cryptoSymbols = prefs
      .filter(p => p.asset_type === "crypto")
      .map(p => String(p.symbol || "").toUpperCase().trim());
    const stockSymbols = prefs
      .filter(p => p.asset_type === "stock")
      .map(p => String(p.symbol || "").toUpperCase().trim());

    const marketDataResponse = await base44.asServiceRole.functions.invoke('getMarketData', {
      action: 'getWatchlistData',
      payload: { cryptoSymbols, stockSymbols }
    });

    const quotes = Array.isArray(marketDataResponse?.data) ? marketDataResponse.data : [];

    // Get AI analysis
    let analysisMap = {};
    try {
      const analysisResponse = await base44.asServiceRole.functions.invoke('analyzeSmallGains', {
        symbols: [...cryptoSymbols, ...stockSymbols]
      });
      const analysisData = analysisResponse?.data || analysisResponse;
      
      if (analysisData?.success && Array.isArray(analysisData?.recommendations)) {
        analysisMap = analysisData.recommendations.reduce((acc, r) => {
          const confidence = (r.confidence_score || 60) / 100;
          acc[(r.symbol || "").toUpperCase()] = { 
            confidence: Math.max(0, Math.min(1, confidence)),
            action: (r.action || "buy").toLowerCase(),
            predictedGain: r.predicted_gain_percent || 10,
            reasoning: r.reasoning || 'AI analysis pending'
          };
          return acc;
        }, {});
      }
    } catch (_e) {
      console.error('AI analysis error:', _e);
    }

    // Build prospect list
    const prospects = [];
    const totalPortfolioValue = cashAvailable + holdings.reduce((sum, h) => sum + (h.quantity || 0) * (h.average_cost_price || 0), 0);
    const isCashBuildUpMode = totalPortfolioValue < 500;
    let remainingCash = isCashBuildUpMode ? cashAvailable * 0.4 : cashAvailable * 0.85;

    for (const pref of prefs) {
      const symbol = (pref.symbol || "").toUpperCase();
      const quote = quotes.find(q => q.symbol === symbol);
      const price = quote?.price || 0;
      
      if (!price || price <= 0) continue;

      const rec = analysisMap[symbol] || { 
        confidence: 0.6, 
        action: "buy",
        reasoning: "Awaiting AI analysis" 
      };

      if (rec.action !== "buy") continue;

      const basePct = Math.max(15, Number(pref.percentage) || 15) / 100;
      const multiplier = Math.min(2.0, 0.6 + rec.confidence * 1.4);
      const fraction = Math.max(0.08, Math.min(0.45, basePct * multiplier));
      
      let spend = remainingCash * fraction;
      const minSpendTarget = Math.max(2, Math.min(10, price * 0.05));
      if (spend < minSpendTarget && remainingCash >= minSpendTarget) {
        spend = Math.min(remainingCash, minSpendTarget);
      }

      const quantity = spend / price;
      const holding = holdings.find(h => (h.symbol || "").toUpperCase() === symbol);
      const scaleInFactor = holding ? 0.6 : 1.0;
      const finalQty = quantity * scaleInFactor;
      const total = finalQty * price;

      let blockReason = null;
      if (total < 1) {
        blockReason = "Order value too small (minimum $1)";
      } else if (total > remainingCash) {
        blockReason = "Insufficient cash balance";
      } else if (total > cashAvailable) {
        blockReason = "Would exceed available cash";
      }

      prospects.push({
        symbol,
        asset_type: pref.asset_type,
        current_price: price,
        quantity: finalQty,
        total_value: total,
        confidence_score: Math.round(rec.confidence * 100),
        ai_reasoning: rec.reasoning,
        predicted_gain: rec.predictedGain,
        is_blocked: !!blockReason,
        block_reason: blockReason,
        has_existing_position: !!holding,
        existing_quantity: holding?.quantity || 0,
        priority: rec.confidence * (holding ? 0.6 : 1.0)
      });

      if (!blockReason) {
        remainingCash -= total;
      }
    }

    // Sort by priority (confidence * position factor)
    prospects.sort((a, b) => b.priority - a.priority);

    return Response.json({
      success: true,
      prospects,
      cash_available: cashAvailable,
      is_sim_mode: isSimMode,
      auto_trading_enabled: settings.auto_trading_enabled
    });

  } catch (error) {
    console.error('Prospects error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});