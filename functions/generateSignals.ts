import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * AI SIGNAL GENERATOR v3
 * 
 * Runs independently on schedule to generate AssetSignal entries.
 * Decouples AI analysis from trade execution.
 * 
 * FIXES from v2:
 * - Uses user-scoped functions.invoke for getMarketData (was 403 with asServiceRole)
 * - Stores rich signal data: entry zones, momentum, TP/SL, timing
 * - Stores 24h change so prospects can filter without re-fetching
 * - Falls back gracefully when market data is unavailable
 */

const SIGNAL_TTL_HOURS = 2; // Shorter TTL for fresher signals

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    
    if (!isAdmin && !isCreator) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    
    const body = await req.json().catch(() => ({}));
    const { symbols = [], forceRefresh = false } = body;
    
    console.log('[generateSignals] Starting for', symbols.length || 'all', 'symbols');
    
    // Get all active AutoBuyPreferences to determine which assets to analyze
    let assetsToAnalyze = [];
    
    if (symbols.length > 0) {
      assetsToAnalyze = symbols.map(s => ({ symbol: s.toUpperCase(), asset_type: 'crypto' }));
    } else {
      const allPrefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({
        enabled: true
      });
      
      const seen = new Set();
      for (const pref of allPrefs) {
        const sym = (pref.symbol || '').toUpperCase();
        if (sym && !seen.has(sym)) {
          seen.add(sym);
          assetsToAnalyze.push({
            symbol: sym,
            asset_type: pref.asset_type || 'crypto'
          });
        }
      }
    }
    
    if (assetsToAnalyze.length === 0) {
      return Response.json({
        success: true,
        signals_generated: 0,
        message: 'No assets to analyze'
      });
    }
    
    console.log('[generateSignals] Analyzing', assetsToAnalyze.length, 'assets');
    
    // Check for existing valid signals (skip if not expired and not forceRefresh)
    const now = new Date();
    const existingSignals = await base44.asServiceRole.entities.AssetSignal.filter({
      is_active: true
    });
    
    const validSignals = new Map();
    for (const sig of existingSignals) {
      if (!forceRefresh && sig.expires_at && new Date(sig.expires_at) > now) {
        validSignals.set(sig.asset_symbol, sig);
      }
    }
    
    const assetsNeedingAnalysis = assetsToAnalyze.filter(a => !validSignals.has(a.symbol));
    
    console.log('[generateSignals]', validSignals.size, 'valid signals exist,', assetsNeedingAnalysis.length, 'need analysis');
    
    if (assetsNeedingAnalysis.length === 0) {
      return Response.json({
        success: true,
        signals_generated: 0,
        signals_reused: validSignals.size,
        message: 'All signals still valid'
      });
    }
    
    // Fetch market data - use Kraken public API directly (no auth needed, avoids 403)
    const cryptoSymbols = assetsNeedingAnalysis.filter(a => a.asset_type === 'crypto').map(a => a.symbol);
    const stockSymbols = assetsNeedingAnalysis.filter(a => a.asset_type === 'stock').map(a => a.symbol);
    
    let marketData = [];
    try {
      // Use Kraken public Ticker API directly - no auth required
      const krakenPairMap = {
        'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
        'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
        'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
        'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
        'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'HBAR': 'HBARUSD'
      };
      
      const pairs = cryptoSymbols.map(s => krakenPairMap[s]).filter(Boolean);
      if (pairs.length > 0) {
        const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.result) {
            for (const sym of cryptoSymbols) {
              const pair = krakenPairMap[sym];
              const ticker = data.result[pair];
              if (ticker) {
                const price = parseFloat(ticker.c?.[0] || '0');
                const open24h = parseFloat(ticker.o || '0');
                const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
                marketData.push({
                  symbol: sym,
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
      console.log('[generateSignals] Got market data for', marketData.length, 'symbols via Kraken public API');
    } catch (e) {
      console.error('[generateSignals] Market data fetch failed:', e.message);
    }
    
    // Build market context string for direct LLM call
    const assetsSection = marketData.length > 0 
      ? marketData.map(a => `- ${a.symbol}: Price: $${a.price}, 24h Change: ${(a.change_24h_percent || 0).toFixed(2)}%`).join('\n')
      : cryptoSymbols.map(s => `- ${s}: (analyze based on your current knowledge)`).join('\n');
    
    // Call LLM directly instead of going through analyzeSmallGains (avoids 403)
    let aiRecommendations = [];
    try {
      console.log('[generateSignals] Calling LLM for analysis...');
      const llmResponse = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an elite quantitative trading analyst. Analyze these assets for SHORT-TERM (1-6 hour) trading opportunities.

ASSETS:
${assetsSection}

For each asset provide: optimal_action (strong_buy/buy/hold/sell/strong_sell), confidence_score (0-100, only 70%+ for strong signals), 
entry_zone_low, entry_zone_high, stop_loss_pct (1-3%), take_profit_pct (2-5%), momentum_strength (strong/moderate/weak), 
timing_window (1h/2h/4h/6h), predicted_gain_percent, sentiment_score (0-100), reasoning, technical_pattern.

Be CONSERVATIVE with strong_buy - only when momentum is clearly positive and multiple indicators align.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  optimal_action: { type: "string" },
                  confidence_score: { type: "number" },
                  entry_zone_low: { type: "number" },
                  entry_zone_high: { type: "number" },
                  stop_loss_pct: { type: "number" },
                  take_profit_pct: { type: "number" },
                  momentum_strength: { type: "string" },
                  timing_window: { type: "string" },
                  predicted_gain_percent: { type: "number" },
                  sentiment_score: { type: "number" },
                  reasoning: { type: "string" },
                  technical_pattern: { type: "string" },
                  volume_profile: { type: "string" },
                  correlation_group: { type: "string" }
                }
              }
            }
          }
        }
      });
      
      aiRecommendations = llmResponse?.recommendations || [];
      console.log('[generateSignals] Got', aiRecommendations.length, 'AI recommendations');
    } catch (e) {
      console.error('[generateSignals] AI analysis failed:', e.message);
    }
    
    // Create signal map from AI recommendations
    const aiMap = new Map();
    for (const rec of aiRecommendations) {
      const sym = (rec.symbol || '').toUpperCase();
      if (sym) aiMap.set(sym, rec);
    }
    
    // Generate signals with RICH data
    const signalsCreated = [];
    const expiresAt = new Date(Date.now() + SIGNAL_TTL_HOURS * 60 * 60 * 1000).toISOString();
    
    for (const asset of assetsNeedingAnalysis) {
      const aiRec = aiMap.get(asset.symbol);
      const quote = marketData.find(q => (q.symbol || '').toUpperCase() === asset.symbol);
      const change24h = quote?.change_24h_percent || quote?.price_change_percentage_24h || 0;
      
      let signalType = 'hold';
      let confidence = 50;
      let reasoning = 'Insufficient data for analysis';
      
      if (aiRec) {
        const action = (aiRec.optimal_action || aiRec.action || 'hold').toLowerCase();
        
        if (action === 'strong_buy') signalType = 'strong_buy';
        else if (action === 'buy') signalType = 'buy';
        else if (action === 'sell') signalType = 'sell';
        else if (action === 'strong_sell') signalType = 'strong_sell';
        else signalType = 'hold';
        
        const rawConf = aiRec.confidence_score || aiRec.confidence || 50;
        confidence = rawConf <= 1 ? rawConf * 100 : rawConf;
        confidence = Math.max(0, Math.min(100, confidence));
        
        reasoning = aiRec.reasoning || 'AI analysis complete';
      }
      
      const existingSignal = existingSignals.find(s => s.asset_symbol === asset.symbol);
      
      const signalData = {
        asset_symbol: asset.symbol,
        asset_type: asset.asset_type,
        timeframe: '4h',
        signal_type: signalType,
        confidence_score: Math.round(confidence),
        reasoning,
        technical_pattern: aiRec?.technical_pattern || null,
        sentiment_score: aiRec?.sentiment_score || 50,
        price_at_signal: quote?.price || quote?.current_price || 0,
        target_price: aiRec?.target_price || null,
        stop_loss_price: aiRec?.stop_loss_price || null,
        // NEW rich fields
        entry_zone_low: aiRec?.entry_zone_low || null,
        entry_zone_high: aiRec?.entry_zone_high || null,
        take_profit_pct: aiRec?.take_profit_pct || null,
        stop_loss_pct: aiRec?.stop_loss_pct || null,
        momentum_strength: aiRec?.momentum_strength || null,
        timing_window: aiRec?.timing_window || null,
        predicted_gain_pct: aiRec?.predicted_gain_percent || aiRec?.predicted_move_pct || null,
        change_24h: change24h,
        expires_at: expiresAt,
        is_active: true,
        metadata_json: JSON.stringify({
          generated_at: now.toISOString(),
          market_trend: change24h,
          volume_24h: quote?.volume_24h || 0,
          volume_profile: aiRec?.volume_profile || null,
          correlation_group: aiRec?.correlation_group || null,
          historical_win_rate: aiRec?.historical_win_rate || null,
          historical_avg_gain: aiRec?.historical_avg_gain || null,
          auto_tradeable: aiRec?.auto_tradeable || false
        })
      };
      
      try {
        if (existingSignal) {
          await base44.asServiceRole.entities.AssetSignal.update(existingSignal.id, signalData);
          signalsCreated.push({ ...signalData, id: existingSignal.id, action: 'updated' });
        } else {
          const newSignal = await base44.asServiceRole.entities.AssetSignal.create(signalData);
          signalsCreated.push({ ...signalData, id: newSignal.id, action: 'created' });
        }
        console.log(`[generateSignals] ${asset.symbol}: ${signalType} @ ${confidence}% (24h: ${change24h.toFixed(1)}%)`);
      } catch (e) {
        console.error(`[generateSignals] Failed to save signal for ${asset.symbol}:`, e.message);
      }
    }
    
    // Expire old signals
    try {
      const expiredSignals = existingSignals.filter(s => 
        s.expires_at && new Date(s.expires_at) <= now && s.is_active
      );
      for (const sig of expiredSignals) {
        await base44.asServiceRole.entities.AssetSignal.update(sig.id, { is_active: false });
      }
      if (expiredSignals.length > 0) {
        console.log('[generateSignals] Expired', expiredSignals.length, 'old signals');
      }
    } catch (e) {
      console.warn('[generateSignals] Could not expire old signals:', e.message);
    }
    
    const duration = Date.now() - startTime;
    console.log('[generateSignals] Complete:', signalsCreated.length, 'signals in', duration, 'ms');
    
    return Response.json({
      success: true,
      signals_generated: signalsCreated.length,
      signals_reused: validSignals.size,
      signals: signalsCreated.map(s => ({
        symbol: s.asset_symbol,
        signal_type: s.signal_type,
        confidence: s.confidence_score,
        change_24h: s.change_24h,
        momentum: s.momentum_strength,
        action: s.action
      })),
      duration_ms: duration
    });
    
  } catch (error) {
    console.error('[generateSignals] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});