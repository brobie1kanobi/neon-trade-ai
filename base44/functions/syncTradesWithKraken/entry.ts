import { createClientFromRequest, createClient } from 'npm:@base44/sdk@0.8.6';

/**
 * Sync ALL local Trade records with Kraken's authoritative data
 * CRITICAL: Kraken is the source of truth for LIVE trades
 * 
 * This function:
 * 1. Fetches ALL trades from Kraken's TradesHistory API
 * 2. Updates ALL local Trade records to match Kraken's EXACT values
 * 3. Creates any missing trades that exist on Kraken but not locally
 */

const KRAKEN_API_URL = 'https://api.kraken.com';
const API_TIMEOUT = 15000;

// Local nonce counter
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

async function callKraken(apiKey, apiSecret, endpoint, data = {}) {
  const cleanKey = typeof apiKey === 'string' ? apiKey.trim().replace(/\s+/g, '') : apiKey;
  const cleanSecret = typeof apiSecret === 'string' ? apiSecret.trim().replace(/\s+/g, '') : apiSecret;
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
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  
  try {
    const response = await fetch(`${KRAKEN_API_URL}${endpoint}`, {
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
  } catch (fetchError) {
    clearTimeout(timeoutId);
    throw fetchError;
  }
}

/**
 * A sell that was sitting as `pending_fill` now has its authoritative Kraken fill.
 * This is the ONLY place a LIVE sell is described as a profit or a loss, and the
 * label comes from the exchange's real fill price and fee — never a ticker estimate.
 */
async function announceResolvedSell(base44, userEmail, localTrade, fill) {
  const buyPrice = Number(localTrade.exit_purchase_price || 0);
  const symbol = localTrade.symbol;
  const exitReason = localTrade.exit_reason || 'manual';

  let title;
  let type;
  let message = `Sold ${fill.quantity} ${symbol} @ $${fill.price} for $${fill.proceeds.toFixed(2)}`;
  let netProfit = null;
  let gainPct = null;

  if (buyPrice > 0) {
    const costBasis = buyPrice * fill.quantity;
    netProfit = fill.proceeds - fill.fee - costBasis;
    gainPct = ((fill.price - buyPrice) / buyPrice) * 100;
    const isProfit = netProfit > 0;
    title = isProfit
      ? `✅ Profit Taken: ${symbol}`
      : `🔻 Loss Realized: ${symbol}`;
    type = isProfit ? 'success' : 'warning';
    message += ` — ${isProfit ? '+' : '-'}$${Math.abs(netProfit).toFixed(2)} net (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}% vs $${buyPrice} buy, fee $${fill.fee.toFixed(2)})`;
  } else {
    title = `Sell filled: ${symbol}`;
    type = 'info';
  }

  try {
    await base44.asServiceRole.entities.Notification.create({
      title,
      message,
      type,
      read: false,
      details_json: JSON.stringify({
        symbol,
        action: 'sell',
        quantity: fill.quantity,
        fill_price: fill.price,
        proceeds: fill.proceeds,
        fee: fill.fee,
        buy_price: buyPrice || null,
        net_profit: netProfit,
        gain_pct: gainPct,
        exit_reason: exitReason,
        source: 'kraken_fill',
        is_simulation: false
      }),
      created_by: userEmail
    });
  } catch (e) {
    console.warn('[syncTradesWithKraken] Notification failed:', e.message);
  }

  if (buyPrice > 0) {
    try {
      const entryTime = new Date(localTrade.submitted_at || localTrade.created_date).getTime();
      await base44.asServiceRole.entities.ModelPerformance.create({
        signal_id: localTrade.signal_id || null,
        trade_id: localTrade.id,
        asset_symbol: symbol,
        entry_price: buyPrice,
        exit_price: fill.price,
        outcome_percentage: Math.round(gainPct * 100) / 100,
        duration_held_minutes: Math.max(0, Math.round((fill.filledAt.getTime() - entryTime) / 60000)),
        is_success: netProfit > 0,
        exit_reason: ['take_profit', 'stop_loss', 'trailing_stop', 'manual', 'signal_expired', 'risk_limit'].includes(exitReason) ? exitReason : 'manual',
        is_simulation: false,
        created_by: userEmail
      });
    } catch (e) {
      console.warn('[syncTradesWithKraken] ModelPerformance failed:', e.message);
    }
  }
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden', success: false }, { status: 403 });
    }

    console.log('[syncTradesWithKraken] Starting sync for user:', user.email);

    // Get Kraken connection to call API directly
    const normalize = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, '') : s);
    const apiKey = normalize(Deno.env.get('Kraken_API_Key'));
    const apiSecret = normalize(Deno.env.get('Kraken_API_Secret'));
    if (!apiKey || !apiSecret) {
      return Response.json({ error: 'Missing Kraken_API_Key/Kraken_API_Secret in application secrets', success: false }, { status: 200 });
    }

    // Step 1: Fetch ALL trades from Kraken directly
    let krakenData = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts && !krakenData?.result?.trades) {
      if (attempts > 0) {
        const delay = 5000 * attempts;
        console.log(`[syncTradesWithKraken] Retry ${attempts}/${maxAttempts} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
      
      try {
        krakenData = await callKraken(apiKey, apiSecret, '/0/private/TradesHistory', { type: 'all' });
        console.log('[syncTradesWithKraken] Kraken API response:', !!krakenData?.result, 'trades:', Object.keys(krakenData?.result?.trades || {}).length);
        
        if (krakenData.error?.length > 0) {
          console.error('[syncTradesWithKraken] Kraken error:', krakenData.error);
          krakenData = { error: krakenData.error.join(', ') };
        }
      } catch (err) {
        console.error('[syncTradesWithKraken] Fetch error:', err.message);
        krakenData = { error: err.message };
      }
      
      attempts++;
    }
    
    if (!krakenData?.result?.trades) {
      console.error('[syncTradesWithKraken] Failed to fetch Kraken trades after', attempts, 'attempts:', krakenData?.error);
      return Response.json({ 
        error: krakenData?.error || 'Failed to fetch Kraken trades',
        success: false,
        attempts: attempts
      }, { status: 200 });
    }
    
    // Convert to array format - CRITICAL: Ensure all IDs are strings
    const krakenTrades = Object.entries(krakenData.result.trades).map(([txid, trade]) => ({
      trade_id: String(trade.trade_id || txid),
      txid: String(txid),
      ordertxid: trade.ordertxid ? String(trade.ordertxid) : null,
      ...trade
    }));
    
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
    let fillsResolved = 0;
    const errors = [];
    // Every Kraken fill consumed by an existing local record. Step 4 must never
    // create a second record for one of these — that is exactly how one Kraken
    // sell became two contradictory trades in the app.
    const consumedKrakenIds = new Set();

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
          const localTime = new Date(localTrade.submitted_at || localTrade.created_date).getTime();
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
          consumedKrakenIds.add(String(krakenTrade.trade_id || krakenTrade.txid));
          if (krakenTrade.ordertxid) consumedKrakenIds.add(String(krakenTrade.ordertxid));
          
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
          const isPendingFill = localTrade.status === 'pending_fill';

          const needsUpdate = 
            isPendingFill ||
            Math.abs(localTrade.quantity - exactQuantity) > 0.00000001 ||
            Math.abs(localTrade.price - exactPrice) > 0.00000001 ||
            Math.abs(localTrade.total_value - exactCost) > 0.00000001 ||
            !localTrade.kraken_trade_id;
          
          if (needsUpdate) {
            console.log('[syncTradesWithKraken] Correcting trade', localTrade.id, localTrade.symbol, ':', {
              old: { qty: localTrade.quantity, price: localTrade.price, total: localTrade.total_value },
              new: { qty: exactQuantity, price: exactPrice, total: exactCost, fee: exactFee }
            });
            
            const patch = {
              quantity: exactQuantity,
              price: exactPrice,
              total_value: exactCost,
              fee: exactFee,
              kraken_trade_id: String(krakenTrade.trade_id || krakenTrade.txid),
              kraken_order_id: krakenTrade.ordertxid ? String(krakenTrade.ordertxid) : null
            };
            if (isPendingFill) {
              patch.status = 'filled';
              patch.filled_at = new Date(krakenTrade.time * 1000).toISOString();
            }

            await base44.asServiceRole.entities.Trade.update(localTrade.id, patch);
            
            updated++;

            // A pending sell just became a REAL fill — this is the only place a
            // profit/loss claim is ever made, and it is made from Kraken's numbers.
            if (isPendingFill && localTrade.type === 'sell') {
              fillsResolved++;
              await announceResolvedSell(base44, user.email, localTrade, {
                quantity: exactQuantity,
                price: exactPrice,
                proceeds: exactCost,
                fee: exactFee,
                filledAt: new Date(krakenTrade.time * 1000)
              });
            }
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
      const ktId = String(kt.trade_id || kt.txid);
      
      // Skip if we already have this trade
      if (localTradeIds.has(ktId) || localTradeIds.has(String(kt.ordertxid || ''))) {
        continue;
      }
      // Skip if this fill was already applied to an existing local record above.
      if (consumedKrakenIds.has(ktId) || (kt.ordertxid && consumedKrakenIds.has(String(kt.ordertxid)))) {
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
          kraken_trade_id: String(ktId),  // CRITICAL: Convert to string
          kraken_order_id: kt.ordertxid ? String(kt.ordertxid) : null,
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
      pending_fills_resolved: fillsResolved,
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