import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Kraken pair mappings for public API
const KRAKEN_PAIR_MAP = {
  'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
  'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
  'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
  'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
  'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'HBAR': 'HBARUSD'
};

/**
 * AUTO-TRADER PROSPECTS v3
 * 
 * ARCHITECTURE CHANGE: Now consumes pre-computed AssetSignal entries
 * instead of calling AI directly. This makes prospect generation:
 * - Faster (no LLM call during prospect generation)
 * - More consistent (all consumers see same signal)
 * - More robust (works even if AI is temporarily unavailable)
 * 
 * PROFITABILITY FIXES:
 * - Uses AI-recommended TP/SL from signals (not just user defaults)
 * - Requires positive momentum from signal's stored 24h change
 * - Entry zone awareness: only recommends when price is within AI entry zone
 * - Lowered filters: "buy" + 60% confidence = prospect (not just strong_buy)
 *   (strong_buy is still required for AUTO-EXECUTION in runAutoTrader)
 * - Removes the +2% momentum gate that was filtering out nearly everything
 */

Deno.serve(async (req) => {
  try {
    console.log('[Prospects] START');
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      console.log('[Prospects] No user found - unauthorized');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Prospects] User:', user.email);
    
    // Load user settings
    const allSettingsRecords = await base44.entities.UserSettings.filter({ 
      created_by: user.email 
    });
    
    let rawRecord = null;
    if (allSettingsRecords && allSettingsRecords.length > 0) {
      allSettingsRecords.sort((a, b) => {
        const dateA = new Date(a.updated_date || a.created_date || 0);
        const dateB = new Date(b.updated_date || b.created_date || 0);
        return dateB - dateA;
      });
      rawRecord = allSettingsRecords[0];
    }
    
    const parseNum = (v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
      return undefined;
    };
    const gain = parseNum(rawRecord?.gain_margin);
    const loss = parseNum(rawRecord?.loss_margin);
    
    const settings = {
      sim_trading_mode: rawRecord?.sim_trading_mode !== undefined ? rawRecord.sim_trading_mode : true,
      auto_trading_enabled: rawRecord?.auto_trading_enabled !== undefined ? rawRecord.auto_trading_enabled : false,
      gain_margin: typeof gain === 'number' ? Math.abs(gain) : 3,
      loss_margin: typeof loss === 'number' ? Math.abs(loss) : 1,
      trailing_takeprofit_enabled: rawRecord?.trailing_takeprofit_enabled !== undefined ? rawRecord.trailing_takeprofit_enabled : true,
      trailing_takeprofit_margin: rawRecord?.trailing_takeprofit_margin !== undefined ? rawRecord.trailing_takeprofit_margin : 3,
    };
    
    console.log('[Prospects] Settings - gain:', settings.gain_margin, '% loss:', settings.loss_margin, '%');

    // Get Kraken balance (LIVE mode only)
    // CRITICAL: Use the Kraken API directly via krakenApi function (which handles auth internally)
    // getKrakenBalance wraps krakenApi and needs user context, so invoke it with the user's own token
    let cashAvailable = 0;
    let totalOpenOrdersValue = 0;
    try {
      console.log('[Prospects] Fetching Kraken extended balance directly...');
      
      // DIRECT Kraken API call: look up user's KrakenConnection and call Kraken BalanceEx ourselves
      // This avoids function-to-function invocation auth issues entirely
      const krakenConns = await base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }, '-updated_date', 1);
      
      if (krakenConns.length > 0) {
        const conn = krakenConns[0];
        const balKey = (conn.balance_api_key || conn.api_key || '').trim();
        const balSecret = (conn.balance_api_secret_encrypted || conn.api_secret_encrypted || '').trim();
        
        if (balKey && balSecret) {
          // Call Kraken BalanceEx API directly
          const extBalData = await callKrakenDirect(balKey, balSecret, '/0/private/BalanceEx', {});
          console.log('[Prospects] Kraken BalanceEx success:', !!extBalData?.result);
          
          if (extBalData?.result) {
            const rawBalances = extBalData.result;
            // Find USD balance
            const usdEntry = rawBalances['ZUSD'] || rawBalances['USD'];
            const rawAvailable = parseFloat(typeof usdEntry === 'object' ? usdEntry.balance : (usdEntry || 0));
            console.log('[Prospects] Kraken raw USD available:', rawAvailable);
            
            // Also check open orders to deduct reserved capital
            try {
              const ordersResult = await callKrakenDirect(balKey, balSecret, '/0/private/OpenOrders', { trades: true });
              const openOrders = [];
              if (ordersResult?.result?.open) {
                for (const [, order] of Object.entries(ordersResult.result.open)) {
                  openOrders.push(order);
                }
              }
          const ordersData = ordersRes?.data || ordersRes;
          if (ordersData?.success && Array.isArray(ordersData?.orders)) {
            totalOpenOrdersValue = ordersData.orders
              .filter(o => (o.descr?.type || o.side || '').toLowerCase() === 'buy')
              .reduce((sum, o) => {
                const orderCost = Number(o.vol || 0) * Number(o.descr?.price || o.price || 0);
                return sum + orderCost;
              }, 0);
          }
        } catch (ordersErr) {
          console.warn('[Prospects] Could not fetch open orders:', ordersErr.message);
        }
        
        const safetyBuffer = rawAvailable * 0.15;
        cashAvailable = Math.max(0, rawAvailable - totalOpenOrdersValue - safetyBuffer);
        
        console.log('[Prospects] Cash: raw', rawAvailable, '- orders', totalOpenOrdersValue, '- buffer', safetyBuffer.toFixed(2), '= effective', cashAvailable.toFixed(2));
        
        if (cashAvailable < 5) {
          return Response.json({
            success: true,
            prospects: [],
            cash_available: cashAvailable,
            raw_kraken_balance: rawAvailable,
            is_sim_mode: false,
            auto_trading_enabled: settings?.auto_trading_enabled || false,
            total_analyzed: 0,
            market_intelligence: null,
            user_settings: { gain_margin: settings.gain_margin, loss_margin: settings.loss_margin },
            message: `Insufficient cash ($${cashAvailable.toFixed(2)} after fees/buffer). Need at least $5.`
          });
        }
      } else {
        console.warn('[Prospects] Kraken extended balance failed or not connected:', extBalData?.error);
      }
    } catch (e) {
      console.error('[Prospects] Kraken balance fetch failed:', e?.message || e);
    }
    
    console.log('[Prospects] Cash available after Kraken:', cashAvailable);
    
    const isSimMode = false; // Force LIVE mode for prospects

    // Get auto-buy preferences
    let allPrefs = await base44.entities.AutoBuyPreference.filter({}, "-created_date", 50);
    
    let prefs = allPrefs.filter(p => {
      const pIsSimulation = p.is_simulation === true || p.is_simulation === 'true';
      const pEnabled = p.enabled !== false;
      const matchesSim = isSimMode === pIsSimulation;
      return matchesSim && pEnabled;
    });

    if (prefs.length === 0) {
      return Response.json({
        success: true,
        prospects: [],
        cash_available: cashAvailable,
        is_sim_mode: isSimMode,
        auto_trading_enabled: settings?.auto_trading_enabled || false,
        total_analyzed: 0,
        market_intelligence: null,
        user_settings: { gain_margin: settings.gain_margin, loss_margin: settings.loss_margin },
        message: "No assets configured. Please add assets to your watchlist in Portfolio settings."
      });
    }

    // Get current holdings
    const holdings = await base44.entities.Holding.filter({ 
      is_simulation: isSimMode
    });

    // CORE CHANGE: Consume pre-computed AssetSignal entries instead of calling AI
    console.log('[Prospects] Loading pre-computed AssetSignal entries...');
    let signals = [];
    try {
      signals = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true });
      const now = new Date();
      signals = signals.filter(s => !s.expires_at || new Date(s.expires_at) > now);
      console.log('[Prospects] Found', signals.length, 'active signals');
    } catch (e) {
      console.error('[Prospects] Failed to fetch signals:', e.message);
    }
    
    // Build signal lookup map
    const signalMap = new Map();
    for (const sig of signals) {
      signalMap.set(sig.asset_symbol, sig);
    }
    
    // If no signals exist, trigger generation and wait briefly
    if (signals.length === 0) {
      console.log('[Prospects] No signals found - triggering generation...');
      try {
        const symbolsToGenerate = prefs.map(p => (p.symbol || '').toUpperCase()).filter(Boolean);
        await base44.functions.invoke('generateSignals', { 
          symbols: symbolsToGenerate, 
          forceRefresh: true 
        });
        
        // Re-fetch signals after generation
        signals = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true });
        const now = new Date();
        signals = signals.filter(s => !s.expires_at || new Date(s.expires_at) > now);
        for (const sig of signals) {
          signalMap.set(sig.asset_symbol, sig);
        }
        console.log('[Prospects] Generated and loaded', signals.length, 'signals');
      } catch (genErr) {
        console.error('[Prospects] Signal generation failed:', genErr.message);
      }
    }
    
    // Fetch current prices - use Kraken public API directly (no auth needed)
    const cryptoSymbols = prefs.filter(p => p.asset_type === "crypto").map(p => String(p.symbol || "").toUpperCase().trim());
    const stockSymbols = prefs.filter(p => p.asset_type === "stock").map(p => String(p.symbol || "").toUpperCase().trim());
    
    let quotes = [];
    
    // Primary: Kraken public Ticker (no auth, no rate limit issues)
    try {
      const pairs = cryptoSymbols.map(s => KRAKEN_PAIR_MAP[s]).filter(Boolean);
      if (pairs.length > 0) {
        const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.result) {
            for (const sym of cryptoSymbols) {
              const pair = KRAKEN_PAIR_MAP[sym];
              const ticker = data.result[pair];
              if (ticker) {
                const price = parseFloat(ticker.c?.[0] || '0');
                const open24h = parseFloat(ticker.o || '0');
                const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
                quotes.push({
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
      console.log('[Prospects] Got', quotes.length, 'prices via Kraken public API');
    } catch (e) {
      console.warn('[Prospects] Kraken public API failed:', e.message);
    }
    
    // Fallback: try getMarketData if Kraken public didn't work
    if (quotes.length === 0) {
      try {
        const marketDataResponse = await base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { cryptoSymbols, stockSymbols }
        });
        quotes = Array.isArray(marketDataResponse?.data) ? marketDataResponse.data : [];
      } catch (e) {
        console.warn('[Prospects] getMarketData fallback failed:', e.message);
      }
    }

    // Build prospect list from signals + preferences
    const prospects = [];
    const safetyMaxPct = 0.40;
    
    for (const pref of prefs) {
      const symbol = (pref.symbol || "").toUpperCase();
      const quote = quotes.find(q => (q.symbol || '').toUpperCase() === symbol);
      const price = quote?.price || quote?.current_price || 0;
      
      if (!price || price <= 0) {
        console.log('[Prospects] No price for', symbol);
        continue;
      }

      // Get pre-computed signal for this asset
      const signal = signalMap.get(symbol);
      
      if (!signal) {
        console.log('[Prospects] No signal for', symbol, '- skipping');
        continue;
      }
      
      const signalType = (signal.signal_type || 'hold').toLowerCase();
      const confidence = signal.confidence_score || 50;
      const change24h = signal.change_24h || quote?.change_24h_percent || quote?.price_change_percentage_24h || 0;
      
      // PROFITABILITY FILTER: Show prospects for "buy" and "strong_buy" signals
      // (runAutoTrader still requires strong_buy for auto-execution)
      if (signalType !== 'buy' && signalType !== 'strong_buy') {
        console.log('[Prospects] Skipping', symbol, '- signal is', signalType);
        continue;
      }
      
      // Require minimum 50% confidence for any prospect
      if (confidence < 50) {
        console.log('[Prospects] Skipping', symbol, '- confidence too low:', confidence);
        continue;
      }
      
      // REMOVED the +2% momentum gate - it was filtering out nearly everything
      // Instead, just skip if price is crashing hard (> -5% in 24h)
      if (change24h < -5) {
        console.log('[Prospects] Skipping', symbol, '- price crashing:', change24h.toFixed(1), '%');
        continue;
      }

      const holding = holdings.find(h => (h.symbol || "").toUpperCase() === symbol);
      
      // Calculate order size
      const userAllocationPct = Number(pref.percentage) || 10;
      const userPct = userAllocationPct / 100;
      let total = cashAvailable * userPct;
      
      const safetyMax = cashAvailable * safetyMaxPct;
      if (total > safetyMax) total = safetyMax;
      
      if (holding) {
        total = total * 0.7; // 30% reduction for existing positions
      }
      
      const krakenMinimum = 5;
      if (total < krakenMinimum && total > 0 && cashAvailable >= krakenMinimum) {
        total = krakenMinimum;
      } else if (total < 1) {
        continue;
      }
      
      // Per-order safety buffer
      const orderSafetyBuffer = total * 0.10;
      total = Math.min(total - orderSafetyBuffer, cashAvailable * 0.90);
      total = Math.min(total, cashAvailable * 0.85);
      
      const cappedQuantity = total / price;
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

      // Use AI-recommended TP/SL from signal when available, fall back to user settings
      const aiTpPct = signal.take_profit_pct || null;
      const aiSlPct = signal.stop_loss_pct || null;
      const effectiveGainMargin = aiTpPct && aiTpPct > settings.gain_margin ? aiTpPct : settings.gain_margin;
      const effectiveLossMargin = aiSlPct || settings.loss_margin;
      
      // Entry zone check: flag if price is outside AI entry zone
      let entryZoneStatus = 'unknown';
      if (signal.entry_zone_low && signal.entry_zone_high) {
        if (price >= signal.entry_zone_low && price <= signal.entry_zone_high) {
          entryZoneStatus = 'in_zone';
        } else if (price < signal.entry_zone_low) {
          entryZoneStatus = 'below_zone';
        } else {
          entryZoneStatus = 'above_zone';
        }
      }

      // Parse metadata for additional info
      let metadata = {};
      try { metadata = signal.metadata_json ? JSON.parse(signal.metadata_json) : {}; } catch (_e) {}

      prospects.push({
        symbol,
        asset_type: pref.asset_type,
        current_price: price,
        quantity: cappedQuantity,
        total_value: total,
        confidence_score: confidence,
        ai_reasoning: signal.reasoning || 'AI analyzing...',
        predicted_gain: signal.predicted_gain_pct || effectiveGainMargin,
        is_blocked: !!blockReason,
        block_reason: blockReason,
        would_execute_now: wouldExecute,
        has_existing_position: !!holding,
        existing_quantity: holding?.quantity || 0,
        priority: confidence * (holding ? 0.6 : 1.0),
        market_trend: change24h,
        allocation_percent: actualAllocationPct,
        user_allocation_pct: userAllocationPct,
        // Signal intelligence
        optimal_action: signalType,
        technical_pattern: signal.technical_pattern,
        momentum_strength: signal.momentum_strength,
        timing_window: signal.timing_window,
        entry_zone: signal.entry_zone_low && signal.entry_zone_high ? { low: signal.entry_zone_low, high: signal.entry_zone_high } : null,
        entry_zone_status: entryZoneStatus,
        sentiment_score: signal.sentiment_score,
        // TP/SL from signal (AI-recommended) vs user settings
        stop_loss_pct: effectiveLossMargin,
        take_profit_pct: effectiveGainMargin,
        ai_suggested_gain: aiTpPct,
        ai_suggested_loss: aiSlPct,
        user_loss_margin: settings.loss_margin,
        user_gain_margin: settings.gain_margin,
        // Signal metadata
        signal_id: signal.id,
        signal_generated_at: metadata.generated_at,
        historical_win_rate: metadata.historical_win_rate,
        historical_avg_gain: metadata.historical_avg_gain,
        auto_tradeable: metadata.auto_tradeable,
        correlation_group: metadata.correlation_group
      });
    }

    // Sort by priority (confidence * position factor)
    prospects.sort((a, b) => b.priority - a.priority);
    
    console.log('[Prospects] Returning', prospects.length, 'prospects from', prefs.length, 'preferences');

    return Response.json({
      success: true,
      prospects,
      cash_available: cashAvailable,
      is_sim_mode: isSimMode,
      auto_trading_enabled: settings?.auto_trading_enabled || false,
      total_analyzed: prefs.length,
      market_intelligence: null, // No longer fetched here - comes from signals
      user_settings: {
        gain_margin: settings.gain_margin,
        loss_margin: settings.loss_margin
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