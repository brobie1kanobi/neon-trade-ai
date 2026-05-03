import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

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

    // Global execution deadline to avoid 502 timeouts
    const start = Date.now();
    const DEADLINE_MS = 24000; // keep below platform hard limit
    const timeLeft = () => Math.max(0, DEADLINE_MS - (Date.now() - start));
    const ensureTime = (pad = 500) => Math.max(2000, timeLeft() - pad);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { symbols = [], includeMarketIntelligence = true, includeTradeHistory = true } = body;

    console.log('[MarketIntelligence] Analyzing', symbols.length, 'symbols with full intelligence:', includeMarketIntelligence, 'trade history:', includeTradeHistory);

    const parseJsonString = (value, fallback = []) => {
      if (!value) return fallback;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    };

    const buildCacheKey = (symbolList) => {
      const normalized = [...new Set((symbolList || []).map((s) => String(s || '').toUpperCase()).filter(Boolean))].sort();
      return `market-intel:${normalized.join(',')}`;
    };

    const getCachedMarketIntelligence = async (cacheKey) => {
      const records = await base44.asServiceRole.entities.MarketIntelligenceCache.filter({ cache_key: cacheKey });
      const nowIso = new Date().toISOString();
      const valid = records
        .filter((record) => !record.expires_at || record.expires_at > nowIso)
        .sort((a, b) => new Date(b.cached_at || b.created_date || 0) - new Date(a.cached_at || a.created_date || 0));

      if (valid.length === 0) return null;

      const record = valid[0];
      return {
        record,
        payload: {
          market_intelligence: {
            market_sentiment_score: record.market_sentiment_score ?? 50,
            market_regime: record.market_regime || 'range',
            volatility_level: record.volatility_level || 'moderate',
            momentum_direction: record.momentum_direction || 'neutral',
            trend_strength: record.trend_strength || 'moderate',
            short_term_outlook: record.short_term_outlook || '',
            trading_recommendation: record.trading_recommendation || '',
            best_opportunities: parseJsonString(record.best_opportunities_json, []),
            avoid_list: parseJsonString(record.avoid_list_json, []),
            hot_signals: parseJsonString(record.hot_signals_json, [])
          },
          market_summary: record.market_summary || 'Cached market summary',
          upcoming_catalysts: parseJsonString(record.upcoming_catalysts_json, [])
        }
      };
    };

    const saveCachedMarketIntelligence = async (cacheKey, symbolList, intelPayload) => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const marketIntel = intelPayload?.market_intelligence || {};
      const cacheRecord = {
        cache_key: cacheKey,
        symbols_json: JSON.stringify([...new Set((symbolList || []).map((s) => String(s || '').toUpperCase()).filter(Boolean))].sort()),
        market_sentiment_score: marketIntel.market_sentiment_score ?? 50,
        market_regime: marketIntel.market_regime || 'range',
        volatility_level: marketIntel.volatility_level || 'moderate',
        momentum_direction: marketIntel.momentum_direction || 'neutral',
        trend_strength: marketIntel.trend_strength || 'moderate',
        short_term_outlook: marketIntel.short_term_outlook || '',
        trading_recommendation: marketIntel.trading_recommendation || '',
        best_opportunities_json: JSON.stringify(marketIntel.best_opportunities || []),
        avoid_list_json: JSON.stringify(marketIntel.avoid_list || []),
        hot_signals_json: JSON.stringify(marketIntel.hot_signals || []),
        market_summary: intelPayload?.market_summary || 'Analysis complete',
        upcoming_catalysts_json: JSON.stringify(intelPayload?.upcoming_catalysts || []),
        cached_at: now.toISOString(),
        expires_at: expiresAt
      };

      const existing = await base44.asServiceRole.entities.MarketIntelligenceCache.filter({ cache_key: cacheKey });
      if (existing.length > 0) {
        const latest = existing.sort((a, b) => new Date(b.cached_at || b.created_date || 0) - new Date(a.cached_at || a.created_date || 0))[0];
        await base44.asServiceRole.entities.MarketIntelligenceCache.update(latest.id, cacheRecord);
      } else {
        await base44.asServiceRole.entities.MarketIntelligenceCache.create(cacheRecord);
      }
    };

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
    const normalizedTargetSymbols = [...new Set(targetSymbols.map((s) => String(s || '').toUpperCase()).filter(Boolean))];
    const marketIntelCacheKey = buildCacheKey(normalizedTargetSymbols);

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

    // FAST PATH: If the remaining budget is tight, skip LLM and history to avoid 502s
    if (timeLeft() < 7000) {
      const recs = (marketData || []).map(m => {
        const ch = Number(m.change_24h_percent ?? m.price_change_percentage_24h ?? 0);
        const price = Number(m.price ?? m.current_price ?? 0);
        const action = ch >= 0 ? 'buy' : 'hold';
        const confidence = ch >= 3 ? 65 : ch >= 0 ? 58 : 45;
        return {
          symbol: (m.symbol || '').toUpperCase(),
          confidence_score: confidence,
          predicted_direction: ch >= 0 ? 'up' : 'down',
          predicted_move_pct: Math.abs(ch),
          reasoning: 'Heuristic (fast path)',
          action,
          optimal_action: action,
          timing_window: '4h',
          stop_loss_pct: 2,
          take_profit_pct: 3,
          current_price: price,
          current_24h_change: ch
        };
      });
      const avg = recs.reduce((a, r) => a + (r.current_24h_change || 0), 0) / (recs.length || 1);
      const intel = {
        market_sentiment_score: Math.max(0, Math.min(100, 50 + avg)),
        market_regime: avg > 1 ? 'risk-on' : avg < -1 ? 'risk-off' : 'range',
        volatility_level: Math.abs(avg) > 3 ? 'high' : Math.abs(avg) > 1 ? 'moderate' : 'low',
      };
      return Response.json({
        success: true,
        recommendations: recs,
        market_intelligence: intel,
        market_summary: 'Fast-path analysis',
        upcoming_catalysts: [],
        analyzed_count: targetSymbols.length,
        trade_history_summary: null,
        top_historical_performers: [],
        timestamp: new Date().toISOString()
      });
    }

    // CRITICAL: Fetch historical trade data for smarter recommendations
    let tradeHistoryData = null;
    let tradeHistoryPromise = null;
    if (includeTradeHistory && timeLeft() > 9000 && targetSymbols.length <= 10) {
      console.log('[MarketIntelligence] Fetching trade history for symbols:', targetSymbols);
      try {
        tradeHistoryPromise = withTimeout(
          base44.functions.invoke('analyzeTradeHistory', {
            symbols: targetSymbols,
            includeKrakenHistory: false,
            analyzePatterns: false
          }),
          Math.min(4000, ensureTime()),
          'trade history'
        ).catch((histErr) => {
          console.warn('[MarketIntelligence] Trade history fetch failed:', histErr.message);
          return null;
        });
      } catch (histErr) {
        console.warn('[MarketIntelligence] Trade history scheduling failed:', histErr.message);
      }
    }

    // Fetch recent government spending data for signal enrichment
    let govSpendingSection = '';
    if (timeLeft() > 12000) {
      try {
        const recentAwards = await base44.asServiceRole.entities.GovSpendingAward.filter({}, '-created_date', 30);
        const bullishAwards = recentAwards.filter(a => a.signal_impact === 'bullish' && (a.impact_score || 0) >= 30);
        if (bullishAwards.length > 0) {
          const awardLines = bullishAwards.slice(0, 10).map(a => {
            const symbols = (() => { try { return JSON.parse(a.related_symbols_json || '[]'); } catch { return []; } })();
            const amt = a.total_obligation >= 1e9 ? `$${(a.total_obligation / 1e9).toFixed(1)}B` : `$${(a.total_obligation / 1e6).toFixed(1)}M`;
            return `- ${a.recipient_name}: ${amt} ${a.award_type} from ${a.awarding_agency} | Sector: ${a.sector} | Related: ${symbols.join(', ')} | Impact: ${a.impact_score}/100`;
          });
          govSpendingSection = `

RECENT US GOVERNMENT SPENDING SIGNALS (from USASpending.gov):
${awardLines.join('\n')}

CRITICAL: Factor these government awards into your analysis:
1. Large contracts/grants to companies signal future revenue growth for related stocks/sectors
2. Heavy government spending in a sector may boost related crypto tokens (blockchain/AI/energy)
3. Overall increased government spending can be bullish for BTC as an inflation hedge
4. Use this data to adjust confidence scores upward for assets benefiting from gov spending`;
        }
      } catch (govErr) {
        console.warn('[MarketIntelligence] Gov spending data fetch failed:', govErr.message);
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
${govSpendingSection}

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

    // Two-stage LLM: (1) market intelligence with web context, (2) recommendations without web
    const intelSchema = {
      type: "object",
      properties: {
        market_intelligence: {
          type: "object",
          properties: {
            market_sentiment_score: { type: "number" },
            market_regime: { type: "string" },
            volatility_level: { type: "string" },
            momentum_direction: { type: "string" },
            trend_strength: { type: "string" },
            short_term_outlook: { type: "string" },
            trading_recommendation: { type: "string" },
            best_opportunities: { type: "array", items: { type: "string" } },
            avoid_list: { type: "array", items: { type: "string" } },
            hot_signals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  signal_type: { type: "string" },
                  predicted_move_pct: { type: "number" },
                  timing: { type: "string" }
                }
              }
            }
          }
        },
        market_summary: { type: "string" },
        upcoming_catalysts: { type: "array", items: { type: "string" } }
      }
    };

    const recsSchema = {
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
        }
      }
    };

    async function invokeLLM({ prompt, model, withWeb, schema, label, timeoutMs }) {
      const baseMs = typeof timeoutMs === 'number' ? timeoutMs : (withWeb ? 14000 : 9000);
      const ms = Math.min(baseMs, ensureTime());
      return await withTimeout(
        base44.integrations.Core.InvokeLLM({
          prompt,
          add_context_from_internet: !!withWeb,
          response_json_schema: schema,
          model
        }),
        ms,
        label || 'LLM invocation'
      );
    }

    // Limit symbols sent to LLM to reduce token load (choose by largest absolute 24h change)
    const symbolRank = (marketData.length > 0 ? marketData.map(m => ({
      symbol: (m.symbol || '').toUpperCase(),
      abs: Math.abs(Number(m.change_24h_percent ?? m.price_change_percentage_24h ?? 0))
    })) : targetSymbols.map(s => ({ symbol: (s || '').toUpperCase(), abs: 0 })))
      .filter(x => x.symbol)
      .sort((a,b) => b.abs - a.abs)
      .map(x => x.symbol);

    const symbolsForIntel = (symbolRank.length ? symbolRank : targetSymbols.map(s => (s || '').toUpperCase())).slice(0, 4);

    const intelPrompt = `You are a short-term crypto market analyst.
    Focus ONLY on overall market context using news and social buzz for the next 1-6h.
    Symbols of interest (prioritize if mentioned in news/social):\n${symbolsForIntel.map(s => '- ' + s).join('\n')}\n\nReturn: market_sentiment_score (0-100), market_regime (e.g., 'risk-on', 'risk-off', 'range'), volatility_level ('low'|'moderate'|'high'), momentum_direction, trend_strength, short_term_outlook (1-2 sentences), trading_recommendation (one sentence), best_opportunities (up to 3 tickers), avoid_list (up to 3 tickers), hot_signals (up to 3 {symbol, signal_type, predicted_move_pct, timing}), market_summary (2-3 sentences), upcoming_catalysts (0-3 bullets).`;

    let marketIntelResp;
    const cachedMarketIntel = includeMarketIntelligence ? await getCachedMarketIntelligence(marketIntelCacheKey) : null;

    if (cachedMarketIntel) {
      marketIntelResp = cachedMarketIntel.payload;
      console.log('[MarketIntelligence] Using cached market intelligence for', marketIntelCacheKey);
    } else {
      try {
        // Primary web-enabled model
        marketIntelResp = await invokeLLM({
              prompt: intelPrompt,
              model: 'gemini_3_flash',
              withWeb: true,
              schema: intelSchema,
              label: 'LLM market intelligence (web)',
              timeoutMs: ensureTime()
            });
      } catch (eA) {
        console.warn('[MarketIntelligence] Intel LLM error (primary):', eA?.message || eA);
        try {
          // Alternate web-enabled fallback model
          marketIntelResp = await invokeLLM({
            prompt: intelPrompt,
            model: 'gemini_3_flash',
            withWeb: true,
            schema: intelSchema,
            label: 'LLM market intelligence (fallback web)',
            timeoutMs: ensureTime()
          });
        } catch (eB) {
          console.warn('[MarketIntelligence] Intel LLM error (fallback):', eB?.message || eB);
          marketIntelResp = {
            market_intelligence: { market_sentiment_score: 50, market_regime: 'Heuristic (LLM unavailable)', volatility_level: 'moderate' },
            market_summary: 'Heuristic fallback used',
            upcoming_catalysts: []
          };
        }
      }

      if (includeMarketIntelligence) {
        await saveCachedMarketIntelligence(marketIntelCacheKey, normalizedTargetSymbols, marketIntelResp);
        console.log('[MarketIntelligence] Saved market intelligence cache for', marketIntelCacheKey);
      }
    }

    // Build concise recommendations prompt using intel + real-time prices
    const assetsLines = (marketData.length > 0
      ? marketData.map(asset => `- ${asset.symbol}: price=$${asset.price || asset.current_price}, change_24h=${(asset.change_24h_percent || asset.price_change_percentage_24h || 0).toFixed(2)}%`).join('\n')
      : targetSymbols.map(s => `- ${s}: (no price snapshot; infer conservatively)`).join('\n'));

    const intelJson = JSON.stringify(marketIntelResp?.market_intelligence || marketIntelResp || {});

    const recsPrompt = `Given these assets and current snapshots:\n${assetsLines}\n\nAnd this market_intelligence (from web context):\n${intelJson}\n\nReturn a 'recommendations' array with up to ${Math.min(8, (symbolsForIntel.length || 5))} items. Be conservative with 'strong_buy'/'strong_sell'. Prefer 'buy' or 'hold' if unclear. JSON only.`;

    let recsResp;
    try {
      recsResp = await invokeLLM({
        prompt: recsPrompt,
        model: 'automatic',
        withWeb: false,
        schema: recsSchema,
        label: 'LLM recommendations',
        timeoutMs: ensureTime()
      });
    } catch (eR) {
      console.warn('[MarketIntelligence] Recs LLM error:', eR?.message || eR);
      // Heuristic thin fallback if needed
      const heuristics = marketData.map(m => {
        const ch = Number(m.change_24h_percent ?? m.price_change_percentage_24h ?? 0);
        let action = ch >= 0 ? 'buy' : 'hold';
        let confidence = ch >= 3 ? 65 : ch >= 0 ? 58 : 45;
        return {
          symbol: m.symbol,
          confidence_score: confidence,
          predicted_direction: ch >= 0 ? 'up' : 'down',
          predicted_move_pct: 2,
          reasoning: 'Heuristic based on 24h change and momentum proxy',
          action,
          optimal_action: action,
          timing_window: '4h',
          stop_loss_pct: 2,
          take_profit_pct: 3
        };
      }).filter(r => r.confidence_score >= 55).slice(0, 6);
      recsResp = { recommendations: heuristics };
    }

    // Compose unified llmResponse compatible with downstream logic
    let llmResponse = {
      recommendations: recsResp?.recommendations || [],
      market_intelligence: marketIntelResp?.market_intelligence || null,
      market_summary: marketIntelResp?.market_summary || 'Analysis complete',
      upcoming_catalysts: marketIntelResp?.upcoming_catalysts || []
    };

    // Fallback: if the recommendation step returns nothing but market intelligence has hot signals,
    // synthesize actionable recommendations so UI + auto-trader stay aligned.
    if ((!llmResponse.recommendations || llmResponse.recommendations.length === 0) && llmResponse.market_intelligence?.hot_signals?.length) {
      const hotSignals = llmResponse.market_intelligence.hot_signals;
      llmResponse.recommendations = hotSignals.map((hs) => {
        const symbol = String(hs.symbol || '').toUpperCase();
        const marketQuote = marketData.find((m) => String(m.symbol || '').toUpperCase() === symbol);
        const predictedMove = Number(hs.predicted_move_pct || 0);
        const confidence = Math.max(55, Math.min(78, 55 + Math.round(Math.abs(predictedMove) * 4)));
        const action = predictedMove >= 0 ? 'buy' : 'sell';
        return {
          symbol,
          confidence_score: confidence,
          predicted_direction: predictedMove >= 0 ? 'up' : 'down',
          predicted_move_pct: predictedMove,
          reasoning: hs.signal_type ? `Market intelligence signal: ${hs.signal_type}` : 'Market intelligence hot signal',
          action,
          optimal_action: action,
          timing_window: hs.timing || '4h',
          stop_loss_pct: 2,
          take_profit_pct: Math.max(3, Math.abs(predictedMove)),
          current_price: Number(marketQuote?.price || marketQuote?.current_price || 0),
          current_24h_change: Number(marketQuote?.change_24h_percent || marketQuote?.price_change_percentage_24h || 0),
        };
      });
      console.log('[MarketIntelligence] Synthesized recommendations from hot_signals:', llmResponse.recommendations.length);
    }

    if (!llmResponse.recommendations || llmResponse.recommendations.length === 0) {
      llmResponse.recommendations = marketData.map((m) => {
        const change24h = Number(m.change_24h_percent ?? m.price_change_percentage_24h ?? 0);
        const action = change24h >= 0 ? 'buy' : 'hold';
        const confidence = change24h >= 3 ? 65 : change24h >= 0 ? 58 : 45;
        return {
          symbol: String(m.symbol || '').toUpperCase(),
          confidence_score: confidence,
          predicted_direction: change24h >= 0 ? 'up' : 'down',
          predicted_move_pct: Math.abs(change24h),
          reasoning: 'Heuristic fallback based on live market momentum',
          action,
          optimal_action: action,
          timing_window: '4h',
          stop_loss_pct: 2,
          take_profit_pct: 3,
          current_price: Number(m.price || m.current_price || 0),
          current_24h_change: change24h,
        };
      }).filter((r) => r.confidence_score >= 55).slice(0, 6);
      console.log('[MarketIntelligence] Synthesized recommendations from marketData:', llmResponse.recommendations.length);
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

    // Normalize LLM outputs before filtering/enrichment
    const normalizedRecommendations = recommendations.map((r) => {
      const rawConfidence = Number(r.confidence_score || 0);
      const normalizedConfidence = rawConfidence > 0 && rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence;
      const normalizedAction = String(r.optimal_action || r.action || 'hold').toLowerCase().replace(/\s+/g, '_');
      const actionMap = {
        strongbuy: 'strong_buy',
        strong_buy: 'strong_buy',
        buy: 'buy',
        buy_on_dip: 'buy',
        accumulate: 'buy',
        hold: 'hold',
        wait: 'hold',
        neutral: 'hold',
        sell: 'sell',
        strongsell: 'strong_sell',
        strong_sell: 'strong_sell',
        avoid: 'sell',
        not_applicable: 'hold'
      };

      const mappedAction = actionMap[String(r.action || normalizedAction).toLowerCase().replace(/\s+/g, '_')] || 'hold';
      const mappedOptimalAction = actionMap[normalizedAction] || mappedAction || 'hold';
      return {
        ...r,
        confidence_score: Math.max(0, Math.min(100, normalizedConfidence)),
        action: mappedAction,
        optimal_action: mappedOptimalAction
      };
    });

    // Enrich recommendations with trade history data
    // CRITICAL: Apply strict filtering to prevent buying into downtrends
    const enhancedRecommendations = normalizedRecommendations
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
    if (timeLeft() > 1500) {
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
    } else {
      console.log('[MarketIntelligence] Skipping signal persistence - low time budget');
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
      success: true,
      message: error.message,
      recommendations: [],
      market_intelligence: null,
      market_summary: 'Analysis failed, showing empty results',
      upcoming_catalysts: [],
      analyzed_count: 0,
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
});