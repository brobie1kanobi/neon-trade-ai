import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Server-side TP/SL Monitor - runs as a scheduled automation (hourly)
 * 
 * Fetches all active ConditionalOrder records, checks current Kraken prices,
 * and executes market sells when TP/SL/trailing conditions are met.
 * This ensures orders are enforced even when the app is not open.
 */

const KRAKEN_PAIR_MAP = {
  'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
  'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
  'MATIC': 'MATICUSD', 'POL': 'POLUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD',
  'ATOM': 'ATOMUSD', 'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD',
  'TRX': 'TRXUSD', 'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'HBAR': 'HBARUSD',
  'SUI': 'SUIUSD', 'NEAR': 'NEARUSD', 'ARB': 'ARBUSD', 'OP': 'OPUSD',
  'INJ': 'INJUSD', 'FIL': 'FILUSD', 'ALGO': 'ALGOUSD', 'APT': 'APTUSD',
  'TRUMP': 'TRUMPUSD', 'TAO': 'TAOUSD', 'KAS': 'KASUSD', 'FET': 'FETUSD',
  'TIA': 'TIAUSD', 'JUP': 'JUPUSD', 'WIF': 'WIFUSD', 'BONK': 'BONKUSD',
  'FLOKI': 'FLOKIUSD'
};

const MIN_ORDER_SIZES = {
  'BTC': 0.00005, 'XBT': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4,
  'DOT': 0.5, 'DOGE': 13.0, 'XDG': 13.0, 'LINK': 0.2, 'UNI': 0.5, 'MATIC': 10.0,
  'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0, 'SHIB': 100000.0,
  'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.7, 'NEAR': 0.7, 'BABY': 50.0, 'FLOKI': 105000.0,
  'WIF': 14.0, 'BONK': 500000.0, 'PEPE': 500000.0, 'APT': 2.2, 'ARB': 5.2, 'OP': 16.0,
  'INJ': 0.9, 'TIA': 8.2, 'FET': 18.0, 'TRUMP': 0.2, 'KAITO': 2.5, 'MOVE': 6.0,
  'GRASS': 13.0, 'GOAT': 5.0, 'HBAR': 20.0, 'KAS': 30.0, 'TAO': 0.008, 'EIGEN': 8.6,
  'ENA': 4.0, 'SUI': 3.0, 'FARTCOIN': 5.0, 'JUP': 20.0, 'POL': 10.0
};

// Normalize Kraken asset key (e.g., XXLM -> XLM, XBT -> BTC)
function normalizeAssetKey(key) {
  let s = String(key || '').toUpperCase();
  if (s.startsWith('Z') && s.length === 4) s = s.slice(1);
  if (s.startsWith('XX') && s.length <= 5) s = s.slice(1);
  if (s.startsWith('X') && s.length === 4) s = s.slice(1);
  const map = { XBT: 'BTC', XXBT: 'BTC', XDG: 'DOGE' };
  return map[s] || s;
}

// Fetch available (free) holdings per asset from Kraken extended balance
async function getAvailableMap(base44) {
  try {
    const resp = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getExtendedBalance' });
    let data = resp?.data || resp;
    if (data?.data) data = data.data;
    const out = {};
    const bal = data?.balance || data;
    if (!bal) return out;
    for (const [k, v] of Object.entries(bal)) {
      const sym = normalizeAssetKey(k);
      let qty = 0;
      if (v && typeof v === 'object') {
        const rawBal = parseFloat(v.balance ?? v.total ?? 0) || 0;
        const heldTrade = parseFloat(v.hold_trade ?? v.hold ?? 0) || 0;
        const heldFunding = parseFloat(v.hold_funding ?? 0) || 0;
        const avail = parseFloat(v.available ?? (rawBal - heldTrade - heldFunding));
        qty = isFinite(avail) ? avail : Math.max(0, rawBal - heldTrade - heldFunding);
      } else {
        qty = parseFloat(v || 0) || 0;
      }
      if (qty < 0) qty = 0;
      if (!isNaN(qty)) out[sym] = qty;
    }
    return out;
  } catch (_e) {
    console.warn('[monitor] getAvailableMap failed:', _e.message);
    return {};
  }
}

