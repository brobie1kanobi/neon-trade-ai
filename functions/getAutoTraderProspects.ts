import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user settings - ensure we have defaults if no settings exist
    console.log('[Prospects] User email:', user.email);
    
    // Fetch all UserSettings for this user and pick the most recent
    const allSettingsRecords = await base44.asServiceRole.entities.UserSettings.filter({ 
      created_by: user.email 
    });
    
    console.log('[Prospects] Found', allSettingsRecords?.length || 0, 'settings records');
    
    // Sort by updated_date descending to get most recent
    let rawRecord = null;
    if (allSettingsRecords && allSettingsRecords.length > 0) {
      allSettingsRecords.sort((a, b) => {
        const dateA = new Date(a.updated_date || a.created_date || 0);
        const dateB = new Date(b.updated_date || b.created_date || 0);
        return dateB - dateA;
      });
      rawRecord = allSettingsRecords[0];
    }
    
    console.log('[Prospects] Using record id:', rawRecord?.id || 'none');
    console.log('[Prospects] Record keys:', rawRecord ? Object.keys(rawRecord) : 'none');
    
    // Extract settings values directly from the record
    const gain = rawRecord?.gain_margin;
    const loss = rawRecord?.loss_margin;
    console.log('[Prospects] Direct access - gain:', gain, 'loss:', loss);
    
    // Build settings with explicit user values taking priority
    const settings = {
      sim_trading_mode: rawRecord?.sim_trading_mode !== undefined ? rawRecord.sim_trading_mode : true,
      auto_trading_enabled: rawRecord?.auto_trading_enabled !== undefined ? rawRecord.auto_trading_enabled : false,
      gain_margin: gain !== undefined && gain !== null ? gain : 10,
      loss_margin: loss !== undefined && loss !== null ? loss : 5,
      trailing_takeprofit_enabled: rawRecord?.trailing_takeprofit_enabled !== undefined ? rawRecord.trailing_takeprofit_enabled : true,
      trailing_takeprofit_margin: rawRecord?.trailing_takeprofit_margin !== undefined ? rawRecord.trailing_takeprofit_margin : 3,
    };
    
    console.log('[Prospects] Final settings - gain:', settings.gain_margin, '% loss:', settings.loss_margin, '%');

    // ALWAYS show prospects - even if auto-trading is disabled

    const isSimMode = settings?.sim_trading_mode === true;

    // Get wallet balance - LIVE mode uses Kraken WebSocket data
    let cashAvailable = 0;
    if (!isSimMode) {
      // LIVE MODE: Fetch actual Kraken balance
      try {
        const krakenResponse = await base44.asServiceRole.functions.invoke('getKrakenBalance', {});
        const krakenData = krakenResponse?.data || krakenResponse;
        if (krakenData?.success && krakenData?.connected) {
          cashAvailable = krakenData.usd_balance || 0;
        }
      } catch (e) {
        console.error('Kraken balance fetch failed:', e);
      }
    } else {
      // SIM MODE: Use wallet DB
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ 
        created_by: user.email 
      }, "-updated_date", 1);
      const wallet = wallets[0];
      cashAvailable = wallet?.cash_balance || 0;
    }

    // Get auto-buy preferences - if none exist, use default top crypto
    let prefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({ 
      created_by: user.email, 
      is_simulation: isSimMode,
      enabled: true 
    }, "-created_date", 30);

    // If no preferences, create default watchlist to analyze
    if (prefs.length === 0) {
      const defaultCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'];
      prefs = defaultCrypto.map(symbol => ({
        symbol,
        asset_type: 'crypto',
        percentage: 20,
        enabled: true
      }));
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

    console.log('[Prospects] Fetching market data for:', cryptoSymbols, stockSymbols);
    
    const marketDataResponse = await base44.asServiceRole.functions.invoke('getMarketData', {
      action: 'getWatchlistData',
      payload: { cryptoSymbols, stockSymbols }
    });

    const quotes = Array.isArray(marketDataResponse?.data) ? marketDataResponse.data : [];
    console.log('[Prospects] Got', quotes.length, 'price quotes');

    // ALWAYS get AI analysis with full market intelligence
    let analysisMap = {};
    let marketIntelligence = null;
    try {
      console.log('[Prospects] Calling Market Intelligence analyzer for:', [...cryptoSymbols, ...stockSymbols]);
      const analysisResponse = await Promise.race([
        base44.asServiceRole.functions.invoke('analyzeSmallGains', {
          symbols: [...cryptoSymbols, ...stockSymbols],
          includeMarketIntelligence: true
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI analysis timeout')), 20000))
      ]);
      const analysisData = analysisResponse?.data || analysisResponse;
      
      console.log('[Prospects] Market Intelligence response received');
      
      // Store market intelligence for frontend display
      marketIntelligence = analysisData?.market_intelligence || null;
      
      if (analysisData?.success && Array.isArray(analysisData?.recommendations)) {
        analysisMap = analysisData.recommendations.reduce((acc, r) => {
          const confidence = (r.confidence_score || 60) / 100;
          acc[(r.symbol || "").toUpperCase()] = { 
            confidence: Math.max(0, Math.min(1, confidence)),
            action: (r.optimal_action || r.action || "buy").toLowerCase(),
            predictedGain: r.predicted_gain_percent || 10,
            reasoning: r.reasoning || 'Analyzing market conditions...',
            // Enhanced fields from market intelligence
            technicalPattern: r.technical_pattern || null,
            patternReliability: r.pattern_reliability || 'moderate',
            timingWindow: r.timing_window || 'short_term',
            entryZone: r.entry_zone_low && r.entry_zone_high ? { low: r.entry_zone_low, high: r.entry_zone_high } : null,
            stopLossPct: r.stop_loss_pct || 5,
            takeProfitPct: r.take_profit_pct || 10,
            sentimentScore: r.sentiment_score || 50,
            correlationGroup: r.correlation_group || null
          };
          return acc;
        }, {});
        console.log('[Prospects] Generated', Object.keys(analysisMap).length, 'AI recommendations');
      } else {
        console.log('[Prospects] No AI recommendations, using defaults');
        [...cryptoSymbols, ...stockSymbols].forEach(sym => {
          analysisMap[sym] = {
            confidence: 0.6,
            action: 'buy',
            predictedGain: 8,
            reasoning: 'AI is analyzing market trends and technical indicators for this asset...',
            technicalPattern: null,
            timingWindow: 'short_term',
            stopLossPct: 5,
            takeProfitPct: 10
          };
        });
      }
    } catch (aiError) {
      console.error('[Prospects] AI analysis error:', aiError);
      [...cryptoSymbols, ...stockSymbols].forEach(sym => {
        analysisMap[sym] = {
          confidence: 0.6,
          action: 'buy',
          predictedGain: 8,
          reasoning: 'AI analyzer temporarily unavailable - using baseline analysis',
          technicalPattern: null,
          timingWindow: 'short_term',
          stopLossPct: 5,
          takeProfitPct: 10
        };
      });
    }

    // Build prospect list - always show what AI is thinking
    const prospects = [];
    const totalPortfolioValue = cashAvailable + holdings.reduce((sum, h) => sum + (h.quantity || 0) * (h.average_cost_price || 0), 0);
    const isCashBuildUpMode = totalPortfolioValue < 500;
    let remainingCash = Math.max(1, isCashBuildUpMode ? cashAvailable * 0.4 : cashAvailable * 0.85);

    for (const pref of prefs) {
      const symbol = (pref.symbol || "").toUpperCase();
      const quote = quotes.find(q => q.symbol === symbol);
      const price = quote?.price || 0;
      
      if (!price || price <= 0) {
        console.log('[Prospects] No price for', symbol);
        continue;
      }
      
      console.log('[Prospects] Processing', symbol, 'at $', price);

      const rec = analysisMap[symbol] || { 
        confidence: 0.6, 
        action: "buy",
        reasoning: "Awaiting AI analysis" 
      };

      if (rec.action !== "buy") continue;

      const basePct = Math.max(15, Number(pref.percentage) || 15) / 100;
      const multiplier = Math.min(2.0, 0.6 + rec.confidence * 1.4);
      const fraction = Math.max(0.08, Math.min(0.45, basePct * multiplier));

      // CRITICAL: Calculate spend as fraction of REMAINING cash, not total
      let spend = remainingCash * fraction;

      // Cap spend to never exceed remaining cash
      spend = Math.min(spend, remainingCash * 0.9); // Max 90% of remaining

      // Minimum order size handling
      const minSpendTarget = Math.max(2, Math.min(10, price * 0.05));
      if (spend < minSpendTarget && remainingCash >= minSpendTarget) {
        spend = Math.min(remainingCash * 0.5, minSpendTarget); // Don't exceed 50% for min orders
      }

      const quantity = spend / price;
      const holding = holdings.find(h => (h.symbol || "").toUpperCase() === symbol);
      const scaleInFactor = holding ? 0.6 : 1.0;
      const finalQty = quantity * scaleInFactor;
      let total = finalQty * price;

      // Final safety cap - never exceed available cash
      if (total > cashAvailable) {
        console.log('[Prospects] Capping order from $', total, 'to $', cashAvailable * 0.4);
        total = cashAvailable * 0.4; // Max 40% of total cash per order
      }

      let blockReason = null;
      let wouldExecute = false;
      
      // Recalculate quantity based on capped total
      const cappedQuantity = total / price;
      
      if (cashAvailable < 1) {
        blockReason = `No cash available ($${cashAvailable.toFixed(2)})`;
      } else if (total < 1) {
        blockReason = "Order value too small (minimum $1)";
      } else if (total > remainingCash && remainingCash > 1) {
        blockReason = `Not enough allocation ($${remainingCash.toFixed(2)} remaining)`;
      } else if (total > cashAvailable) {
        blockReason = `Exceeds wallet balance ($${cashAvailable.toFixed(2)})`;
      } else {
        wouldExecute = true;
      }

      // Use user's gain_margin preference for target gain, AI can suggest but user settings take priority
      const userTargetGain = settings.gain_margin;
      
      prospects.push({
        symbol,
        asset_type: pref.asset_type,
        current_price: price,
        quantity: finalQty,
        total_value: total,
        confidence_score: Math.round(rec.confidence * 100),
        ai_reasoning: rec.reasoning,
        predicted_gain: userTargetGain, // Use user's preference
        is_blocked: !!blockReason,
        block_reason: blockReason,
        would_execute_now: wouldExecute,
        has_existing_position: !!holding,
        existing_quantity: holding?.quantity || 0,
        priority: rec.confidence * (holding ? 0.6 : 1.0),
        market_trend: quote?.changePct || 0,
        allocation_percent: Math.round((total / Math.max(1, cashAvailable)) * 100),
        // Enhanced market intelligence fields
        technical_pattern: rec.technicalPattern,
        pattern_reliability: rec.patternReliability,
        timing_window: rec.timingWindow,
        entry_zone: rec.entryZone,
        stop_loss_pct: settings.loss_margin,
        take_profit_pct: settings.gain_margin,
        ai_suggested_gain: rec.predictedGain || rec.takeProfitPct || 10,
        user_loss_margin: settings.loss_margin,
        user_gain_margin: settings.gain_margin,
        sentiment_score: rec.sentimentScore,
        correlation_group: rec.correlationGroup,
        optimal_action: rec.action
      });

      if (wouldExecute && remainingCash > 1) {
        remainingCash -= total;
      }
    }

    // Sort by priority (confidence * position factor)
    prospects.sort((a, b) => b.priority - a.priority);

    // Add user settings to response so frontend can use them
    const userGainMargin = settings.gain_margin;
    const userLossMargin = settings.loss_margin;
    
    console.log('[Prospects] User margins - gain:', userGainMargin, '% loss:', userLossMargin, '%');
    console.log('[Prospects] Returning', prospects.length, 'prospects');

    return Response.json({
      success: true,
      prospects,
      cash_available: cashAvailable,
      is_sim_mode: isSimMode,
      auto_trading_enabled: settings?.auto_trading_enabled || false,
      total_analyzed: prefs.length,
      market_intelligence: marketIntelligence,
      user_settings: {
        gain_margin: userGainMargin,
        loss_margin: userLossMargin
      }
    });

  } catch (error) {
    console.error('Prospects error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});