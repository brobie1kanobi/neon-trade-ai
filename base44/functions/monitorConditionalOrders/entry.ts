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

    // Auth check – allow admins manually, automations run with service role
    try {
      const user = await base44.auth.me();
      if (user && user.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } catch (_) { /* automation – no user context */ }

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
            action: 'place_order', symbol, side: 'sell', quantity, orderType: 'market'
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
            quantity, price, total_value: quantity * price,
            status: 'filled', is_auto_trade: true, is_simulation,
            signal_id, kraken_order_id: sellResult.order_id,
            filled_at: new Date().toISOString(), created_by
          });

          // Notify
          await base44.asServiceRole.entities.Notification.create({
            title: `${is_simulation ? 'SIM' : 'LIVE'} ${reason.split(' ')[0]}: ${symbol}`,
            message: `Sold ${quantity} ${symbol} @ $${price.toFixed(2)} – ${reason}`,
            type: gainPct >= 0 ? 'success' : 'warning', read: false,
            details_json: JSON.stringify({ symbol, quantity, price, reason, is_simulation }),
            created_by
          });

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