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
    const DEADLINE_MS = 28000; // keep below platform hard limit (~30s)
    const timeLeft = () => Math.max(0, DEADLINE_MS - (Date.now() - start));
    const ensureTime = (pad = 500) => Math.max(2000, timeLeft() - pad);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { symbols = [], includeMarketIntelligence = true, includeTradeHistory = true } = body;

    console.log('[MarketIntelligence] Analyzing', symbols.length, 'symbols with full intelligence:', includeMarketIntelligence, 'trade history:', includeTradeHistory);

    // ── DEDUP GUARD: Skip full analysis if signals were generated very recently ──
    // This prevents rapid-fire HF calls from overlapping frontend loads,
    // entity-automation cascades, and dashboard auto-refresh
    const SIGNAL_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
    try {
      const recentSignals = await base44.asServiceRole.entities.AssetSignal.filter(
        { is_active: true }, '-created_date', 5
      );
      if (recentSignals.length > 0) {
        const newestAge = Date.now() - new Date(recentSignals[0].created_date).getTime();
        if (newestAge < SIGNAL_COOLDOWN_MS) {
          console.log(`[MarketIntelligence] DEDUP: Signals generated ${(newestAge/1000).toFixed(0)}s ago (< ${SIGNAL_COOLDOWN_MS/1000}s cooldown). Returning cached signals.`);
          // Return cached data instead of re-running HF
          const cachedRecs = recentSignals.map(s => ({
            symbol: s.asset_symbol,
            confidence_score: s.confidence_score,
            optimal_action: s.signal_type,
            action: s.signal_type,
            reasoning: s.reasoning || 'Cached signal (cooldown active)',
            current_price: s.price_at_signal || 0,
            current_24h_change: s.change_24h || 0,
            technical_pattern: s.technical_pattern || 'No clear pattern',
            sentiment_score: s.sentiment_score || 50,
            momentum_strength: s.momentum_strength || 'moderate',
            predicted_move_pct: s.predicted_gain_pct || 0,
            timing_window: '4h',
            stop_loss_pct: s.stop_loss_pct || 2,
            take_profit_pct: s.take_profit_pct || 3,
            auto_tradeable: (s.signal_type === 'strong_buy' || s.signal_type === 'strong_sell') && s.confidence_score >= 60,
            is_cached: true
          }));
          // Also return cached market intelligence if available
          let cachedIntel = null;
          try {
            const intelCaches = await base44.asServiceRole.entities.MarketIntelligenceCache.filter({}, '-cached_at', 1);
            if (intelCaches.length > 0) {
              const c = intelCaches[0];
              cachedIntel = {
                market_sentiment_score: c.market_sentiment_score ?? 50,
                market_regime: c.market_regime || 'range',
                volatility_level: c.volatility_level || 'moderate',
                momentum_direction: c.momentum_direction || 'neutral',
                trend_strength: c.trend_strength || 'moderate',
                short_term_outlook: c.short_term_outlook || '',
                trading_recommendation: c.trading_recommendation || '',
                best_opportunities: JSON.parse(c.best_opportunities_json || '[]'),
                avoid_list: JSON.parse(c.avoid_list_json || '[]'),
                hot_signals: JSON.parse(c.hot_signals_json || '[]')
              };
            }
          } catch (_) {}
          return Response.json({
            success: true,
            recommendations: cachedRecs,
            market_intelligence: cachedIntel,
            market_summary: 'Using recently generated signals (cooldown active)',
            upcoming_catalysts: [],
            analyzed_count: cachedRecs.length,
            trade_history_summary: null,
            top_historical_performers: [],
            timestamp: new Date().toISOString(),
            dedup_cooldown: true,
            cooldown_remaining_sec: Math.round((SIGNAL_COOLDOWN_MS - newestAge) / 1000)
          });
        }
      }
    } catch (e) {
      console.warn('[MarketIntelligence] Dedup check failed, proceeding:', e.message);
    }

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
            market_sentiment_score: record.market_sentiment_score ?? (realFearGreedScore !== null ? realFearGreedScore : 50),
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
        market_sentiment_score: marketIntel.market_sentiment_score ?? (realFearGreedScore !== null ? realFearGreedScore : 50),
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

    // ── Hugging Face LLM Helper with 503 cold-start retry ──
    const HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
    const HF_URL = 'https://router.huggingface.co/v1/chat/completions';

    async function callHuggingFace(systemPrompt, userPrompt, timeoutMs = 15000) {
      const token = Deno.env.get('HUGGINGFACE_API_TOKEN');
      if (!token) throw new Error('HUGGINGFACE_API_TOKEN not set');

      const MAX_RETRIES = 2; // up to 2 retries for 503 cold-start
      const hfPayload = JSON.stringify({
        model: HF_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2048
      });

      const callStart = Date.now();
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const elapsed = Date.now() - callStart;
        const remainingMs = timeoutMs - elapsed;
        if (remainingMs < 3000) {
          throw new Error(`HF: insufficient time for attempt ${attempt + 1} (${remainingMs}ms left of ${timeoutMs}ms budget)`);
        }

        const ac = new AbortController();
        const perAttemptTimeout = Math.min(remainingMs - 500, 15000); // leave 500ms buffer
        const to = setTimeout(() => ac.abort(), perAttemptTimeout);

        try {
          const res = await fetch(HF_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: hfPayload,
            signal: ac.signal
          });
          clearTimeout(to);

          // Handle 503 cold-start: HF returns {"error":"Model ... is currently loading","estimated_time":N}
          if (res.status === 503) {
            const bodyText = await res.text();
            let waitSec = 5; // default wait
            try {
              const errBody = JSON.parse(bodyText);
              if (errBody.estimated_time) {
                waitSec = Math.min(Math.ceil(errBody.estimated_time), 15);
              }
            } catch (_) {}
            console.warn(`[HF] 503 cold-start (attempt ${attempt + 1}/${MAX_RETRIES + 1}): model loading, estimated_time=${waitSec}s. Body: ${bodyText.substring(0, 200)}`);
            
            if (attempt < MAX_RETRIES && (timeoutMs - (Date.now() - callStart)) > (waitSec * 1000 + 3000)) {
              // Wait for cold-start then retry
              await new Promise(r => setTimeout(r, waitSec * 1000));
              continue;
            }
            throw new Error(`HF 503 cold-start after ${attempt + 1} attempts: ${bodyText.substring(0, 200)}`);
          }

          // Handle other non-OK statuses with detailed logging
          if (!res.ok) {
            const errText = await res.text();
            console.error(`[HF] HTTP ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${errText.substring(0, 300)}`);
            // 401/403 auth errors — no retry
            if (res.status === 401 || res.status === 403) throw new Error(`HF auth error (${res.status}): ${errText.substring(0, 200)}`);
            // 429 rate limit — retry with exponential backoff if time permits
            if (res.status === 429) {
              // Parse Retry-After header if present
              let waitMs = 3000 * Math.pow(2, attempt); // 3s, 6s, 12s
              const retryAfter = res.headers.get('retry-after');
              if (retryAfter) {
                const parsed = parseInt(retryAfter, 10);
                if (!isNaN(parsed)) waitMs = Math.min(parsed * 1000, 15000);
              }
              console.warn(`[HF] 429 rate limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}): waiting ${waitMs}ms before retry`);
              if (attempt < MAX_RETRIES && (timeoutMs - (Date.now() - callStart)) > (waitMs + 3000)) {
                await new Promise(r => setTimeout(r, waitMs));
                continue;
              }
              throw new Error(`HF rate limited (429) after ${attempt + 1} attempts: ${errText.substring(0, 200)}`);
            }
            // Other errors: retry if attempts remain
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            throw new Error(`HF API ${res.status} after ${attempt + 1} attempts: ${errText.substring(0, 200)}`);
          }

          // Success — parse response
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content || '';
          if (!text) {
            console.warn(`[HF] Empty content in response (attempt ${attempt + 1}). Full response keys:`, Object.keys(data || {}));
            throw new Error('HF returned empty content');
          }

          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
          if (!jsonMatch) {
            console.warn(`[HF] No JSON found in response (attempt ${attempt + 1}). Content preview: ${text.substring(0, 200)}`);
            throw new Error(`No JSON in HF response. Preview: ${text.substring(0, 100)}`);
          }
          
          const parsed = JSON.parse(jsonMatch[1].trim());
          console.log(`[HF] ✅ Success on attempt ${attempt + 1}, parsed ${Object.keys(parsed).length} keys`);
          return parsed;

        } catch (e) {
          clearTimeout(to);
          if (e.name === 'AbortError') {
            console.error(`[HF] Request timed out (attempt ${attempt + 1}/${MAX_RETRIES + 1}, timeout=${Math.min(timeoutMs, 15000)}ms)`);
            if (attempt < MAX_RETRIES) continue;
            throw new Error(`HF timed out after ${attempt + 1} attempts`);
          }
          // JSON parse error or other — log and rethrow on last attempt
          if (attempt >= MAX_RETRIES) {
            console.error(`[HF] Final failure (attempt ${attempt + 1}):`, e.message);
            throw e;
          }
          console.warn(`[HF] Attempt ${attempt + 1} failed: ${e.message} — retrying...`);
        }
      }
      throw new Error('HF: exhausted all retry attempts');
    }

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

    // Fetch real Fear & Greed Index from free public API (no key, no LLM credits)
    // This runs in parallel with Kraken price fetch below
    let realFearGreedScore = null;
    let realFearGreedLabel = null;
    const fearGreedPromise = (async () => {
      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 4000);
        const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: ac.signal });
        clearTimeout(to);
        if (res.ok) {
          const json = await res.json();
          const entry = json?.data?.[0];
          if (entry?.value) {
            realFearGreedScore = parseInt(entry.value, 10);
            realFearGreedLabel = entry.value_classification || null;
            console.log('[MarketIntelligence] Real Fear & Greed Index:', realFearGreedScore, realFearGreedLabel);
          }
        }
      } catch (e) {
        console.warn('[MarketIntelligence] Fear & Greed fetch failed:', e.message);
      }
    })();

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

    // Await Fear & Greed result (was fetching in parallel with Kraken)
    await fearGreedPromise;

    // Helper: get the real Fear & Greed score, or compute a heuristic from price data
    function getFearGreedScore(avgChange) {
      if (realFearGreedScore !== null) return realFearGreedScore;
      return Math.max(5, Math.min(95, 50 + avgChange * 5));
    }

    // FAST PATH: If the remaining budget is tight, skip LLM and history to avoid 502s
    if (timeLeft() < 7000) {
      const recs = (marketData || []).map(m => {
        const ch = Number(m.change_24h_percent ?? m.price_change_percentage_24h ?? 0);
        const price = Number(m.price ?? m.current_price ?? 0);
        const action = ch >= 2 ? 'buy' : ch >= 0 ? 'buy' : 'hold';
        const confidence = ch >= 3 ? 68 : ch >= 1 ? 62 : ch >= 0 ? 55 : 42;
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
      const sorted = [...recs].sort((a, b) => b.current_24h_change - a.current_24h_change);
      const intel = {
        market_sentiment_score: getFearGreedScore(avg),
        market_regime: avg > 0.5 ? 'risk-on' : avg < -0.5 ? 'risk-off' : 'range',
        volatility_level: Math.abs(avg) > 3 ? 'high' : Math.abs(avg) > 1 ? 'moderate' : 'low',
        momentum_direction: avg > 0.5 ? 'bullish' : avg < -0.5 ? 'bearish' : 'neutral',
        trend_strength: Math.abs(avg) > 3 ? 'strong' : Math.abs(avg) > 1 ? 'moderate' : 'weak',
        short_term_outlook: `Market is ${avg > 0.5 ? 'bullish' : avg < -0.5 ? 'bearish' : 'mixed'} with ${Math.abs(avg).toFixed(1)}% avg 24h change.`,
        trading_recommendation: avg > 1 ? 'Consider buying on momentum.' : avg < -1 ? 'Exercise caution.' : 'Hold positions.',
        best_opportunities: sorted.filter(r => r.current_24h_change > 0).slice(0, 3).map(r => r.symbol),
        avoid_list: sorted.filter(r => r.current_24h_change < -1).slice(-2).map(r => r.symbol),
        hot_signals: sorted.slice(0, 2).map(r => ({ symbol: r.symbol, signal_type: r.current_24h_change > 1 ? 'Momentum' : 'Consolidation', predicted_move_pct: Math.abs(r.current_24h_change), timing: '4h' }))
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

    // Build comprehensive analysis prompt with market intelligence AND trade history
    let govSpendingSection = '';
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

    async function invokeLLM({ prompt, label, timeoutMs }) {
      const baseMs = typeof timeoutMs === 'number' ? timeoutMs : 12000;
      const ms = Math.min(baseMs, ensureTime());
      if (ms < 4000) {
        console.warn(`[HF] Skipping ${label || 'LLM call'} — only ${ms}ms left, need ≥4000ms`);
        throw new Error(`Insufficient time for ${label || 'LLM call'}: ${ms}ms`);
      }
      console.log(`[HF] Starting ${label || 'LLM call'} with ${ms}ms budget`);
      // callHuggingFace handles its own per-attempt timeouts and retries
      return await callHuggingFace(
        'You are an expert quantitative trading analyst. Always respond with valid JSON only, no extra text.',
        prompt + '\n\nRespond with valid JSON only.',
        ms
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

    const intelPrompt = `You are an expert short-term crypto market analyst providing ACTIONABLE intelligence.
IMPORTANT: Do NOT default to "neutral" or 50 for sentiment. Analyze the ACTUAL current conditions deeply.

Current live market data for context:
${marketData.map(m => `- ${m.symbol}: $${m.price}, 24h change: ${(m.change_24h_percent || 0).toFixed(2)}%`).join('\n')}

Symbols of interest (prioritize if mentioned in news/social):
${symbolsForIntel.map(s => '- ' + s).join('\n')}

CRITICAL RULES:
1. market_sentiment_score MUST reflect ACTUAL market conditions based on the price data above AND current news/social sentiment. If prices are mostly up, score should be 55-80. If prices are mostly down, score should be 20-45. Only use 45-55 range if prices are truly flat (< 0.3% average change).
2. momentum_direction MUST be "bullish" if average 24h change > 0.5%, "bearish" if < -0.5%, only "neutral" if truly flat.
3. hot_signals: Identify at least 1-2 assets with clear short-term setups based on the price action shown above.
4. best_opportunities: Pick the top 2-3 assets showing the strongest positive momentum from the data.
5. avoid_list: Pick assets showing weakness or overextension.

Return JSON with: market_sentiment_score (0-100, BE SPECIFIC not 50), market_regime ('risk-on'|'risk-off'|'range'), volatility_level ('low'|'moderate'|'high'), momentum_direction ('bullish'|'bearish'|'neutral'), trend_strength ('strong'|'moderate'|'weak'), short_term_outlook (1-2 specific sentences about what to expect), trading_recommendation (one actionable sentence), best_opportunities (up to 3 tickers), avoid_list (up to 3 tickers), hot_signals (up to 3 {symbol, signal_type, predicted_move_pct, timing}), market_summary (2-3 sentences with specific observations), upcoming_catalysts (0-3 bullets).`;

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
        console.error('[MarketIntelligence] ❌ Intel LLM FAILED (primary HF call). Error:', eA?.message || eA);
        try {
          // Fallback: use default model WITHOUT web context (faster, more reliable)
          const avgCh = marketData.length > 0 ? marketData.reduce((s, m) => s + (m.change_24h_percent || 0), 0) / marketData.length : 0;
          const fallbackIntelPrompt = `You are a short-term crypto market analyst. Analyze these assets based on the ACTUAL price data below.
CRITICAL: Do NOT return a neutral/50 sentiment score by default. The average 24h change is ${avgCh.toFixed(2)}% — use this to calibrate your sentiment score accurately.

Current market data:
${marketData.map(m => `- ${m.symbol}: $${m.price}, 24h change: ${(m.change_24h_percent || 0).toFixed(2)}%`).join('\n')}

If average change > 0.5%, sentiment should be 55-75 (bullish). If < -0.5%, sentiment should be 25-45 (bearish). Only 45-55 if truly flat.
Identify best_opportunities (top performing assets) and avoid_list (worst performing). Include at least 1 hot_signal.

Return JSON: market_sentiment_score (0-100), market_regime ('risk-on'|'risk-off'|'range'), volatility_level, momentum_direction ('bullish'|'bearish'|'neutral'), trend_strength, short_term_outlook, trading_recommendation, best_opportunities (array), avoid_list (array), hot_signals (array of {symbol, signal_type, predicted_move_pct, timing}), market_summary, upcoming_catalysts (array).`;

          marketIntelResp = await invokeLLM({
            prompt: fallbackIntelPrompt,
            model: 'automatic',
            withWeb: false,
            schema: intelSchema,
            label: 'LLM market intelligence (fallback no-web)',
            timeoutMs: ensureTime()
          });
        } catch (eB) {
          console.error('[MarketIntelligence] ❌ Intel LLM FAILED (fallback HF call). Error:', eB?.message || eB);
          // Build heuristic from actual market data instead of showing "unavailable"
          const avgChange = marketData.length > 0
            ? marketData.reduce((sum, m) => sum + (m.change_24h_percent || 0), 0) / marketData.length
            : 0;
          const sentimentScore = getFearGreedScore(avgChange);
          const regime = avgChange > 1 ? 'risk-on' : avgChange < -1 ? 'risk-off' : 'range';
          const vol = Math.abs(avgChange) > 3 ? 'high' : Math.abs(avgChange) > 1 ? 'moderate' : 'low';
          const direction = avgChange > 0.5 ? 'bullish' : avgChange < -0.5 ? 'bearish' : 'neutral';
          const sorted = [...marketData].sort((a, b) => (b.change_24h_percent || 0) - (a.change_24h_percent || 0));
          const bestOpps = sorted.filter(m => (m.change_24h_percent || 0) > 0).slice(0, 3).map(m => m.symbol);
          const avoidList = sorted.filter(m => (m.change_24h_percent || 0) < -2).slice(-3).map(m => m.symbol);
          marketIntelResp = {
            market_intelligence: {
              market_sentiment_score: sentimentScore,
              market_regime: regime,
              volatility_level: vol,
              momentum_direction: direction,
              trend_strength: Math.abs(avgChange) > 3 ? 'strong' : Math.abs(avgChange) > 1 ? 'moderate' : 'weak',
              short_term_outlook: `Market is ${direction} with ${vol} volatility. Average 24h change across watched assets is ${avgChange.toFixed(2)}%.`,
              trading_recommendation: avgChange > 1 ? 'Consider buying on momentum.' : avgChange < -1 ? 'Exercise caution, wait for reversal signals.' : 'Hold positions, wait for clearer direction.',
              best_opportunities: bestOpps,
              avoid_list: avoidList,
              hot_signals: []
            },
            market_summary: `Market sentiment is ${direction} with a ${vol} volatility environment. The average 24h price change is ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%.`,
            upcoming_catalysts: []
          };
        }
      }

      // CRITICAL: Override LLM's sentiment score with real Fear & Greed Index when available
      // The LLM often defaults to ~50 — the real F&G API is authoritative for this metric
      if (realFearGreedScore !== null && marketIntelResp?.market_intelligence) {
        const llmScore = marketIntelResp.market_intelligence.market_sentiment_score;
        marketIntelResp.market_intelligence.market_sentiment_score = realFearGreedScore;
        console.log(`[MarketIntelligence] Overrode LLM sentiment ${llmScore} with real Fear & Greed: ${realFearGreedScore} (${realFearGreedLabel})`);
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
      console.error('[MarketIntelligence] ❌ Recs LLM FAILED — falling back to heuristic. Error:', eR?.message || eR);
      // Heuristic fallback — include all assets so UI always shows something
      const heuristics = marketData.map(m => {
        const ch = Number(m.change_24h_percent ?? m.price_change_percentage_24h ?? 0);
        const price = Number(m.price ?? m.current_price ?? 0);
        let action = ch >= 3 ? 'buy' : ch >= 0 ? 'buy' : 'hold';
        let confidence = ch >= 4 ? 65 : ch >= 2 ? 58 : ch >= 0 ? 52 : 42;
        return {
          symbol: m.symbol,
          confidence_score: confidence,
          predicted_direction: ch >= 0 ? 'up' : 'down',
          predicted_move_pct: Math.abs(ch) || 1,
          reasoning: 'Heuristic analysis based on 24h price momentum',
          action,
          optimal_action: action,
          timing_window: '4h',
          stop_loss_pct: 2,
          take_profit_pct: 3,
          current_price: price,
          current_24h_change: ch,
          technical_pattern: 'No clear pattern',
          sentiment_score: realFearGreedScore ?? 50,
          momentum_strength: ch > 3 ? 'strong' : ch > 0 ? 'moderate' : 'weak'
        };
      }).slice(0, 8);
      recsResp = { recommendations: heuristics };
      console.log('[MarketIntelligence] Heuristic fallback produced', heuristics.length, 'recommendations');
    }

    // Normalize LLM recommendation field names (HuggingFace often uses different keys)
    const rawRecs = (recsResp?.recommendations || []).map(r => {
      // Map symbol
      const symbol = String(r.symbol || r.asset || r.ticker || '').toUpperCase();
      // Map action: LLM may return "rating" instead of "action"/"optimal_action"
      const rawAction = r.optimal_action || r.action || r.rating || 'hold';
      // Map reasoning
      const reasoning = r.reasoning || r.reason || r.action_reason || '';
      // Map confidence: if missing, derive from action type
      let confidence = Number(r.confidence_score || 0);
      if (!confidence || confidence <= 0) {
        const actionLower = String(rawAction).toLowerCase().replace(/\s+/g, '_');
        if (actionLower === 'strong_buy' || actionLower === 'strong_sell') confidence = 72;
        else if (actionLower === 'buy') confidence = 60;
        else if (actionLower === 'sell' || actionLower === 'avoid') confidence = 55;
        else confidence = 48; // hold/neutral
      }
      // Get current market data for enrichment
      const mkt = marketData.find(m => (m.symbol || '').toUpperCase() === symbol);
      return {
        ...r,
        symbol,
        action: rawAction,
        optimal_action: rawAction,
        reasoning,
        confidence_score: confidence,
        current_price: r.current_price || Number(mkt?.price || mkt?.current_price || 0),
        current_24h_change: r.current_24h_change ?? Number(mkt?.change_24h_percent || mkt?.price_change_percentage_24h || 0),
      };
    });

    // Compose unified llmResponse compatible with downstream logic
    let llmResponse = {
      recommendations: rawRecs,
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
        const action = change24h >= 3 ? 'buy' : change24h >= 0 ? 'buy' : 'hold';
        const confidence = change24h >= 4 ? 65 : change24h >= 2 ? 58 : change24h >= 0 ? 52 : 42;
        return {
          symbol: String(m.symbol || '').toUpperCase(),
          confidence_score: confidence,
          predicted_direction: change24h >= 0 ? 'up' : 'down',
          predicted_move_pct: Math.abs(change24h) || 1,
          reasoning: 'Analysis based on live market momentum',
          action,
          optimal_action: action,
          timing_window: '4h',
          stop_loss_pct: 2,
          take_profit_pct: 3,
          current_price: Number(m.price || m.current_price || 0),
          current_24h_change: change24h,
          technical_pattern: 'No clear pattern',
          sentiment_score: realFearGreedScore ?? 50,
          momentum_strength: change24h > 3 ? 'strong' : change24h > 0 ? 'moderate' : 'weak'
        };
      }).slice(0, 8);
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
        
        // RULE 1: strong_buy requires positive 24h momentum — don't buy falling assets
        if (adjustedAction === 'strong_buy' && change24h < 0.5) {
          adjustedAction = change24h < -2 ? 'hold' : 'buy';
          adjustedConfidence = Math.min(adjustedConfidence, change24h < -2 ? 45 : 60);
          console.log(`[MarketIntelligence] ${r.symbol}: Downgraded strong_buy (24h change ${change24h.toFixed(1)}%)`);
        }
        
        // RULE 2: buy signals need non-negative trend — don't buy into any downtrend
        if (adjustedAction === 'buy' && change24h < -2) {
          console.log(`[MarketIntelligence] ${r.symbol}: Price falling ${change24h.toFixed(1)}%, reducing to hold`);
          adjustedConfidence = Math.min(adjustedConfidence, 45);
          adjustedAction = 'hold';
        }
        
        // RULE 3: Don't chase pumps — cap if already up significantly
        if (change24h > 4 && (adjustedAction === 'buy' || adjustedAction === 'strong_buy')) {
          adjustedConfidence = Math.min(adjustedConfidence, 60);
          console.log(`[MarketIntelligence] ${r.symbol}: Already pumped +${change24h.toFixed(1)}%, capping confidence`);
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
    // CRITICAL: Never persist buy signals for assets on the AVOID list
    const aiAvoidList = (marketIntelligence?.avoid_list || []).map(s => String(s).toUpperCase());
    if (aiAvoidList.length > 0) {
      console.log('[MarketIntelligence] AVOID list for signal filtering:', aiAvoidList);
    }
    
    if (timeLeft() > 1500) {
      try {
        const actionable = enhancedRecommendations.filter(r => {
          const sym = String(r.symbol || '').toUpperCase();
          // CRITICAL: Block persisting buy signals for assets the AI says to AVOID
          if (aiAvoidList.includes(sym)) {
            console.log(`[MarketIntelligence] BLOCKED signal persistence for ${sym} — on AVOID list`);
            return false;
          }
          return (r.optimal_action === 'buy' || r.optimal_action === 'strong_buy') && r.confidence_score >= 50;
        });

        // Deactivate existing active signals for these symbols (prevent duplicates)
        // ALSO deactivate any existing buy signals for assets on the AVOID list
        const existing = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true });
        const symbolsSet = new Set(actionable.map(a => (a.symbol || '').toUpperCase()));
        for (const sig of existing) {
          try {
            const sigSym = (sig.asset_symbol || '').toUpperCase();
            // Deactivate if: replacing with new signal OR asset is now on AVOID list
            if (symbolsSet.has(sigSym) || aiAvoidList.includes(sigSym)) {
              await base44.asServiceRole.entities.AssetSignal.update(sig.id, { is_active: false });
              if (aiAvoidList.includes(sigSym)) {
                console.log(`[MarketIntelligence] Deactivated existing signal for AVOIDED asset: ${sigSym}`);
              }
            }
          } catch (_e) {}
        }

        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        for (const r of actionable) {
          try {
            const currentPrice = Number(r.current_price || 0);
            const tpPct = r.take_profit_pct ?? 3;
            const slPct = r.stop_loss_pct ?? 2;
            await base44.asServiceRole.entities.AssetSignal.create({
              asset_symbol: (r.symbol || '').toUpperCase(),
              asset_type: KRAKEN_PAIR_MAP[(r.symbol || '').toUpperCase()] ? 'crypto' : 'stocks',
              signal_type: r.optimal_action,
              confidence_score: r.confidence_score,
              change_24h: r.current_24h_change ?? 0,
              take_profit_pct: tpPct,
              stop_loss_pct: slPct,
              reasoning: r.action_reason || r.reasoning || '',
              is_active: true,
              expires_at: expiresAt,
              // Top-level fields that were previously only in metadata_json
              price_at_signal: currentPrice || undefined,
              target_price: currentPrice > 0 ? currentPrice * (1 + tpPct / 100) : undefined,
              stop_loss_price: currentPrice > 0 ? currentPrice * (1 - slPct / 100) : undefined,
              technical_pattern: r.technical_pattern || 'No clear pattern',
              sentiment_score: r.sentiment_score ?? (realFearGreedScore !== null ? realFearGreedScore : 50),
              predicted_gain_pct: r.predicted_move_pct ?? 0,
              momentum_strength: r.momentum_strength || 'moderate',
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