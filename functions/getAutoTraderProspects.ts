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
    
    // Fetch UserSettings using user-scoped context (not service role) to respect RLS
    const allSettingsRecords = await base44.entities.UserSettings.filter({ 
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
    console.log('[Prospects] Full raw record:', JSON.stringify(rawRecord));
    
    // Extract settings values directly from the record - check for both number 0 and actual values
    const gain = rawRecord?.gain_margin;
    const loss = rawRecord?.loss_margin;
    console.log('[Prospects] Direct access - gain:', gain, 'type:', typeof gain, 'loss:', loss, 'type:', typeof loss);
    
    // Build settings with explicit user values taking priority
    // Use typeof check to allow 0 as valid value
    const settings = {
      sim_trading_mode: rawRecord?.sim_trading_mode !== undefined ? rawRecord.sim_trading_mode : true,
      auto_trading_enabled: rawRecord?.auto_trading_enabled !== undefined ? rawRecord.auto_trading_enabled : false,
      gain_margin: typeof gain === 'number' ? gain : 10,
      loss_margin: typeof loss === 'number' ? loss : 5,
      trailing_takeprofit_enabled: rawRecord?.trailing_takeprofit_enabled !== undefined ? rawRecord.trailing_takeprofit_enabled : true,
      trailing_takeprofit_margin: rawRecord?.trailing_takeprofit_margin !== undefined ? rawRecord.trailing_takeprofit_margin : 3,
    };
    
    console.log('[Prospects] Final settings - gain:', settings.gain_margin, '% loss:', settings.loss_margin, '%');

    // ALWAYS show prospects - even if auto-trading is disabled

    // AutoTraderProspects is ALWAYS for LIVE trading - never use sim wallet
    // This page shows what would be traded on Kraken, so always use Kraken balance
    let cashAvailable = 0;
    try {
      const krakenResponse = await base44.asServiceRole.functions.invoke('getKrakenBalance', {});
      const krakenData = krakenResponse?.data || krakenResponse;
      if (krakenData?.success && krakenData?.connected) {
        cashAvailable = krakenData.usd_balance || 0;
        console.log('[Prospects] Using Kraken USD balance:', cashAvailable);
      } else {
        console.log('[Prospects] Kraken not connected or no balance');
      }
    } catch (e) {
      console.error('[Prospects] Kraken balance fetch failed:', e);
    }
    
    // For holdings/preferences, use LIVE mode (is_simulation: false)
    const isSimMode = false; // Force LIVE mode for prospects

    // Get auto-buy preferences - ONLY use user's selected assets from Portfolio page
    // For LIVE prospects, we need is_simulation: false preferences
    console.log('[Prospects] Looking for preferences with is_simulation:', isSimMode);
    
    // Fetch user's preferences using service role
    // Use user-scoped client to get user's own preferences
    let allPrefs = await base44.entities.AutoBuyPreference.filter({}, "-created_date", 50);

    console.log('[Prospects] Found', allPrefs.length, 'total AutoBuyPreferences for user');
    
    // Debug: log all preferences
    allPrefs.forEach(p => {
      console.log('[Prospects] All pref:', p.symbol, 'is_simulation:', p.is_simulation, typeof p.is_simulation, 'enabled:', p.enabled);
    });
    
    // Filter to matching simulation mode and enabled
    // isSimMode is false for LIVE prospects, so we want is_simulation: false
    let prefs = allPrefs.filter(p => {
      // Handle boolean or string values
      const pIsSimulation = p.is_simulation === true;
      const pEnabled = p.enabled !== false; // Default to enabled if not explicitly false
      // For LIVE mode (isSimMode=false), we want preferences with is_simulation=false
      const matchesSim = isSimMode === pIsSimulation;
      return matchesSim && pEnabled;
    });

    console.log('[Prospects] Filtered to', prefs.length, 'preferences for is_simulation:', isSimMode);
    prefs.forEach(p => {
      console.log('[Prospects] Using pref:', p.symbol, 'percentage:', p.percentage, '%');
    });

    // If no preferences, return empty - don't use defaults
    // User must configure assets in Portfolio page first
    if (prefs.length === 0) {
      console.log('[Prospects] No preferences configured - user needs to set up assets in Portfolio');
      return Response.json({
        success: true,
        prospects: [],
        cash_available: cashAvailable,
        is_sim_mode: isSimMode,
        auto_trading_enabled: settings?.auto_trading_enabled || false,
        total_analyzed: 0,
        market_intelligence: null,
        user_settings: {
          gain_margin: settings.gain_margin,
          loss_margin: settings.loss_margin
        },
        message: "No assets configured. Please add assets to your watchlist in Portfolio settings."
      });
    }
    
    // Log each preference's allocation percentage
    prefs.forEach(p => {
      console.log('[Prospects] Asset:', p.symbol, 'Allocation:', p.percentage, '%');
    });

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
          // FIXED: confidence_score from AI is already 0-100, NOT 0-1
          // So we store it as-is for integer comparison (e.g., 70 means 70%)
          const rawConfidence = r.confidence_score || 60;
          // If AI returns decimal (0.7), convert to percentage (70)
          const confidence = rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence;
          
          console.log(`[Prospects] AI for ${r.symbol}: raw=${rawConfidence}, normalized=${confidence}%`);
          
          acc[(r.symbol || "").toUpperCase()] = { 
            confidence: Math.max(0, Math.min(100, confidence)), // Store as 0-100 integer
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
    const numAssets = prefs.length || 1;
    
    // HARD LIMIT: Each order can be at most (cashAvailable / numAssets) to spread across assets
    // Also cap at 25% of total cash max per single order
    const maxPerOrder = Math.min(cashAvailable / numAssets, cashAvailable * 0.25);
    
    console.log('[Prospects] Cash available:', cashAvailable, 'Max per order:', maxPerOrder);

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

      const holding = holdings.find(h => (h.symbol || "").toUpperCase() === symbol);
      
      // Use the EXACT percentage from user's AutoBuyPreference - this is what they set in Portfolio
      const userAllocationPct = Number(pref.percentage) || 10;
      const userPct = userAllocationPct / 100;
      
      console.log('[Prospects]', symbol, '- User set allocation:', userAllocationPct, '%');
      
      // Calculate order value based on user's exact preference
      let total = cashAvailable * userPct;
      
      // Cap to maxPerOrder safety limit, but preserve user's intended percentage display
      total = Math.min(total, maxPerOrder);
      
      // Scale down if already holding (reduce risk of over-concentration)
      if (holding) {
        total = total * 0.6;
      }
      
      // Minimum $5 order
      if (total < 5 && cashAvailable >= 5) {
        total = Math.min(5, maxPerOrder);
      }
      
      // FINAL HARD CAP: Never exceed cash
      total = Math.min(total, cashAvailable);
      
      const cappedQuantity = total / price;
      
      // Calculate actual allocation after all caps
      const actualAllocationPct = cashAvailable > 0 ? Math.round((total / cashAvailable) * 100) : 0;

      let blockReason = null;
      let wouldExecute = false;
      
      if (cashAvailable < 1) {
        blockReason = `No cash available ($${cashAvailable.toFixed(2)})`;
      } else if (total < 1) {
        blockReason = "Order value too small (minimum $1)";
      } else if (total > cashAvailable) {
        blockReason = `Exceeds wallet balance ($${cashAvailable.toFixed(2)})`;
      } else {
        wouldExecute = true;
      }

      // Use user's gain_margin preference for target gain, AI can suggest but user settings take priority
      const userTargetGain = settings.gain_margin;
      
      // FIXED: confidence is already 0-100, no need to multiply
      const confidenceScore = Math.round(rec.confidence);
      console.log(`[Prospects] ${symbol} final confidence_score: ${confidenceScore}%`);
      
      prospects.push({
        symbol,
        asset_type: pref.asset_type,
        current_price: price,
        quantity: cappedQuantity,
        total_value: total,
        confidence_score: confidenceScore,
        ai_reasoning: rec.reasoning,
        predicted_gain: userTargetGain, // Use user's preference
        is_blocked: !!blockReason,
        block_reason: blockReason,
        would_execute_now: wouldExecute,
        has_existing_position: !!holding,
        existing_quantity: holding?.quantity || 0,
        priority: rec.confidence * (holding ? 0.6 : 1.0),
        market_trend: quote?.changePct || 0,
        allocation_percent: actualAllocationPct,
        user_allocation_pct: userAllocationPct, // The user's configured percentage from Portfolio
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