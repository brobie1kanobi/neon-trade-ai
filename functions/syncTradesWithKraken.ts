import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Sync ALL local Trade records with Kraken's authoritative data
 * CRITICAL: Kraken is the source of truth for LIVE trades
 * 
 * This function:
 * 1. Fetches ALL trades from Kraken's TradesHistory API
 * 2. Updates ALL local Trade records to match Kraken's EXACT values
 * 3. Creates any missing trades that exist on Kraken but not locally
 */

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    console.log('[syncTradesWithKraken] Starting sync for user:', user.email);

    // Step 1: Fetch ALL trades from Kraken (with retry for rate limits)
    let krakenData = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts && !krakenData?.success) {
      if (attempts > 0) {
        const delay = 5000 * attempts; // 5s, 10s delay
        console.log(`[syncTradesWithKraken] Retry ${attempts}/${maxAttempts} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
      
      try {
        const krakenResponse = await base44.functions.invoke('krakenApi', { 
          action: 'getTradesHistory' 
        });
        krakenData = krakenResponse?.data || krakenResponse;
      } catch (err) {
        console.error('[syncTradesWithKraken] Fetch error:', err.message);
        krakenData = { error: err.message };
      }
      
      attempts++;
    }
    
    if (!krakenData?.success || !krakenData?.trades) {
      console.error('[syncTradesWithKraken] Failed to fetch Kraken trades after', attempts, 'attempts:', krakenData?.error);
      return Response.json({ 
        error: krakenData?.error || 'Failed to fetch Kraken trades',
        success: false,
        attempts: attempts
      }, { status: 200 });
    }

    const krakenTrades = krakenData.trades;
    console.log('[syncTradesWithKraken] Fetched', krakenTrades.length, 'trades from Kraken');

    // Step 2: Fetch ALL local LIVE trades using SERVICE ROLE (to bypass RLS for admin operations)
    const localTrades = await base44.asServiceRole.entities.Trade.filter({ 
      is_simulation: false,
      created_by: user.email 
    });
    
    console.log('[syncTradesWithKraken] Found', localTrades.length, 'local LIVE trades');

    // Normalize Kraken symbol - CRITICAL: Convert ALL Kraken formats to standard symbols
    const normalizeSymbol = (pair) => {
      if (!pair) return 'UNKNOWN';
      let s = pair.toUpperCase();
      
      // Remove USD suffix variations
      s = s.replace(/USD$/, '').replace(/ZUSD$/, '').replace(/\/USD$/, '');
      
      // CRITICAL: Handle XBT -> BTC (Kraken uses XBT for Bitcoin)
      s = s.replace(/^XXBT$/, 'BTC').replace(/^XBT$/, 'BTC').replace(/^XBTC$/, 'BTC');
      // Also handle XBT appearing after pair strip
      if (s === 'XBT') s = 'BTC';
      
      // Handle other Kraken-specific symbols
      s = s.replace(/^XXRP$/, 'XRP').replace(/^XRPZ$/, 'XRP');
      s = s.replace(/^XETH$/, 'ETH').replace(/^XXDG$/, 'DOGE').replace(/^XLTC$/, 'LTC');
      s = s.replace(/^XXLM$/, 'XLM').replace(/^XXLMZ$/, 'XLM');
      
      // Remove leading X from Kraken's format (e.g., XETH -> ETH)
      if (s.length > 3 && s.startsWith('X') && /^X[A-Z]/.test(s)) {
        s = s.substring(1);
      }
      // Remove trailing Z from Kraken's format
      if (s.length > 3 && s.endsWith('Z')) {
        s = s.slice(0, -1);
      }
      
      // Final XBT check after all transformations
      if (s === 'XBT') s = 'BTC';
      
      return s;
    };

    // Build a map of Kraken trades by trade_id/txid for quick lookup
    const krakenTradeMap = new Map();
    for (const kt of krakenTrades) {
      const id = kt.trade_id || kt.txid;
      if (id) {
        krakenTradeMap.set(id, kt);
      }
      // Also index by ordertxid for matching
      if (kt.ordertxid) {
        krakenTradeMap.set(`order:${kt.ordertxid}`, kt);
      }
    }

    let updated = 0;
    let created = 0;
    let matched = 0;
    const errors = [];

    // Step 3: Update existing local trades with Kraken's EXACT values
    for (const localTrade of localTrades) {
      try {
        // Try to find matching Kraken trade
        let krakenTrade = null;
        
        // Match by kraken_order_id if available
        if (localTrade.kraken_order_id) {
          krakenTrade = krakenTradeMap.get(localTrade.kraken_order_id) || 
                        krakenTradeMap.get(`order:${localTrade.kraken_order_id}`);
        }
        
        // If no match, try to match by symbol, type, and approximate time
        if (!krakenTrade) {
          const localTime = new Date(localTrade.created_date).getTime();
          const localSymbol = localTrade.symbol.toUpperCase();
          
          for (const kt of krakenTrades) {
            const ktSymbol = normalizeSymbol(kt.pair);
            const ktTime = kt.time * 1000; // Kraken uses seconds
            const timeDiff = Math.abs(localTime - ktTime);
            
            // Match if same symbol, same type, within 2 minutes
            if (ktSymbol === localSymbol && 
                kt.type === localTrade.type && 
                timeDiff < 120000) {
              krakenTrade = kt;
              break;
            }
          }
        }

        if (krakenTrade) {
          matched++;
          
          // CRITICAL: Use Kraken's EXACT values - these are the AUTHORITATIVE source
          // Kraken API returns:
          // - vol: exact quantity of asset traded
          // - price: exact price per unit
          // - cost: exact total USD cost/proceeds (this is what actually left/entered your account)
          // - fee: exact fee charged
          const exactQuantity = parseFloat(krakenTrade.vol);
          const exactPrice = parseFloat(krakenTrade.price);
          const exactCost = parseFloat(krakenTrade.cost);
          const exactFee = parseFloat(krakenTrade.fee) || 0;
          
          // CRITICAL: Always update to ensure exact Kraken values, even if "close"
          // For auditing purposes, we want EXACT values, not "close enough"
          const needsUpdate = 
            Math.abs(localTrade.quantity - exactQuantity) > 0.00000001 ||
            Math.abs(localTrade.price - exactPrice) > 0.00000001 ||
            Math.abs(localTrade.total_value - exactCost) > 0.00000001 ||
            !localTrade.kraken_trade_id;
          
          if (needsUpdate) {
            console.log('[syncTradesWithKraken] Correcting trade', localTrade.id, localTrade.symbol, ':', {
              old: { qty: localTrade.quantity, price: localTrade.price, total: localTrade.total_value },
              new: { qty: exactQuantity, price: exactPrice, total: exactCost, fee: exactFee }
            });
            
            await base44.asServiceRole.entities.Trade.update(localTrade.id, {
              quantity: exactQuantity,
              price: exactPrice,
              total_value: exactCost,
              fee: exactFee,
              kraken_trade_id: krakenTrade.trade_id || krakenTrade.txid,
              kraken_order_id: krakenTrade.ordertxid
            });
            
            updated++;
          }
        } else {
          console.warn('[syncTradesWithKraken] No Kraken match found for local trade:', localTrade.id, localTrade.symbol, localTrade.created_date);
        }
      } catch (err) {
        console.error('[syncTradesWithKraken] Error updating trade', localTrade.id, ':', err.message);
        errors.push({ trade_id: localTrade.id, error: err.message });
      }
    }

    // Step 4: Create local records for Kraken trades that don't exist locally
    const localTradeIds = new Set();
    for (const lt of localTrades) {
      if (lt.kraken_trade_id) localTradeIds.add(lt.kraken_trade_id);
      if (lt.kraken_order_id) localTradeIds.add(lt.kraken_order_id);
    }

    for (const kt of krakenTrades) {
      const ktId = kt.trade_id || kt.txid;
      
      // Skip if we already have this trade
      if (localTradeIds.has(ktId) || localTradeIds.has(kt.ordertxid)) {
        continue;
      }
      
      // Check if a matching trade exists by time/symbol (without kraken_trade_id)
      const ktTime = kt.time * 1000;
      const ktSymbol = normalizeSymbol(kt.pair);
      let alreadyExists = false;
      
      for (const lt of localTrades) {
        const ltTime = new Date(lt.created_date).getTime();
        if (lt.symbol === ktSymbol && 
            lt.type === kt.type && 
            Math.abs(ltTime - ktTime) < 120000) {
          alreadyExists = true;
          break;
        }
      }
      
      if (alreadyExists) continue;

      try {
        // CRITICAL: Normalize XBT -> BTC for display
        const displaySymbol = ktSymbol === 'XBT' ? 'BTC' : ktSymbol;
        
        console.log('[syncTradesWithKraken] Creating missing trade from Kraken:', ktId, displaySymbol, {
          vol: kt.vol,
          price: kt.price,
          cost: kt.cost,
          fee: kt.fee
        });
        
        await base44.asServiceRole.entities.Trade.create({
          symbol: displaySymbol,
          type: kt.type,
          asset_type: 'crypto',
          quantity: parseFloat(kt.vol),
          price: parseFloat(kt.price),
          total_value: parseFloat(kt.cost),
          fee: parseFloat(kt.fee) || 0,
          status: 'executed',
          is_auto_trade: false,
          is_simulation: false,
          kraken_trade_id: ktId,
          kraken_order_id: kt.ordertxid,
          created_date: new Date(kt.time * 1000).toISOString(),
          created_by: user.email
        });
        
        created++;
      } catch (err) {
        console.error('[syncTradesWithKraken] Error creating trade:', err.message);
        errors.push({ kraken_trade_id: ktId, error: err.message });
      }
    }

    const result = {
      success: true,
      kraken_trades_count: krakenTrades.length,
      local_trades_count: localTrades.length,
      matched: matched,
      updated: updated,
      created: created,
      errors: errors.length > 0 ? errors : undefined,
      duration_ms: Date.now() - startTime
    };

    console.log('[syncTradesWithKraken] Sync complete:', result);

    return Response.json(result, { status: 200 });

  } catch (error) {
    console.error('[syncTradesWithKraken] Error:', error.message);
    return Response.json({ 
      error: error.message, 
      success: false,
      duration_ms: Date.now() - startTime
    }, { status: 200 });
  }
});