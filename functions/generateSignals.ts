import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * AI SIGNAL GENERATOR
 * 
 * Runs independently on schedule to generate AssetSignal entries.
 * Decouples AI analysis from trade execution.
 * 
 * This function:
 * 1. Fetches market data for configured assets
 * 2. Runs AI analysis (via InvokeLLM)
 * 3. Creates/updates AssetSignal entries
 * 4. Sets expiration times on signals
 * 
 * The auto-trader then CONSUMES these pre-computed signals
 * rather than calling AI directly during execution.
 */

const SIGNAL_TTL_HOURS = 4; // Signals expire after 4 hours

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Only admin/creator can generate signals
    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    
    if (!isAdmin && !isCreator) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    
    const body = await req.json().catch(() => ({}));
    const { symbols = [], forceRefresh = false } = body;
    
    console.log('[generateSignals] Starting signal generation for', symbols.length || 'all', 'symbols');
    
    // Get all active AutoBuyPreferences to determine which assets to analyze
    let assetsToAnalyze = [];
    
    if (symbols.length > 0) {
      assetsToAnalyze = symbols.map(s => ({ symbol: s.toUpperCase(), asset_type: 'crypto' }));
    } else {
      // Get all unique preferences across all users
      const allPrefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({
        enabled: true
      });
      
      // Deduplicate by symbol
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
    
    // Filter out assets with valid signals
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
    
    // Fetch market data
    const cryptoSymbols = assetsNeedingAnalysis
      .filter(a => a.asset_type === 'crypto')
      .map(a => a.symbol);
    const stockSymbols = assetsNeedingAnalysis
      .filter(a => a.asset_type === 'stock')
      .map(a => a.symbol);
    
    let marketData = [];
    try {
      const mdResponse = await base44.asServiceRole.functions.invoke('getMarketData', {
        action: 'getWatchlistData',
        payload: { cryptoSymbols, stockSymbols }
      });
      marketData = mdResponse?.data || [];
    } catch (e) {
      console.error('[generateSignals] Market data fetch failed:', e.message);
    }
    
    // Run AI analysis with broader market context
    let aiRecommendations = [];
    try {
      const aiResponse = await base44.asServiceRole.functions.invoke('analyzeSmallGains', {
        symbols: assetsNeedingAnalysis.map(a => a.symbol),
        includeMarketIntelligence: true,
        includeMarketContext: true // Enhanced: ask AI to factor overall market sentiment
      });
      const aiData = aiResponse?.data || aiResponse;
      aiRecommendations = aiData?.recommendations || [];
      
      // Log market context if provided
      if (aiData?.market_context) {
        console.log('[generateSignals] Market context:', aiData.market_context);
      }
    } catch (e) {
      console.error('[generateSignals] AI analysis failed:', e.message);
    }
    
    // Create signal map from AI recommendations
    const aiMap = new Map();
    for (const rec of aiRecommendations) {
      const sym = (rec.symbol || '').toUpperCase();
      if (sym) aiMap.set(sym, rec);
    }
    
    // Generate signals
    const signalsCreated = [];
    const expiresAt = new Date(Date.now() + SIGNAL_TTL_HOURS * 60 * 60 * 1000).toISOString();
    
    for (const asset of assetsNeedingAnalysis) {
      const aiRec = aiMap.get(asset.symbol);
      const quote = marketData.find(q => q.symbol === asset.symbol);
      
      // Determine signal type
      let signalType = 'hold';
      let confidence = 50;
      let reasoning = 'Insufficient data for analysis';
      
      if (aiRec) {
        const action = (aiRec.optimal_action || aiRec.action || 'hold').toLowerCase();
        
        // Map AI action to signal type
        if (action === 'strong_buy') signalType = 'strong_buy';
        else if (action === 'buy') signalType = 'buy';
        else if (action === 'sell') signalType = 'sell';
        else if (action === 'strong_sell') signalType = 'strong_sell';
        else signalType = 'hold';
        
        // Normalize confidence (AI may return 0-1 or 0-100)
        const rawConf = aiRec.confidence_score || aiRec.confidence || 50;
        confidence = rawConf <= 1 ? rawConf * 100 : rawConf;
        confidence = Math.max(0, Math.min(100, confidence));
        
        reasoning = aiRec.reasoning || 'AI analysis complete';
      }
      
      // Check for existing signal to update
      const existingSignal = existingSignals.find(s => s.asset_symbol === asset.symbol);
      
      const signalData = {
        asset_symbol: asset.symbol,
        asset_type: asset.asset_type,
        timeframe: '1d',
        signal_type: signalType,
        confidence_score: Math.round(confidence),
        reasoning,
        technical_pattern: aiRec?.technical_pattern || null,
        sentiment_score: aiRec?.sentiment_score || 50,
        price_at_signal: quote?.price || 0,
        target_price: aiRec?.target_price || null,
        stop_loss_price: aiRec?.stop_loss_price || null,
        expires_at: expiresAt,
        is_active: true,
        metadata_json: JSON.stringify({
          generated_at: now.toISOString(),
          market_trend: quote?.changePct || 0,
          volume_24h: quote?.volume_24h || 0
        })
      };
      
      try {
        if (existingSignal) {
          // Update existing
          await base44.asServiceRole.entities.AssetSignal.update(existingSignal.id, signalData);
          signalsCreated.push({ ...signalData, id: existingSignal.id, action: 'updated' });
        } else {
          // Create new
          const newSignal = await base44.asServiceRole.entities.AssetSignal.create(signalData);
          signalsCreated.push({ ...signalData, id: newSignal.id, action: 'created' });
        }
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
      
      console.log('[generateSignals] Expired', expiredSignals.length, 'old signals');
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
        action: s.action
      })),
      duration_ms: duration
    });
    
  } catch (error) {
    console.error('[generateSignals] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});