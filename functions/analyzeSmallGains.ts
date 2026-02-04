import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Enhanced Market Intelligence Analyzer
 * 
 * Analyzes user's assets with advanced capabilities:
 * - Technical chart pattern recognition (head & shoulders, double tops/bottoms, etc.)
 * - Market sentiment analysis from news and social trends
 * - Cross-asset correlation analysis
 * - Optimal buy/sell timing recommendations
 * - HISTORICAL TRADE DATA integration for optimal entry/exit points
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

    // Get user's auto-buy preferences
    const autoBuyPrefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({
      created_by: user.email,
      enabled: true,
      is_simulation: false
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

    // Fetch current market data for target symbols
    // Known crypto symbols - everything else assumed to be stock
    const knownCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'LINK', 'AVAX', 'MATIC', 'UNI', 'ATOM', 'XLM', 'PEPE', 'HBAR', 'SHIB', 'LTC', 'BCH'];
    const knownStocks = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA', 'AMD', 'NFLX', 'DIS'];
    
    let marketData = [];
    try {
      const cryptoSymbols = targetSymbols.filter(s => knownCrypto.includes(s.toUpperCase()));
      const stockSymbols = targetSymbols.filter(s => knownStocks.includes(s.toUpperCase()));
      
      console.log('[MarketIntelligence] Fetching crypto:', cryptoSymbols, 'stocks:', stockSymbols);
      
      const marketResponse = await base44.functions.invoke('getMarketData', {
        action: 'getWatchlistData',
        payload: { cryptoSymbols, stockSymbols }
      });
      marketData = Array.isArray(marketResponse?.data) ? marketResponse.data : [];
      console.log('[MarketIntelligence] Got market data for', marketData.length, 'symbols');
    } catch (err) {
      console.error('[MarketIntelligence] Market data error:', err);
    }

    // CRITICAL: Fetch historical trade data for smarter recommendations
    let tradeHistoryData = null;
    if (includeTradeHistory) {
      try {
        console.log('[MarketIntelligence] Fetching trade history for symbols:', targetSymbols);
        const historyResponse = await base44.functions.invoke('analyzeTradeHistory', {
          symbols: targetSymbols,
          includeKrakenHistory: true,
          analyzePatterns: false // AI analysis done here instead
        });
        const historyData = historyResponse?.data || historyResponse;
        if (historyData?.success) {
          tradeHistoryData = historyData;
          console.log('[MarketIntelligence] Got trade history for', Object.keys(historyData.asset_analytics || {}).length, 'assets');
        }
      } catch (histErr) {
        console.warn('[MarketIntelligence] Trade history fetch failed:', histErr.message);
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

    const analysisPrompt = `You are an elite quantitative trading analyst with expertise in technical analysis, market sentiment, cross-asset correlations, AND access to the user's actual trading history.

TASK: Provide comprehensive market intelligence for these assets to inform automated trading decisions, incorporating HISTORICAL TRADE DATA to identify optimal entry/exit points.

ASSETS TO ANALYZE (Current Market):
${assetsSection}
${tradeHistorySection}

ANALYSIS FRAMEWORK:

1. TECHNICAL PATTERN RECOGNITION
For each asset, identify any of these patterns:
- Head & Shoulders (bearish reversal)
- Inverse Head & Shoulders (bullish reversal)
- Double Top (bearish reversal)
- Double Bottom (bullish reversal)
- Bull Flag / Bear Flag (continuation)
- Ascending/Descending Triangle
- Cup and Handle (bullish)
- Support/Resistance levels

2. SENTIMENT ANALYSIS
Based on your knowledge of current market conditions:
- Overall crypto market sentiment (bullish/bearish/neutral)
- Bitcoin dominance trend and its impact
- Macro factors (interest rates, regulations, institutional activity)
- Social media buzz indicators (high/medium/low)

3. CORRELATION ANALYSIS
- Which assets move together?
- Which assets provide diversification?
- Beta relative to BTC/major indices

4. TIMING SIGNALS (Use historical data to refine)
For each asset, provide:
- optimal_action: "strong_buy", "buy", "hold", "sell", "strong_sell"
  IMPORTANT: For auto-trading purposes, favor "buy" or "strong_buy" when confidence >= 60% unless there are clear bearish signals.
  A 60%+ confidence should typically result in a "buy" recommendation, not "hold".
  CRITICAL: If historical win rate > 70%, boost confidence. If win rate < 40%, reduce confidence.
- timing_window: "immediate" (next 1-4 hrs), "short_term" (24-48 hrs), "wait" (no clear setup)
- entry_zone: suggested price range for entry (USE HISTORICAL OPTIMAL BUY ZONES when available)
- stop_loss_pct: recommended stop loss percentage (consider historical patterns)
- take_profit_pct: recommended take profit percentage (USE HISTORICAL AVG GAINS as baseline)
- historical_win_rate: the user's actual win rate for this asset (if available)

5. MARKET REGIME
- Current market phase: accumulation, markup, distribution, markdown
- Volatility level: low, medium, high, extreme
- Trend strength: weak, moderate, strong

OUTPUT FORMAT:
Provide actionable intelligence the auto-trader can use to make informed decisions.`;

    // Call LLM with enhanced schema
    const llmResponse = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      add_context_from_internet: includeMarketIntelligence,
      response_json_schema: {
        type: "object",
        properties: {
          recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                symbol: { type: "string" },
                confidence_score: { type: "number" },
                predicted_gain_percent: { type: "number" },
                reasoning: { type: "string" },
                action: { type: "string" },
                risk_level: { type: "string" },
                technical_pattern: { type: "string" },
                pattern_reliability: { type: "string" },
                optimal_action: { type: "string" },
                timing_window: { type: "string" },
                entry_zone_low: { type: "number" },
                entry_zone_high: { type: "number" },
                stop_loss_pct: { type: "number" },
                take_profit_pct: { type: "number" },
                sentiment_score: { type: "number" },
                correlation_group: { type: "string" },
                historical_win_rate: { type: "number" },
                historical_avg_gain: { type: "number" },
                is_top_performer: { type: "boolean" }
              }
            }
          },
          market_intelligence: {
            type: "object",
            properties: {
              overall_sentiment: { type: "string" },
              sentiment_score: { type: "number" },
              market_regime: { type: "string" },
              volatility_level: { type: "string" },
              trend_strength: { type: "string" },
              btc_dominance_trend: { type: "string" },
              macro_outlook: { type: "string" },
              key_levels: {
                type: "object",
                properties: {
                  btc_support: { type: "number" },
                  btc_resistance: { type: "number" }
                }
              },
              correlation_clusters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    group_name: { type: "string" },
                    assets: { type: "array", items: { type: "string" } },
                    correlation_strength: { type: "string" }
                  }
                }
              },
              trading_recommendation: { type: "string" },
              best_opportunities: { type: "array", items: { type: "string" } },
              avoid_list: { type: "array", items: { type: "string" } },
              emerging_prospects: { 
                type: "array", 
                items: { 
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    reason: { type: "string" },
                    potential_gain_pct: { type: "number" }
                  }
                } 
              }
            }
          },
          market_summary: { type: "string" },
          upcoming_catalysts: { type: "array", items: { type: "string" } }
        }
      }
    });

    console.log('[MarketIntelligence] Raw LLM response:', JSON.stringify(llmResponse, null, 2));
    const recommendations = llmResponse?.recommendations || [];
    const marketIntelligence = llmResponse?.market_intelligence || null;
    console.log('[MarketIntelligence] Parsed recommendations count:', recommendations.length);
    console.log('[MarketIntelligence] Recommendations:', JSON.stringify(recommendations, null, 2));
    
    // Enrich recommendations with trade history data
    const enhancedRecommendations = recommendations
      .filter(r => r.confidence_score >= 50)
      .map(r => {
        // Get historical data for this asset
        const histData = tradeHistoryData?.asset_analytics?.[r.symbol?.toUpperCase()];
        
        // Adjust confidence based on historical performance
        let adjustedConfidence = r.confidence_score;
        if (histData) {
          if (histData.win_rate > 70) adjustedConfidence = Math.min(95, adjustedConfidence + 10);
          else if (histData.win_rate < 40 && histData.total_trades > 5) adjustedConfidence = Math.max(40, adjustedConfidence - 15);
        }
        
        return {
          ...r,
          confidence_score: adjustedConfidence,
          // Ensure all fields have defaults
          technical_pattern: r.technical_pattern || 'No clear pattern',
          pattern_reliability: r.pattern_reliability || 'moderate',
          optimal_action: r.optimal_action || r.action || 'buy',
          timing_window: r.timing_window || 'short_term',
          stop_loss_pct: r.stop_loss_pct || 1,
          take_profit_pct: histData?.avg_successful_gain_pct || r.take_profit_pct || 3,
          sentiment_score: r.sentiment_score || 50,
          correlation_group: r.correlation_group || 'uncorrelated',
          // Historical data enrichment
          historical_win_rate: histData?.win_rate || r.historical_win_rate || null,
          historical_avg_gain: histData?.avg_successful_gain_pct || r.historical_avg_gain || null,
          historical_buy_zone: histData?.optimal_buy_zone || null,
          is_top_performer: r.is_top_performer || (histData?.win_rate > 65)
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
    return Response.json({
      success: false,
      error: error.message,
      recommendations: [],
      market_intelligence: null
    }, { status: 500 });
  }
});