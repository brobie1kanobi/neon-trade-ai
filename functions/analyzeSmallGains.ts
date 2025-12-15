import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Small Gains Analyzer - AI-Powered Low-Risk Trading Recommendations
 * 
 * Analyzes user's auto-buy preferences and identifies short-term opportunities
 * for modest gains (5-15%) with high probability of success.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { symbols = [] } = body;

    console.log('[analyzeSmallGains] Analyzing', symbols.length, 'symbols for user:', user.email);

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
        message: 'No symbols to analyze'
      });
    }

    // Fetch current market data for target symbols
    let marketData = [];
    try {
      const marketResponse = await base44.functions.invoke('getMarketData', {
        action: 'getWatchlistData',
        payload: {
          cryptoSymbols: targetSymbols.filter(s => !['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA'].includes(s)),
          stockSymbols: targetSymbols.filter(s => ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA'].includes(s))
        }
      });
      marketData = Array.isArray(marketResponse?.data) ? marketResponse.data : [];
    } catch (err) {
      console.error('[analyzeSmallGains] Market data error:', err);
    }

    // Use LLM to analyze for small gains opportunities
    const prompt = `You are a conservative crypto trading analyst specializing in SHORT-TERM, LOW-RISK opportunities.

TASK: Analyze the following assets and identify which ones have the HIGHEST PROBABILITY of achieving modest gains (5-15%) in the next 24-48 hours.

ASSETS TO ANALYZE:
${marketData.map(asset => `
- ${asset.symbol}: Current Price: $${asset.price || asset.current_price}, 24h Change: ${asset.change_24h_percent || asset.price_change_percentage_24h}%
`).join('')}

ANALYSIS CRITERIA:
1. Prioritize assets with strong upward momentum and positive trends
2. Look for assets with good volatility for quick gains
3. Consider recent price action and volume surges
4. Identify breakout opportunities and support levels
5. Balance stability with growth potential

RISK TOLERANCE: MODERATE - We want GOOD PROBABILITY wins with decent upside.
TARGET GAINS: 8-25% within 24-72 hours

For each asset, provide:
- confidence_score (0-100): How confident you are in achieving the target gain
- predicted_gain_percent (8-25): Expected percentage gain
- reasoning: Brief explanation (max 50 words)
- action: "buy" or "hold" or "skip"
- risk_level: "low", "medium", or "high"

Recommend assets with confidence_score >= 55 and any risk_level (we'll manage risk with stop-losses).`;

    const llmResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
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
                risk_level: { type: "string" }
              }
            }
          },
          market_summary: { type: "string" }
        }
      }
    });

    const recommendations = llmResponse?.recommendations || [];
    
    // Filter: Accept moderate-confidence recommendations (training wheels OFF)
    const filteredRecommendations = recommendations.filter(r => 
      r.confidence_score >= 55 && 
      r.action === 'buy'
    ).sort((a, b) => b.confidence_score - a.confidence_score);

    console.log('[analyzeSmallGains] Generated', filteredRecommendations.length, 'recommendations');

    return Response.json({
      success: true,
      recommendations: filteredRecommendations,
      market_summary: llmResponse?.market_summary || 'Analysis complete',
      analyzed_count: targetSymbols.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[analyzeSmallGains] Error:', error);
    return Response.json({
      success: false,
      error: error.message,
      recommendations: []
    }, { status: 500 });
  }
});