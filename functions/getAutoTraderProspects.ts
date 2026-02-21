import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Kraken pair mappings for public API
const KRAKEN_PAIR_MAP = {
  'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
  'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
  'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
  'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
  'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'HBAR': 'HBARUSD'
};

// Nonce counter for Kraken API
let lastNonce = 0;

function generateNonce() {
  const now = Date.now() * 1000;
  if (now <= lastNonce) {
    lastNonce++;
  } else {
    lastNonce = now;
  }
  return lastNonce.toString();
}

/**
 * Direct Kraken private API call - avoids function-to-function invocation issues
 */
async function callKrakenDirect(apiKey, apiSecret, endpoint, data = {}) {
  const cleanKey = apiKey.trim().replace(/\s+/g, '');
  const cleanSecret = apiSecret.trim().replace(/\s+/g, '');
  const nonce = generateNonce();
  const postData = new URLSearchParams({ nonce, ...data }).toString();
  
  const message = nonce + postData;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(cleanSecret), c => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  
  const pathBytes = new TextEncoder().encode(endpoint);
  const combined = new Uint8Array(pathBytes.length + hash.byteLength);
  combined.set(pathBytes);
  combined.set(new Uint8Array(hash), pathBytes.length);
  
  const signature = await crypto.subtle.sign('HMAC', hmacKey, combined);
  const apiSign = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(`https://api.kraken.com${endpoint}`, {
      method: 'POST',
      headers: {
        'API-Key': cleanKey,
        'API-Sign': apiSign,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NeonTrade-AI/1.0'
      },
      body: postData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return await response.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

/**
 * AUTO-TRADER PROSPECTS v3
 * 
 * Consumes pre-computed AssetSignal entries instead of calling AI directly.
 * Calls Kraken APIs directly (not via function invocation) to avoid auth issues.
 */

Deno.serve(async (req) => {
  try {
    console.log('[Prospects] START');
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
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
      min_signal_confidence: typeof rawRecord?.min_signal_confidence === 'number' ? rawRecord.min_signal_confidence : 55,
    };
    
    console.log('[Prospects] Settings - gain:', settings.gain_margin, '% loss:', settings.loss_margin, '%');

    // ── Get balance ──
    let cashAvailable = 0;       // Exact USD cash (no buffer) — for display
    let tradingCash = 0;         // Cash minus buffer — for order sizing only
    let assetsValue = 0;         // Total value of non-USD holdings
    let totalOpenOrdersValue = 0;
    
    const isSimMode = settings.sim_trading_mode;
    
    if (isSimMode) {
      console.log('[Prospects] Fetching Wallet balance (SIM mode)...');
      const wallets = await base44.entities.Wallet.filter({ created_by: user.email }, '-updated_date', 1);
      if (wallets.length > 0) {
        cashAvailable = wallets[0].cash_balance || 0;
      }
      tradingCash = cashAvailable;
      console.log('[Prospects] SIM cash available:', cashAvailable);
    } else {
    // LIVE mode: fetch from Kraken directly
    try {
      console.log('[Prospects] Fetching Kraken balance directly...');
      
      const krakenConns = await base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }, '-updated_date', 1);
      
      if (krakenConns.length > 0) {
        const conn = krakenConns[0];
        const balKey = (conn.balance_api_key || conn.api_key || '').trim();
        const balSecret = (conn.balance_api_secret_encrypted || conn.api_secret_encrypted || '').trim();
        
        if (balKey && balSecret) {
          const extBalResult = await callKrakenDirect(balKey, balSecret, '/0/private/BalanceEx', {});
          
          if (extBalResult?.error?.length > 0) {
            console.warn('[Prospects] Kraken BalanceEx error:', extBalResult.error.join(', '));
          } else if (extBalResult?.result) {
            const rawBalances = extBalResult.result;
            
            // Get exact USD balance (no buffer)
            const usdEntry = rawBalances['ZUSD'] || rawBalances['USD'];
            const rawUsd = parseFloat(typeof usdEntry === 'object' ? usdEntry.balance : (usdEntry || 0));
            cashAvailable = rawUsd; // EXACT — no buffer for display
            console.log('[Prospects] Kraken exact USD:', rawUsd);
            
            // Collect non-USD crypto holdings for assets value calculation
            const cryptoHoldings = [];
            const KRAKEN_ASSET_TO_SYMBOL = {
              'XXBT': 'BTC', 'XETH': 'ETH', 'SOL': 'SOL', 'XXRP': 'XRP',
              'ADA': 'ADA', 'XXDG': 'DOGE', 'DOT': 'DOT', 'LINK': 'LINK',
              'MATIC': 'MATIC', 'AVAX': 'AVAX', 'UNI': 'UNI', 'ATOM': 'ATOM',
              'XLTC': 'LTC', 'BCH': 'BCH', 'XXLM': 'XLM', 'TRX': 'TRX',
              'SHIB': 'SHIB', 'PEPE': 'PEPE', 'HBAR': 'HBAR',
              'XBT': 'BTC', 'ETH': 'ETH', 'XRP': 'XRP', 'XLM': 'XLM',
              'XDG': 'DOGE', 'LTC': 'LTC'
            };
            
            for (const [asset, entry] of Object.entries(rawBalances)) {
              if (asset === 'ZUSD' || asset === 'USD') continue;
              const bal = parseFloat(typeof entry === 'object' ? entry.balance : (entry || 0));
              if (bal <= 0) continue;
              const sym = KRAKEN_ASSET_TO_SYMBOL[asset] || asset.replace(/^[XZ]/, '');
              if (KRAKEN_PAIR_MAP[sym]) {
                cryptoHoldings.push({ symbol: sym, quantity: bal });
              }
            }
            
            // Fetch current prices for all holdings to calculate assets value
            if (cryptoHoldings.length > 0) {
              const holdingPairs = cryptoHoldings.map(h => KRAKEN_PAIR_MAP[h.symbol]).filter(Boolean);
              try {
                const tickerResp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${holdingPairs.join(',')}`);
                if (tickerResp.ok) {
                  const tickerData = await tickerResp.json();
                  if (tickerData?.result) {
                    for (const h of cryptoHoldings) {
                      const pair = KRAKEN_PAIR_MAP[h.symbol];
                      const ticker = tickerData.result[pair];
                      if (ticker) {
                        const price = parseFloat(ticker.c?.[0] || '0');
                        const value = h.quantity * price;
                        assetsValue += value;
                      }
                    }
                  }
                }
              } catch (priceErr) {
                console.warn('[Prospects] Could not fetch prices for assets value:', priceErr.message);
              }
            }
            
            console.log('[Prospects] Assets value: $' + assetsValue.toFixed(2));
            
            // Check open orders to deduct reserved capital from TRADING cash only
            try {
              const ordersResult = await callKrakenDirect(balKey, balSecret, '/0/private/OpenOrders', { trades: 'true' });
              if (ordersResult?.result?.open) {
                for (const [, order] of Object.entries(ordersResult.result.open)) {
                  const side = (order.descr?.type || '').toLowerCase();
                  if (side === 'buy') {
                    const orderCost = Number(order.vol || 0) * Number(order.descr?.price || 0);
                    totalOpenOrdersValue += orderCost;
                  }
                }
              }
            } catch (ordersErr) {
              console.warn('[Prospects] Could not fetch open orders:', ordersErr.message);
            }
            
            // Trading cash has buffer for order sizing, but display cash is exact
            const safetyBuffer = rawUsd * 0.02;
            tradingCash = Math.max(0, rawUsd - totalOpenOrdersValue - safetyBuffer);
            
            console.log('[Prospects] Display cash: $' + cashAvailable.toFixed(2) + ', Trading cash: $' + tradingCash.toFixed(2));
            
            if (tradingCash < 5) {
              return Response.json({
                success: true,
                prospects: [],
                cash_available: cashAvailable,
                assets_value: assetsValue,
                total_portfolio_value: cashAvailable + assetsValue,
                is_sim_mode: false,
                auto_trading_enabled: settings?.auto_trading_enabled || false,
                total_analyzed: 0,
                market_intelligence: null,
                user_settings: { gain_margin: settings.gain_margin, loss_margin: settings.loss_margin },
                message: `Insufficient trading cash ($${tradingCash.toFixed(2)} after reserves). Need at least $5.`
              });
            }
          }
        } else {
          console.warn('[Prospects] No Kraken API keys found on connection');
        }
      } else {
        console.warn('[Prospects] No Kraken connection found for user');
      }
    } catch (e) {
      console.error('[Prospects] Kraken balance fetch failed:', e?.message || e);
    }
    } // end else (LIVE mode)
    
    if (!tradingCash) tradingCash = cashAvailable;
    
    console.log('[Prospects] Cash available:', cashAvailable, 'Trading cash:', tradingCash);
    console.log('[Prospects] Mode:', isSimMode ? 'SIMULATION' : 'LIVE');

    // Get auto-buy preferences for current user and mode
    let allPrefs = await base44.entities.AutoBuyPreference.filter({ created_by: user.email }, "-created_date", 50);
    
    let prefs = allPrefs.filter(p => {
      const pIsSimulation = p.is_simulation === true || p.is_simulation === 'true';
      const pEnabled = p.enabled !== false;
      return pEnabled && (isSimMode ? pIsSimulation : !pIsSimulation);
    });
    
    console.log('[Prospects] Found', prefs.length, 'enabled preferences for', isSimMode ? 'SIM' : 'LIVE', 'mode (from', allPrefs.length, 'total)');

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

    // Load pre-computed AssetSignal entries
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
    
    // If no signals exist, trigger generation
    if (signals.length === 0) {
      console.log('[Prospects] No signals found - triggering generation...');
      try {
        const symbolsToGenerate = prefs.map(p => (p.symbol || '').toUpperCase()).filter(Boolean);
        await base44.functions.invoke('generateSignals', { 
          symbols: symbolsToGenerate, 
          forceRefresh: true 
        });
        
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
    
    // Fetch current prices via Kraken public API (no auth needed)
    const cryptoSymbols = prefs.filter(p => p.asset_type === "crypto").map(p => String(p.symbol || "").toUpperCase().trim());
    const stockSymbols = prefs.filter(p => p.asset_type === "stock").map(p => String(p.symbol || "").toUpperCase().trim());
    
    let quotes = [];
    
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

    // ── Build prospect list from signals + preferences ──
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

      const signal = signalMap.get(symbol);
      
      if (!signal) {
        console.log('[Prospects] No signal for', symbol, '- skipping');
        continue;
      }
      
      const signalType = (signal.signal_type || 'hold').toLowerCase();
      const confidence = signal.confidence_score || 50;
      const change24h = signal.change_24h || quote?.change_24h_percent || quote?.price_change_percentage_24h || 0;
      
      if (signalType !== 'buy' && signalType !== 'strong_buy') {
        console.log('[Prospects] Skipping', symbol, '- signal is', signalType);
        continue;
      }
      
      // Require minimum confidence for display (user-configurable, default 55%)
      const minConfidence = typeof settings.min_signal_confidence === 'number' ? settings.min_signal_confidence : 55;
      if (confidence < minConfidence) {
        console.log('[Prospects] Skipping', symbol, '- confidence too low:', confidence, '< min:', minConfidence);
        continue;
      }
      
      // TREND-FOLLOWING: Skip if 24h change is negative (don't buy falling assets)
      if (change24h < 0) {
        console.log('[Prospects] Skipping', symbol, '- negative 24h trend:', change24h.toFixed(1), '%');
        continue;
      }

      const holding = holdings.find(h => (h.symbol || "").toUpperCase() === symbol);
      
      // Calculate order size using tradingCash (has buffer baked in)
      const userAllocationPct = Number(pref.percentage) || 10;
      const userPct = userAllocationPct / 100;
      let total = tradingCash * userPct;
      
      const safetyMax = tradingCash * safetyMaxPct;
      if (total > safetyMax) total = safetyMax;
      
      if (holding) {
        total = total * 0.7;
      }
      
      const krakenMinimum = 5;
      if (total < krakenMinimum && total > 0 && tradingCash >= krakenMinimum) {
        total = krakenMinimum;
      } else if (total < 1) {
        continue;
      }
      
      total = Math.min(total, tradingCash * 0.90);
      
      const cappedQuantity = total / price;
      const actualAllocationPct = tradingCash > 0 ? Math.round((total / tradingCash) * 100) : 0;

      let blockReason = null;
      let wouldExecute = false;
      
      if (tradingCash < 1) {
        blockReason = `No trading cash available ($${tradingCash.toFixed(2)})`;
      } else if (total < 1) {
        blockReason = "Order value too small (minimum $1)";
      } else if (total > tradingCash) {
        blockReason = `Exceeds available trading cash ($${tradingCash.toFixed(2)})`;
      } else {
        wouldExecute = true;
      }

      const aiTpPct = signal.take_profit_pct || null;
      const aiSlPct = signal.stop_loss_pct || null;
      // Enforce minimum TP 4%, SL 2% for high win rate
      const rawGainMargin = aiTpPct && aiTpPct > settings.gain_margin ? aiTpPct : settings.gain_margin;
      const rawLossMargin = aiSlPct || settings.loss_margin;
      const effectiveGainMargin = Math.max(rawGainMargin, 4);
      const effectiveLossMargin = Math.max(rawLossMargin, 2);
      
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
        optimal_action: signalType,
        technical_pattern: signal.technical_pattern,
        momentum_strength: signal.momentum_strength,
        timing_window: signal.timing_window,
        entry_zone: signal.entry_zone_low && signal.entry_zone_high ? { low: signal.entry_zone_low, high: signal.entry_zone_high } : null,
        entry_zone_status: entryZoneStatus,
        sentiment_score: signal.sentiment_score,
        stop_loss_pct: effectiveLossMargin,
        take_profit_pct: effectiveGainMargin,
        ai_suggested_gain: aiTpPct,
        ai_suggested_loss: aiSlPct,
        user_loss_margin: settings.loss_margin,
        user_gain_margin: settings.gain_margin,
        signal_id: signal.id,
        signal_generated_at: metadata.generated_at,
        historical_win_rate: metadata.historical_win_rate,
        historical_avg_gain: metadata.historical_avg_gain,
        auto_tradeable: metadata.auto_tradeable,
        correlation_group: metadata.correlation_group
      });
    }

    prospects.sort((a, b) => b.priority - a.priority);
    
    console.log('[Prospects] Returning', prospects.length, 'prospects from', prefs.length, 'preferences');

    return Response.json({
      success: true,
      prospects,
      cash_available: cashAvailable,
      assets_value: assetsValue,
      total_portfolio_value: cashAvailable + assetsValue,
      is_sim_mode: isSimMode,
      auto_trading_enabled: settings?.auto_trading_enabled || false,
      total_analyzed: prefs.length,
      market_intelligence: null,
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