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
1. Focus on STABILITY and CONSISTENT upward momentum
2. Avoid highly volatile or speculative assets
3. Look for assets showing gradual recovery or consolidation patterns
4. Prioritize assets with positive 24h trends but NOT extreme gains (avoid FOMO)
5. Consider market cap and trading volume for liquidity

RISK TOLERANCE: LOW - We want HIGH PROBABILITY wins, not moonshots.
TARGET GAINS: 5-15% within 24-48 hours

For each asset, provide:
- confidence_score (0-100): How confident you are in a 5-15% gain
- predicted_gain_percent (5-15): Expected percentage gain
- reasoning: Brief explanation (max 50 words)
- action: "buy" or "hold" or "skip"
- risk_level: "low", "medium", or "high"

Only recommend assets with confidence_score >= 60 and risk_level "low" or "medium".`;

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
    
    // Filter: Only high-confidence, low-risk recommendations
    const filteredRecommendations = recommendations.filter(r => 
      r.confidence_score >= 60 && 
      ['low', 'medium'].includes(r.risk_level) &&
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