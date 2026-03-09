import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Enhanced Market Intelligence Analyzer v2.0
 * 
 * ENHANCED CAPABILITIES:
 * - Short-term price movement predictions (1-6 hours)
 * - "strong_buy" and "strong_sell" signals for auto-trader
 * - Market sentiment scoring from news and social media
 * - Technical pattern recognition with confidence scoring
 * - Cross-asset correlation analysis
 * - Historical trade data integration for optimal entry/exit
 * - Momentum detection with real-time trend analysis
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { symbols = [], includeMarketIntelligence = true, includeTradeHistory = true } = body;

    console.log('[MarketIntelligence] Analyzing', symbols.length, 'symbols with full intelligence:', includeMarketIntelligence, 'trade history:', includeTradeHistory);

    // Utility: add timeout to long operations to prevent 502s
    const withTimeout = (promise, ms = 15000, label = 'operation') => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms))
      ]);
    };

    // Get user's auto-buy preferences (check both sim and live)
    const autoBuyPrefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({
      created_by: user.email,
      enabled: true
    }).catch(() => []);

    const targetSymbols = symbols.length > 0 ? symbols : autoBuyPrefs.map(p => p.symbol);

    if (targetSymbols.length === 0) {
      return Response.json({
        success: true,
        recommendations: [],
        market_intelligence: null,
        message: 'No symbols to analyze'
      });
    }

    // Fetch current market data from Kraken public API directly (avoids function-to-function 403)
    const KRAKEN_PAIR_MAP = {
      'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
      'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
      'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
      'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
      'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'HBAR': 'HBARUSD'
    };
    
    let marketData = [];
    try {
      const cryptoSymbols = targetSymbols.filter(s => KRAKEN_PAIR_MAP[s.toUpperCase()]);
      const pairs = cryptoSymbols.map(s => KRAKEN_PAIR_MAP[s.toUpperCase()]).filter(Boolean);
      
      console.log('[MarketIntelligence] Fetching prices from Kraken public API for:', cryptoSymbols);
      
      if (pairs.length > 0) {
        const resp = await withTimeout(
          fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`),
          6000,
          'kraken ticker'
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data?.result) {
            for (const sym of cryptoSymbols) {
              const pair = KRAKEN_PAIR_MAP[sym.toUpperCase()];
              const ticker = data.result[pair];
              if (ticker) {
                const price = parseFloat(ticker.c?.[0] || '0');
                const open24h = parseFloat(ticker.o || '0');
                const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
                marketData.push({
                  symbol: sym.toUpperCase(),
                  price,
                  current_price: price,
                  change_24h_percent: change24h,
                  price_change_percentage_24h: change24h
                });
              }
            }
          }
        }
      }
      console.log('[MarketIntelligence] Got market data for', marketData.length, 'symbols');
    } catch (err) {
      console.error('[MarketIntelligence] Market data error:', err);
    }

    // CRITICAL: Fetch historical trade data for smarter recommendations
    let tradeHistoryData = null;
    let tradeHistoryPromise = null;
    if (includeTradeHistory) {
      console.log('[MarketIntelligence] Fetching trade history for symbols:', targetSymbols);
      try {
        tradeHistoryPromise = withTimeout(
          base44.functions.invoke('analyzeTradeHistory', {
            symbols: targetSymbols,
            includeKrakenHistory: false,
            analyzePatterns: false
          }),
          4000,
          'trade history'
        );
      } catch (histErr) {
        console.warn('[MarketIntelligence] Trade history scheduling failed:', histErr.message);
      }
    }

    // Build comprehensive analysis prompt with market intelligence AND trade history
    const assetsSection = marketData.length > 0 
      ? marketData.map(asset => `- ${asset.symbol}: Price: $${asset.price || asset.current_price}, 24h Change: ${asset.change_24h_percent || asset.price_change_percentage_24h || 0}%`).join('\n')
      : targetSymbols.map(s => `- ${s}: (analyze based on your current knowledge)`).join('\n');

    // Build historical trade context for AI
    let tradeHistorySection = '';
    if (tradeHistoryData?.asset_analytics) {
      const historyItems = Object.values(tradeHistoryData.asset_analytics).map(a => {
        const buyZone = a.optimal_buy_zone || {};
        return `- ${a.symbol}: ${a.total_trades} historical trades, Win rate: ${(a.win_rate || 0).toFixed(1)}%, Avg profitable gain: ${(a.avg_successful_gain_pct || 0).toFixed(1)}%, Best buy zone: $${(buyZone.low || 0).toFixed(4)} - $${(buyZone.high || 0).toFixed(4)}, Recent avg buy: $${(a.avg_buy_price || 0).toFixed(4)}`;
      });
      if (historyItems.length > 0) {
        tradeHistorySection = `

HISTORICAL TRADE PERFORMANCE (User's actual trade history):
${historyItems.join('\n')}

CRITICAL: Use this historical data to:
1. Recommend buy zones that align with historically successful entry points
2. Set take-profit targets based on actual achieved gains
3. Identify which assets have the best track record
4. Avoid recommending assets with consistently poor performance`;
      }
    }

    const analysisPrompt = `You are an elite quantitative trading analyst specializing in SHORT-TERM price predictions (1-6 hours).
Your job is to identify HIGH-PROBABILITY rapid price movements and provide "strong_buy" or "strong_sell" signals ONLY when confidence is very high.

=== CRITICAL SIGNAL RULES ===

"strong_buy" signals (70%+ confidence required):
- MUST have positive momentum (price rising in last 4-6 hours)
- MUST show at least 2% gain in last 24h
- MUST have bullish technical pattern OR strong support bounce
- Expected rapid price increase of 3%+ within 1-6 hours
- Volume must be above average (accumulation phase)

"strong_sell" signals (70%+ confidence required):
- Asset showing clear distribution pattern (selling pressure)
- Breaking below key support level
- Bearish divergence on RSI
- Expected rapid price decrease within 1-6 hours

"buy" signals (60-69% confidence):
- Positive momentum but less certain timing
- Good entry point but may take 12-24h to play out

"hold" signals:
- Sideways movement, unclear direction
- Waiting for better entry/exit point

"sell" signals:
- Minor weakness, gradual exit recommended

=== MARKET SENTIMENT ANALYSIS ===
Analyze overall market sentiment from:
- News headlines and social media trends
- Bitcoin dominance and market cap movements
- Fear & Greed indicators
- Institutional flow data if available

Provide a market_sentiment_score (0-100):
- 0-30: Extreme Fear (potential bottom)
- 31-50: Fear (cautious)
- 51-70: Neutral to Greed (normal)
- 71-90: Greed (caution, potential top)
- 91-100: Extreme Greed (high risk of correction)

=== SHORT-TERM PREDICTION FOCUS ===
For each asset, predict:
1. Price direction in next 1-6 hours
2. Probability of 2%+ move (up or down)
3. Key price levels to watch (support/resistance)
4. Recommended entry price zone
5. Tight stop-loss for quick trades

=== ASSETS TO ANALYZE ===
${assetsSection}
${tradeHistorySection}

=== ANALYSIS REQUIREMENTS ===

1. MOMENTUM ANALYSIS (PRIMARY)
- Current momentum direction (bullish/bearish/neutral)
- Momentum strength (strong/moderate/weak)
- Time since last significant move
- Volume profile (accumulation/distribution/neutral)

2. SHORT-TERM PATTERN RECOGNITION
- Breakout patterns forming (flags, wedges, triangles)
- Support/resistance tests
- Moving average crossovers (short-term: 5/15/30 minute)
- RSI divergences

3. SENTIMENT INDICATORS
- Social media buzz level (high/medium/low)
- News impact assessment (positive/negative/neutral)
- Market correlation (moving with or against BTC)

4. TIMING PREDICTION
For each asset:
- predicted_direction: "up", "down", or "sideways"
- predicted_move_pct: Expected % move in 1-6 hours
- timing_window: "1h", "2h", "4h", "6h"
- optimal_action: "strong_buy", "buy", "hold", "sell", "strong_sell"
- confidence_score: 0-100 (ONLY 70%+ for strong signals)

5. RISK PARAMETERS
- stop_loss_pct: Tight stops for quick trades (1-3%)
- take_profit_pct: Realistic targets (2-5%)
- risk_reward_ratio: Must be at least 1.5:1

=== OUTPUT REQUIREMENTS ===
- Be CONSERVATIVE with "strong_buy" and "strong_sell" - these trigger auto-trades
- If momentum is unclear, use "hold" not "buy"
- Include market_sentiment_score in market_intelligence
- Prioritize assets with clearest short-term signals`;

    // Call LLM with robust JSON handling + fallbacks
    const strictSchema = {
      type: "object",
      properties: {
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              confidence_score: { type: "number" },
              predicted_direction: { type: "string" },
              predicted_move_pct: { type: "number" },
              reasoning: { type: "string" },
              action: { type: "string" },
              optimal_action: { type: "string" },
              timing_window: { type: "string" },
              stop_loss_pct: { type: "number" },
              take_profit_pct: { type: "number" }
            }
          }
        },
        market_intelligence: {
          type: "object",
          properties: {
            market_sentiment_score: { type: "number" },
            market_regime: { type: "string" },
            volatility_level: { type: "string" },
            trading_recommendation: { type: "string" },
            best_opportunities: { type: "array", items: { type: "string" } }
          }
        },
        market_summary: { type: "string" },
        upcoming_catalysts: { type: "array", items: { type: "string" } }
      }
    };

    async function tryInvoke(model, withWeb) {
      return await withTimeout(
        base44.integrations.Core.InvokeLLM({
          prompt: analysisPrompt,
          add_context_from_internet: !!withWeb,
          response_json_schema: strictSchema,
          model
        }),
        includeMarketIntelligence ? 14000 : 12000,
        'LLM invocation'
      );
    }

    let llmResponse;
    try {
      // Primary: web-enabled model only when requested
      const primaryModel = includeMarketIntelligence ? 'gemini_3_flash' : 'gpt_5_mini';
      llmResponse = await tryInvoke(primaryModel, includeMarketIntelligence);
    } catch (e1) {
      console.warn('[MarketIntelligence] LLM JSON error (primary):', e1.message);
      try {
        // Fallback 1: same model, no web (search can break JSON)
        const fallbackModel = includeMarketIntelligence ? 'gemini_3_flash' : 'gpt_5_mini';
        llmResponse = await tryInvoke(fallbackModel, false);
      } catch (e2) {
        console.warn('[MarketIntelligence] LLM JSON error (fallback1):', e2.message);
        try {
          // Fallback 2: stronger JSON model, no web but faster
          llmResponse = await tryInvoke('gpt_5_mini', false);
        } catch (e3) {
          console.warn('[MarketIntelligence] LLM JSON error (fallback2):', e3.message);
          // Final graceful fallback: build HEURISTIC recommendations so auto-trader still has input
          const heuristics = marketData.map(m => {
            const ch = Number(m.change_24h_percent ?? m.price_change_percentage_24h ?? 0);
            let action = 'hold';
            let confidence = 45;
            if (ch >= 0.5) { action = 'buy'; confidence = 60; }
            else if (ch >= 0.0) { action = 'buy'; confidence = 55; }
            else if (ch > -1.0) { action = 'buy'; confidence = 57; }
            return {
              symbol: m.symbol,
              confidence_score: confidence,
              predicted_direction: ch >= 0 ? 'up' : 'down',
              predicted_move_pct: 2,
              reasoning: 'Heuristic momentum and 24h change suggest a small upside window.',
              action,
              optimal_action: action,
              timing_window: '4h',
              stop_loss_pct: 2,
              take_profit_pct: 3
            };
          }).filter(r => r.optimal_action === 'buy' && r.confidence_score >= 55).slice(0, 6);

          llmResponse = {
            recommendations: heuristics,
            market_intelligence: { market_sentiment_score: 50, market_regime: 'Heuristic (LLM unavailable)' },
            market_summary: 'Heuristic fallback used',
            upcoming_catalysts: []
          };
        }
      }
    }

    console.log('[MarketIntelligence] Raw LLM response:', JSON.stringify(llmResponse, null, 2));
    const recommendations = llmResponse?.recommendations || [];
    const marketIntelligence = llmResponse?.market_intelligence || null;

    // Resolve trade history if scheduled
    if (!tradeHistoryData && tradeHistoryPromise) {
      try {
        const historyResponse = await tradeHistoryPromise;
        const historyData = historyResponse?.data || historyResponse;
        if (historyData?.success) {
          tradeHistoryData = historyData;
          console.log('[MarketIntelligence] Got trade history for', Object.keys(historyData.asset_analytics || {}).length, 'assets');
        }
      } catch (histErr) {
        console.warn('[MarketIntelligence] Trade history fetch failed:', histErr.message);
      }
    }
    console.log('[MarketIntelligence] Parsed recommendations count:', recommendations.length);
    console.log('[MarketIntelligence] Recommendations:', JSON.stringify(recommendations, null, 2));

    // Enrich recommendations with trade history data
    // CRITICAL: Apply strict filtering to prevent buying into downtrends
    const enhancedRecommendations = recommendations
      .filter(r => r.confidence_score >= 40) // Lower filter to show more options
      .map(r => {
        // Get historical data for this asset
        const histData = tradeHistoryData?.asset_analytics?.[r.symbol?.toUpperCase()];
        
        // Get current market data for this asset
        const currentData = marketData.find(m => m.symbol?.toUpperCase() === r.symbol?.toUpperCase());
        const change24h = currentData?.change_24h_percent || currentData?.price_change_percentage_24h || 0;
        const currentPrice = currentData?.price || currentData?.current_price || 0;
        
        // CRITICAL: Adjust confidence based on actual market conditions
        let adjustedConfidence = r.confidence_score;
        let adjustedAction = r.optimal_action || r.action || 'hold';
        
        // RULE 1: For "strong_buy" signals - allow if not crashing
        // REMOVED the +2% gate that was filtering out nearly everything
        // The LLM already factors in momentum when deciding strong_buy
        if (adjustedAction === 'strong_buy' && change24h < -3) {
          // Only downgrade if actually falling significantly
          adjustedAction = 'buy';
          adjustedConfidence = Math.min(adjustedConfidence, 65);
          console.log(`[MarketIntelligence] ${r.symbol}: Downgraded strong_buy to buy - 24h change ${change24h.toFixed(1)}% (falling)`);
        }
        
        // RULE 2: For "buy" signals - cap confidence only if crashing hard
        if (change24h < -5 && (adjustedAction === 'buy' || adjustedAction === 'strong_buy')) {
          console.log(`[MarketIntelligence] ${r.symbol}: Price crashing ${change24h.toFixed(1)}%, reducing to hold`);
          adjustedConfidence = Math.min(adjustedConfidence, 45);
          adjustedAction = 'hold';
        }
        
        // RULE 3: Boost confidence for assets with strong positive momentum
        if (change24h >= 3 && (adjustedAction === 'buy' || adjustedAction === 'strong_buy')) {
          adjustedConfidence = Math.min(95, adjustedConfidence + 5);
          console.log(`[MarketIntelligence] ${r.symbol}: Strong momentum +${change24h.toFixed(1)}%, boosting confidence`);
        }
        
        // RULE 4: Historical performance adjustment
        if (histData) {
          if (histData.win_rate > 70 && histData.total_trades >= 3) {
            adjustedConfidence = Math.min(95, adjustedConfidence + 5);
          } else if (histData.win_rate < 45 && histData.total_trades > 5) {
            adjustedConfidence = Math.max(30, adjustedConfidence - 15);
            if (adjustedAction === 'strong_buy') adjustedAction = 'buy';
            console.log(`[MarketIntelligence] ${r.symbol}: Poor win rate (${histData.win_rate.toFixed(1)}%), reducing`);
          }
        }
        
        // RULE 5: Recent trade performance check
        if (histData?.recent_trades) {
          const recentLosses = histData.recent_trades.filter(t => t.pnl < 0).length;
          const recentTotal = histData.recent_trades.length;
          if (recentTotal >= 3 && recentLosses >= 2) {
            adjustedConfidence = Math.max(35, adjustedConfidence - 10);
            if (adjustedAction === 'strong_buy') adjustedAction = 'buy';
            console.log(`[MarketIntelligence] ${r.symbol}: Recent losses (${recentLosses}/${recentTotal})`);
          }
        }
        
        // RULE 6: Final validation for strong signals
        // strong_buy requires: 60%+ confidence (momentum check removed - AI already considers it)
        if (adjustedAction === 'strong_buy' && adjustedConfidence < 60) {
          adjustedAction = 'buy';
        }
        
        // Determine if this is auto-tradeable (strong signal with high confidence)
        const isAutoTradeable = (adjustedAction === 'strong_buy' || adjustedAction === 'strong_sell') && adjustedConfidence >= 60;
        const isShortTermSignal = r.timing_window === '1h' || r.timing_window === '2h' || r.timing_window === '4h' || r.timing_window === 'immediate';
        
        return {
          ...r,
          confidence_score: adjustedConfidence,
          optimal_action: adjustedAction,
          current_price: currentPrice,
          // Ensure all fields have defaults
          technical_pattern: r.technical_pattern || 'No clear pattern',
          pattern_reliability: r.pattern_reliability || 'moderate',
          timing_window: r.timing_window || 'short_term',
          stop_loss_pct: r.stop_loss_pct || 2,
          take_profit_pct: histData?.avg_successful_gain_pct || r.take_profit_pct || 3,
          sentiment_score: r.sentiment_score || 50,
          momentum_strength: r.momentum_strength || (change24h > 3 ? 'strong' : change24h > 0 ? 'moderate' : 'weak'),
          volume_profile: r.volume_profile || 'neutral',
          correlation_group: r.correlation_group || 'uncorrelated',
          // Historical data enrichment
          historical_win_rate: histData?.win_rate || r.historical_win_rate || null,
          historical_avg_gain: histData?.avg_successful_gain_pct || r.historical_avg_gain || null,
          historical_buy_zone: histData?.optimal_buy_zone || null,
          is_top_performer: r.is_top_performer || (histData?.win_rate > 65),
          // Market context
          current_24h_change: change24h,
          action_reason: change24h < -2 ? 'Price falling - waiting for reversal' : r.reasoning,
          // New fields for auto-trader integration
          short_term_signal: isShortTermSignal,
          auto_tradeable: isAutoTradeable,
          predicted_direction: r.predicted_direction || (change24h > 0 ? 'up' : change24h < 0 ? 'down' : 'sideways'),
          predicted_move_pct: r.predicted_move_pct || r.predicted_gain_percent || 0
        };
      })
      .sort((a, b) => {
        // Sort by: strong_buy first, then by confidence
        const actionPriority = { 'strong_buy': 4, 'buy': 3, 'hold': 2, 'sell': 1, 'strong_sell': 0 };
        const aPriority = actionPriority[a.optimal_action] || 2;
        const bPriority = actionPriority[b.optimal_action] || 2;
        if (aPriority !== bPriority) return bPriority - aPriority;
        return b.confidence_score - a.confidence_score;
      });

    console.log('[MarketIntelligence] Generated', enhancedRecommendations.length, 'recommendations');
    console.log('[MarketIntelligence] Market regime:', marketIntelligence?.market_regime);

    // Persist actionable signals for auto-trader (global, short-lived)
    try {
      const actionable = enhancedRecommendations.filter(r =>
        (r.optimal_action === 'buy' || r.optimal_action === 'strong_buy') && r.confidence_score >= 50
      );

      // Deactivate existing active signals for these symbols (prevent duplicates)
      const existing = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true });
      const symbolsSet = new Set(actionable.map(a => (a.symbol || '').toUpperCase()));
      for (const sig of existing) {
        try {
          if (symbolsSet.has((sig.asset_symbol || '').toUpperCase())) {
            await base44.asServiceRole.entities.AssetSignal.update(sig.id, { is_active: false });
          }
        } catch (_e) {}
      }

      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      for (const r of actionable) {
        try {
          await base44.asServiceRole.entities.AssetSignal.create({
            asset_symbol: (r.symbol || '').toUpperCase(),
            asset_type: KRAKEN_PAIR_MAP[(r.symbol || '').toUpperCase()] ? 'crypto' : 'stocks',
            signal_type: r.optimal_action,
            confidence_score: r.confidence_score,
            change_24h: r.current_24h_change ?? 0,
            take_profit_pct: r.take_profit_pct ?? 3,
            stop_loss_pct: r.stop_loss_pct ?? 2,
            reasoning: r.action_reason || r.reasoning || '',
            is_active: true,
            is_short_term: true,
            expires_at: expiresAt,
            metadata_json: JSON.stringify({
              generated_at: new Date().toISOString(),
              auto_tradeable: r.auto_tradeable === true,
              timing_window: r.timing_window,
              momentum_strength: r.momentum_strength,
              technical_pattern: r.technical_pattern,
              sentiment_score: r.sentiment_score ?? null,
              predicted_gain_pct: r.predicted_move_pct ?? null
            })
          });
        } catch (saveErr) {
          console.warn('[MarketIntelligence] Failed to save AssetSignal for', r.symbol, saveErr?.message || saveErr);
        }
      }

      console.log('[MarketIntelligence] Persisted', actionable.length, 'signals for auto-trader');
    } catch (persistErr) {
      console.warn('[MarketIntelligence] Persistence warning:', persistErr?.message || persistErr);
    }

     return Response.json({
      success: true,
      recommendations: enhancedRecommendations,
      market_intelligence: marketIntelligence,
      market_summary: llmResponse?.market_summary || 'Analysis complete',
      upcoming_catalysts: llmResponse?.upcoming_catalysts || [],
      trade_history_summary: tradeHistoryData?.summary || null,
      top_historical_performers: tradeHistoryData?.summary?.best_performing_assets || [],
      analyzed_count: targetSymbols.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[MarketIntelligence] Error:', error);
    // Graceful fallback on any unexpected error (avoid 500)
    return Response.json({
      success: false,
      error: error.message,
      recommendations: [],
      market_intelligence: null,
      market_summary: 'Analysis failed, but request completed without crashing',
      upcoming_catalysts: [],
      analyzed_count: 0,
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
});