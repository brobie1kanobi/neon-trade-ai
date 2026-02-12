import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * WEBSOCKET RECOVERY HANDLER
 * 
 * Manages recovery from WebSocket disconnections by:
 * 1. Tracking last execution timestamp per user
 * 2. On reconnect, fetching Kraken trades since last checkpoint
 * 3. Replaying missing events through the portfolio reducer
 * 4. Preventing double-application of trades via idempotency keys
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    
    switch (action) {
      case 'getCheckpoint': {
        // Get user's last execution timestamp
        const settings = await base44.entities.UserSettings.filter({
          created_by: user.email
        });
        
        const lastCheckpoint = settings[0]?.last_execution_timestamp || null;
        
        return Response.json({
          success: true,
          last_execution_timestamp: lastCheckpoint
        });
      }
      
      case 'updateCheckpoint': {
        const { timestamp } = body;
        
        if (!timestamp) {
          return Response.json({ error: 'Missing timestamp' }, { status: 400 });
        }
        
        const settings = await base44.entities.UserSettings.filter({
          created_by: user.email
        });
        
        if (settings.length > 0) {
          await base44.entities.UserSettings.update(settings[0].id, {
            last_execution_timestamp: timestamp
          });
        }
        
        return Response.json({ success: true });
      }
      
      case 'recoverMissedTrades': {
        const { since_timestamp } = body;
        
        if (!since_timestamp) {
          return Response.json({ error: 'Missing since_timestamp' }, { status: 400 });
        }
        
        console.log(`[wsRecovery] Recovering trades for ${user.email} since ${since_timestamp}`);
        
        // Fetch Kraken trades since checkpoint
        let krakenTrades = [];
        try {
          const histRes = await base44.functions.invoke('krakenApi', {
            action: 'getTradesHistory'
          });
          const histData = histRes?.data || histRes;
          krakenTrades = histData?.trades || [];
        } catch (e) {
          console.error('[wsRecovery] Failed to fetch Kraken trades:', e.message);
          return Response.json({ 
            success: false, 
            error: 'Failed to fetch Kraken trades' 
          });
        }
        
        // Filter trades after checkpoint
        const sinceTime = new Date(since_timestamp).getTime() / 1000;
        const missedTrades = krakenTrades.filter(t => {
          const tradeTime = parseFloat(t.time || 0);
          return tradeTime > sinceTime;
        });
        
        console.log(`[wsRecovery] Found ${missedTrades.length} trades since checkpoint`);
        
        if (missedTrades.length === 0) {
          return Response.json({
            success: true,
            trades_recovered: 0,
            message: 'No missed trades'
          });
        }
        
        // Process each missed trade
        const recovered = [];
        const skipped = [];
        
        for (const krakenTrade of missedTrades) {
          const krakenTxid = krakenTrade.txid || krakenTrade.id;
          const idempotencyKey = `kraken_${krakenTxid}`;
          
          // Check if already processed (idempotency)
          const existing = await base44.entities.LedgerEntry.filter({
            created_by: user.email,
            idempotency_key: idempotencyKey
          });
          
          if (existing.length > 0) {
            skipped.push({
              txid: krakenTxid,
              reason: 'Already processed'
            });
            continue;
          }
          
          // Parse trade details
          const pair = krakenTrade.pair || '';
          const symbol = pair.replace('USD', '').replace('ZUSD', '').replace('/', '');
          const type = (krakenTrade.type || '').toLowerCase();
          const quantity = parseFloat(krakenTrade.vol || 0);
          const price = parseFloat(krakenTrade.price || 0);
          const cost = parseFloat(krakenTrade.cost || 0);
          const fee = parseFloat(krakenTrade.fee || 0);
          
          // Create ledger entry
          try {
            await base44.entities.LedgerEntry.create({
              asset_symbol: symbol,
              entry_type: type === 'buy' ? 'trade_buy' : 'trade_sell',
              quantity_delta: type === 'buy' ? quantity : -quantity,
              cash_delta: type === 'buy' ? -(cost + fee) : (cost - fee),
              unit_price: price,
              reference_type: 'kraken_execution',
              reference_id: krakenTxid,
              idempotency_key: idempotencyKey,
              kraken_txid: krakenTxid,
              is_simulation: false,
              metadata_json: JSON.stringify({
                recovered_at: new Date().toISOString(),
                original_time: krakenTrade.time,
                fee
              }),
              created_by: user.email
            });
            
            // Also create Trade record
            await base44.entities.Trade.create({
              symbol,
              type,
              asset_type: 'crypto',
              quantity,
              price,
              total_value: cost,
              fee,
              status: 'filled',
              idempotency_key: idempotencyKey,
              kraken_trade_id: krakenTxid,
              is_simulation: false,
              is_auto_trade: false,
              filled_at: new Date(parseFloat(krakenTrade.time) * 1000).toISOString(),
              created_by: user.email
            });
            
            recovered.push({
              txid: krakenTxid,
              symbol,
              type,
              quantity,
              price,
              cost
            });
            
          } catch (e) {
            console.error(`[wsRecovery] Failed to process trade ${krakenTxid}:`, e.message);
            skipped.push({
              txid: krakenTxid,
              reason: e.message
            });
          }
        }
        
        // Update checkpoint to latest trade time
        if (recovered.length > 0) {
          const latestTrade = missedTrades[missedTrades.length - 1];
          const latestTime = new Date(parseFloat(latestTrade.time) * 1000).toISOString();
          
          const settings = await base44.entities.UserSettings.filter({
            created_by: user.email
          });
          
          if (settings.length > 0) {
            await base44.entities.UserSettings.update(settings[0].id, {
              last_execution_timestamp: latestTime
            });
          }
        }
        
        // Trigger portfolio reconciliation
        try {
          await base44.functions.invoke('reconcileWallet', { mode: 'real' });
        } catch (e) {
          console.warn('[wsRecovery] Reconciliation failed:', e.message);
        }
        
        return Response.json({
          success: true,
          trades_recovered: recovered.length,
          trades_skipped: skipped.length,
          recovered,
          skipped
        });
      }
      
      case 'detectDrift': {
        // Compare local state to Kraken state
        
        // Get local holdings
        const localHoldings = await base44.entities.Holding.filter({
          created_by: user.email,
          is_simulation: false
        });
        
        // Get Kraken balances
        let krakenBalances = {};
        try {
          const balRes = await base44.functions.invoke('getKrakenBalance', {});
          const balData = balRes?.data || balRes;
          if (balData?.holdings) {
            for (const h of balData.holdings) {
              krakenBalances[h.symbol] = h.quantity;
            }
          }
        } catch (e) {
          return Response.json({
            success: false,
            error: 'Could not fetch Kraken balances'
          });
        }
        
        // Compare
        const drift = [];
        
        for (const local of localHoldings) {
          const krakenQty = krakenBalances[local.symbol] || 0;
          const localQty = local.quantity || 0;
          const diff = Math.abs(krakenQty - localQty);
          
          if (diff > 0.00001) {
            drift.push({
              symbol: local.symbol,
              local_qty: localQty,
              kraken_qty: krakenQty,
              difference: krakenQty - localQty
            });
          }
          
          delete krakenBalances[local.symbol];
        }
        
        // Check for Kraken holdings not in local
        for (const [symbol, qty] of Object.entries(krakenBalances)) {
          if (qty > 0.00001 && symbol !== 'USD' && symbol !== 'ZUSD') {
            drift.push({
              symbol,
              local_qty: 0,
              kraken_qty: qty,
              difference: qty
            });
          }
        }
        
        return Response.json({
          success: true,
          has_drift: drift.length > 0,
          drift_count: drift.length,
          drift
        });
      }
      
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('[wsRecovery] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});