async function fetchKrakenPrices(symbols) {
  const pairs = symbols.map(s => KRAKEN_PAIR_MAP[s] || `${s}USD`);
  const prices = {};
  if (pairs.length === 0) return prices;

  try {
    const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`);
    if (!resp.ok) throw new Error(`Kraken ticker ${resp.status}`);
    const data = await resp.json();
    if (data.error?.length) console.warn('[monitor] Kraken warnings:', data.error);

    for (const sym of symbols) {
      const pair = KRAKEN_PAIR_MAP[sym] || `${sym}USD`;
      // Kraken returns data under various key formats
      const ticker = data.result?.[pair]
        || data.result?.[`X${sym}ZUSD`]
        || data.result?.[`${sym}USD`];
      if (ticker?.c?.[0]) {
        prices[sym] = parseFloat(ticker.c[0]);
      }
    }
  } catch (e) {
    console.error('[monitor] Price fetch error:', e.message);
  }
  return prices;
}

Deno.serve(async (req) => {
  const start = Date.now();
  try {
    const base44 = createClientFromRequest(req);

    // Auth check – require admin role; reject unauthenticated requests
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    // 1. Fetch all active conditional orders
    const orders = await base44.asServiceRole.entities.ConditionalOrder.filter({ status: 'active' });
    if (!orders.length) {
      console.log('[monitor] No active conditional orders.');
      return Response.json({ success: true, processed: 0, executed: 0 });
    }
    console.log(`[monitor] ${orders.length} active conditional orders`);

    // 2. Fetch current prices for all relevant symbols
    const symbols = [...new Set(orders.map(o => o.symbol))];
    const prices = await fetchKrakenPrices(symbols);
    console.log('[monitor] Prices:', JSON.stringify(prices));

    let processed = 0;
    let executed = 0;
    const results = [];

    // 3. Evaluate each order
    for (const order of orders) {
      const price = prices[order.symbol];
      if (!price) {
        console.warn(`[monitor] No price for ${order.symbol}, skipping order ${order.id}`);
        continue;
      }
      processed++;

      const { id, symbol, quantity, purchase_price, gain_margin, loss_margin,
              is_simulation, trailing_enabled, highest_price, trailing_margin,
              kraken_tp_order_id, kraken_sl_order_id, asset_type, signal_id,
              created_by } = order;

      const gainPct = ((price - purchase_price) / purchase_price) * 100;
      let shouldSell = false;
      let reason = '';

      // Update trailing high-water mark
      let peak = highest_price || purchase_price;
      if (price > peak) {
        peak = price;
        await base44.asServiceRole.entities.ConditionalOrder.update(id, { highest_price: peak });
      }

      // Take-Profit check
      if (gainPct >= gain_margin) {
        shouldSell = true;
        reason = `Take-Profit hit (+${gainPct.toFixed(2)}% >= +${gain_margin}%)`;
      }

      // Stop-Loss check
      if (!shouldSell && gainPct <= -loss_margin) {
        shouldSell = true;
        reason = `Stop-Loss hit (${gainPct.toFixed(2)}% <= -${loss_margin}%)`;
      }

      // Trailing stop check
      if (!shouldSell && trailing_enabled && peak > purchase_price && trailing_margin > 0) {
        const dropPct = ((peak - price) / peak) * 100;
        if (dropPct >= trailing_margin) {
          shouldSell = true;
          reason = `Trailing Stop hit (${dropPct.toFixed(2)}% drop from peak $${peak.toFixed(2)})`;
        }
      }

      if (!shouldSell) continue;

      console.log(`[monitor] TRIGGERED ${symbol} #${id}: ${reason} | price=$${price}`);

      // BUG FIX #2: Sell ONLY this order's tracked quantity, not the full account balance.
      // This prevents stacked orders from eating each other's positions.
      let sellQuantity = quantity;
      const minQty = MIN_ORDER_SIZES[symbol] || 0.00001;

      if (!is_simulation) {
        // Verify there's enough available on Kraken to fill THIS order's quantity
        const availMap = await getAvailableMap(base44);
        const available = availMap[symbol] || 0;

        // CRITICAL: Only sell this order's quantity, NOT the full balance.
        // If available < order qty, this order's position was already consumed
        // (likely by a stacked duplicate order that fired first). Cancel cleanly.
        if (available < minQty || quantity > available * 1.05) {
          // Position already consumed — cancel this stale order
          console.warn(`[monitor] ${symbol} #${id}: position consumed (available=${available.toFixed(8)}, order qty=${quantity}) — cancelling stale order`);
          await base44.asServiceRole.entities.ConditionalOrder.update(id, {
            status: 'cancelled',
            closure_reason: `Auto-cancelled: position already consumed. Available ${symbol}: ${available.toFixed(8)}, order needed: ${quantity}`,
            executed_at: new Date().toISOString()
          });
          results.push({ id, symbol, reason, error: `Position consumed: ${available.toFixed(8)} < ${quantity}` });
          continue;
        }

        // Apply 0.5% haircut for fees/rounding but never exceed order quantity
        sellQuantity = Math.min(quantity, available);
        sellQuantity = Math.floor((sellQuantity * 0.995) * 1e8) / 1e8;

        if (sellQuantity < minQty) {
          console.warn(`[monitor] ${symbol} #${id}: adjusted sell qty ${sellQuantity} below Kraken minimum ${minQty} - cancelling`);
          await base44.asServiceRole.entities.ConditionalOrder.update(id, {
            status: 'cancelled', closure_reason: `Auto-cancelled: adjusted quantity (${sellQuantity.toFixed(8)}) below Kraken minimum (${minQty})`,
            executed_at: new Date().toISOString()
          });
          results.push({ id, symbol, reason, error: `Below minimum after adjustment` });
          continue;
        }

        console.log(`[monitor] ${symbol}: order qty=${quantity}, available=${available.toFixed(8)}, selling=${sellQuantity.toFixed(8)}`);
      }

      try {
        // Cancel any existing Kraken TP/SL orders to prevent double-sell
        const toCancel = [kraken_tp_order_id, kraken_sl_order_id].filter(Boolean);
        if (toCancel.length && !is_simulation) {
          try {
            await base44.asServiceRole.functions.invoke('krakenTrade', {
              action: 'cancel_order', orderIds: toCancel
            });
          } catch (ce) {
            console.warn(`[monitor] Cancel linked orders failed: ${ce.message}`);
          }
        }

        let sellResult;
        if (is_simulation) {
          sellResult = { success: true, order_id: `sim_${Date.now()}` };
        } else {
          const res = await base44.asServiceRole.functions.invoke('krakenTrade', {
            action: 'place_order', symbol, side: 'sell', quantity: sellQuantity, orderType: 'market'
          });
          sellResult = res?.data || res;
        }

        if (sellResult?.success) {
          executed++;
          await base44.asServiceRole.entities.ConditionalOrder.update(id, {
            status: 'executed', closure_reason: reason, executed_at: new Date().toISOString()
          });

          // Record Trade
          await base44.asServiceRole.entities.Trade.create({
            symbol, type: 'sell', asset_type: asset_type || 'crypto',
            quantity: sellQuantity, price, total_value: sellQuantity * price,
            status: 'filled', is_auto_trade: true, is_simulation,
            signal_id, kraken_order_id: sellResult.order_id,
            filled_at: new Date().toISOString(), created_by
          });

          // Notify
          await base44.asServiceRole.entities.Notification.create({
            title: `${is_simulation ? 'SIM' : 'LIVE'} ${reason.split(' ')[0]}: ${symbol}`,
            message: `Sold ${sellQuantity} ${symbol} @ $${price.toFixed(2)} – ${reason}`,
            type: gainPct >= 0 ? 'success' : 'warning', read: false,
            details_json: JSON.stringify({ symbol, quantity, price, reason, is_simulation }),
            created_by
          });

          // BUG FIX #4: Write ModelPerformance record for analytics
          try {
            const outcomePct = ((price - purchase_price) / purchase_price) * 100;
            const entryTime = new Date(order.created_date || order.updated_date).getTime();
            const durationMin = Math.round((Date.now() - entryTime) / 60000);
            let exitReason = 'manual';
            if (reason.includes('Take-Profit')) exitReason = 'take_profit';
            else if (reason.includes('Stop-Loss')) exitReason = 'stop_loss';
            else if (reason.includes('Trailing')) exitReason = 'trailing_stop';

            await base44.asServiceRole.entities.ModelPerformance.create({
              signal_id: signal_id || null,
              trade_id: sellResult.order_id || null,
              asset_symbol: symbol,
              entry_price: purchase_price,
              exit_price: price,
              outcome_percentage: Math.round(outcomePct * 100) / 100,
              duration_held_minutes: durationMin,
              is_success: outcomePct > 0,
              exit_reason: exitReason,
              is_simulation: is_simulation,
              created_by
            });
          } catch (mpErr) {
            console.warn(`[monitor] ModelPerformance write failed for ${symbol}:`, mpErr.message);
          }

          results.push({ id, symbol, reason, price, success: true });
        } else {
          console.error(`[monitor] Sell failed for ${symbol}: ${sellResult?.error}`);
          await base44.asServiceRole.entities.ConditionalOrder.update(id, {
            status: 'failed', error_message: sellResult?.error || 'Unknown sell error',
            executed_at: new Date().toISOString()
          });
          await base44.asServiceRole.entities.Notification.create({
            title: `SELL FAILED: ${symbol}`, message: `${reason} but sell failed: ${sellResult?.error}`,
            type: 'error', read: false, created_by
          });
          results.push({ id, symbol, reason, error: sellResult?.error });
        }
      } catch (err) {
        console.error(`[monitor] Error processing ${symbol} #${id}: ${err.message}`);
        await base44.asServiceRole.entities.ConditionalOrder.update(id, {
          status: 'failed', error_message: err.message, executed_at: new Date().toISOString()
        });
        results.push({ id, symbol, reason, error: err.message });
      }
    }

    console.log(`[monitor] Done: ${processed} checked, ${executed} executed in ${Date.now() - start}ms`);
    return Response.json({ success: true, processed, executed, results, duration_ms: Date.now() - start });

  } catch (err) {
    console.error('[monitor] Fatal:', err.message);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});