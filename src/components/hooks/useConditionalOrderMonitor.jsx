import { useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useKrakenWebSocket } from '@/components/providers/KrakenWebSocketProvider';
import { useSettings } from '@/components/utils/SettingsContext';
import { toast } from 'sonner';

/**
 * REAL-TIME CONDITIONAL ORDER MONITOR
 * 
 * Piggybacks on the existing 30s Kraken price polling in KrakenWebSocketProvider
 * to check active ConditionalOrders against live prices. This ensures TP/SL
 * triggers fire within ~30s instead of waiting for the hourly backend monitor.
 * 
 * Works for BOTH SIM and LIVE modes:
 * - SIM: Executes sell via local DB operations
 * - LIVE: Executes sell via krakenTrade backend function
 */

const MIN_CHECK_INTERVAL_MS = 25000; // Don't check more often than every 25s
const STALE_ORDERS_CACHE_MS = 60000; // Re-fetch orders from DB every 60s

// Kraken minimum order sizes per asset
const MIN_ORDER_SIZES = {
  'BTC': 0.00005, 'XBT': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4,
  'DOT': 0.5, 'DOGE': 13.0, 'LINK': 0.2, 'UNI': 0.5, 'ATOM': 0.5, 'AVAX': 0.1,
  'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0, 'SHIB': 100000.0, 'XLM': 20.0,
  'PEPE': 500000.0, 'SUI': 3.0, 'HBAR': 20.0, 'NEAR': 0.7, 'BONK': 500000.0,
  'FLOKI': 105000.0, 'TRUMP': 0.2
};

export function useConditionalOrderMonitor(userEmail) {
  const { settings } = useSettings();
  const { prices: wsPrices, wsUpdateCounter, balances: wsBalances } = useKrakenWebSocket();
  const isSimMode = settings?.sim_trading_mode !== false;

  const activeOrdersRef = useRef([]);
  const lastOrderFetchRef = useRef(0);
  const lastCheckRef = useRef(0);
  const processingRef = useRef(new Set());
  const failedOrdersRef = useRef(new Set()); // Track orders that failed — don't retry

  // Fetch active conditional orders from DB (cached for 60s)
  const refreshOrders = useCallback(async () => {
    if (!userEmail) return;
    const now = Date.now();
    if (now - lastOrderFetchRef.current < STALE_ORDERS_CACHE_MS) return;
    
    try {
      const orders = await base44.entities.ConditionalOrder.filter({
        created_by: userEmail,
        status: 'active'
      });
      // Only monitor orders matching current mode
      activeOrdersRef.current = orders.filter(o => 
        (isSimMode && o.is_simulation !== false) || (!isSimMode && o.is_simulation === false)
      );
      lastOrderFetchRef.current = now;
    } catch (e) {
      console.warn('[OrderMonitor] Failed to fetch orders:', e.message);
    }
  }, [userEmail, isSimMode]);

  // Check all active orders against current prices
  const checkOrders = useCallback(async () => {
    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;

    await refreshOrders();
    const orders = activeOrdersRef.current;
    if (!orders.length) return;

    // Build price map from WS/poll data + Kraken public API window globals
    const priceMap = {};
    if (typeof window !== 'undefined' && window.__krakenWsPrices) {
      Object.entries(window.__krakenWsPrices).forEach(([pair, data]) => {
        const sym = pair.replace('/USD', '');
        if (data?.price > 0) priceMap[sym] = data.price;
      });
    }
    // Also merge from provider wsPrices
    if (wsPrices) {
      Object.entries(wsPrices).forEach(([pair, data]) => {
        const sym = pair.replace('/USD', '');
        if (data?.price > 0) priceMap[sym] = data.price;
      });
    }

    if (Object.keys(priceMap).length === 0) return;

    for (const order of orders) {
      const sym = (order.symbol || '').toUpperCase();
      const price = priceMap[sym];
      if (!price || price <= 0) continue;
      if (processingRef.current.has(order.id)) continue;

      const { purchase_price, gain_margin, loss_margin, trailing_enabled,
              highest_price, trailing_margin, quantity } = order;
      if (!purchase_price || purchase_price <= 0) continue;

      const gainPct = ((price - purchase_price) / purchase_price) * 100;
      let shouldSell = false;
      let reason = '';

      // Update trailing high-water mark
      let peak = highest_price || purchase_price;
      if (price > peak) {
        peak = price;
        try {
          await base44.entities.ConditionalOrder.update(order.id, { highest_price: peak });
        } catch (_) {}
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
          reason = `Trailing Stop (${dropPct.toFixed(2)}% drop from peak $${peak.toFixed(2)})`;
        }
      }

      if (!shouldSell) continue;

      // PRE-FLIGHT: Check if this order already failed permanently — skip to avoid spam
      if (failedOrdersRef.current.has(order.id)) continue;

      // PRE-FLIGHT: Check quantity against Kraken minimum order size
      const minQty = MIN_ORDER_SIZES[sym] || 0.00001;
      if (quantity < minQty) {
        console.log(`[OrderMonitor] Auto-cancelling ${sym} order #${order.id} — qty ${quantity} below Kraken min ${minQty}`);
        failedOrdersRef.current.add(order.id);
        try {
          await base44.entities.ConditionalOrder.update(order.id, {
            status: 'cancelled',
            closure_reason: `Auto-cancelled: quantity ${quantity} below Kraken minimum ${minQty}`,
            executed_at: new Date().toISOString()
          });
          activeOrdersRef.current = activeOrdersRef.current.filter(o => o.id !== order.id);
        } catch (_) {}
        continue;
      }

      // BUG FIX #2: PRE-FLIGHT (LIVE): Check available balance can cover THIS order's quantity
      if (!isSimMode && wsBalances) {
        const balEntry = wsBalances[sym] || wsBalances[`X${sym}`];
        const available = balEntry?.balance || balEntry?.available || 0;
        // If available < order qty, this position was already consumed by a stacked order
        if (available < minQty || quantity > available * 1.05) {
          console.log(`[OrderMonitor] Position consumed for ${sym} order #${order.id} — available ${available}, needed ${quantity}`);
          failedOrdersRef.current.add(order.id);
          try {
            await base44.entities.ConditionalOrder.update(order.id, {
              status: 'cancelled',
              closure_reason: `Auto-cancelled: position consumed. Available ${sym}: ${typeof available === 'number' ? available.toFixed(8) : available}. Order needed: ${quantity}`,
              executed_at: new Date().toISOString()
            });
            activeOrdersRef.current = activeOrdersRef.current.filter(o => o.id !== order.id);
          } catch (_) {}
          continue;
        }
      }

      // TRIGGER SELL
      processingRef.current.add(order.id);
      console.log(`[OrderMonitor] 🔔 TRIGGERED ${sym}: ${reason} @ $${price.toFixed(2)}`);

      try {
        if (isSimMode) {
          // SIM: Record trade + update order locally
          await base44.entities.Trade.create({
            symbol: sym,
            type: 'sell',
            asset_type: order.asset_type || 'crypto',
            quantity,
            price,
            total_value: quantity * price,
            status: 'filled',
            is_auto_trade: true,
            is_simulation: true,
            created_by: userEmail
          });

          // Update holding
          try {
            const holdings = await base44.entities.Holding.filter({
              created_by: userEmail, symbol: sym, is_simulation: true
            });
            if (holdings.length > 0) {
              const h = holdings[0];
              const newQty = (h.quantity || 0) - quantity;
              if (newQty <= 0.00001) {
                await base44.entities.Holding.delete(h.id);
              } else {
                await base44.entities.Holding.update(h.id, { quantity: newQty });
              }
            }
          } catch (_) {}

          // Update wallet
          try {
            const wallets = await base44.entities.Wallet.filter({ created_by: userEmail });
            if (wallets.length > 0) {
              const w = wallets[0];
              await base44.entities.Wallet.update(w.id, {
                cash_balance: (w.cash_balance || 0) + quantity * price
              });
            }
          } catch (_) {}

        } else {
          // LIVE: Cancel existing Kraken TP/SL orders first, then sell
          const toCancel = [order.kraken_tp_order_id, order.kraken_sl_order_id].filter(Boolean);
          if (toCancel.length > 0) {
            try {
              await base44.functions.invoke('krakenTrade', {
                action: 'cancel_order', orderIds: toCancel
              });
            } catch (_) {}
          }

          const res = await base44.functions.invoke('krakenTrade', {
            action: 'place_order', symbol: sym, side: 'sell',
            quantity, orderType: 'market'
          });
          const data = res?.data || res;
          if (!data?.success) {
            throw new Error(data?.error || 'Sell failed on Kraken');
          }

          // Record trade
          await base44.entities.Trade.create({
            symbol: sym, type: 'sell', asset_type: order.asset_type || 'crypto',
            quantity, price, total_value: quantity * price,
            status: 'filled', is_auto_trade: true, is_simulation: false,
            kraken_order_id: data.order_id, filled_at: new Date().toISOString(),
            created_by: userEmail
          });
        }

        // Mark order as executed
        await base44.entities.ConditionalOrder.update(order.id, {
          status: 'executed',
          closure_reason: reason,
          executed_at: new Date().toISOString()
        });

        // Remove from local cache
        activeOrdersRef.current = activeOrdersRef.current.filter(o => o.id !== order.id);

        // BUG FIX #4: Write ModelPerformance record for analytics
        try {
          const outcomePct = ((price - purchase_price) / purchase_price) * 100;
          const entryTime = new Date(order.created_date || order.updated_date).getTime();
          const durationMin = Math.round((Date.now() - entryTime) / 60000);
          let exitReason = 'manual';
          if (reason.includes('Take-Profit')) exitReason = 'take_profit';
          else if (reason.includes('Stop-Loss')) exitReason = 'stop_loss';
          else if (reason.includes('Trailing')) exitReason = 'trailing_stop';

          await base44.entities.ModelPerformance.create({
            signal_id: order.signal_id || null,
            trade_id: order.trade_id || null,
            asset_symbol: sym,
            entry_price: purchase_price,
            exit_price: price,
            outcome_percentage: Math.round(outcomePct * 100) / 100,
            duration_held_minutes: durationMin,
            is_success: outcomePct > 0,
            exit_reason: exitReason,
            is_simulation: isSimMode,
            created_by: userEmail
          });
        } catch (_) {}

        // Notify
        const pnl = (price - purchase_price) * quantity;
        const emoji = pnl >= 0 ? '💰' : '🛡️';
        const modeLabel = isSimMode ? 'SIM' : 'LIVE';
        toast.success(`${emoji} ${modeLabel} ${reason.split('(')[0].trim()}`, {
          description: `${sym}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} @ $${price.toFixed(2)}`,
          duration: 6000
        });

        // Emit events for UI refresh
        window.dispatchEvent(new CustomEvent('trade:completed', {
          detail: { timestamp: Date.now(), symbol: sym }
        }));

        // Create notification entity
        try {
          await base44.entities.Notification.create({
            title: `${emoji} ${modeLabel} ${pnl >= 0 ? 'Profit Taken' : 'Stop-Loss'}: ${sym}`,
            message: `Sold ${quantity.toFixed(6)} ${sym} @ $${price.toFixed(2)} – ${reason}`,
            type: pnl >= 0 ? 'success' : 'warning',
            read: false,
            details_json: JSON.stringify({ symbol: sym, quantity, price, reason, pnl, is_simulation: isSimMode }),
            created_by: userEmail
          });
        } catch (_) {}

      } catch (err) {
        console.error(`[OrderMonitor] Failed to execute sell for ${sym}:`, err.message);
        const errMsg = err.message || '';
        // Permanent failures: mark order so we don't retry every 30s
        if (/insufficient|minimum|invalid volume|too small|below minimum/i.test(errMsg)) {
          failedOrdersRef.current.add(order.id);
          try {
            await base44.entities.ConditionalOrder.update(order.id, {
              status: 'cancelled',
              closure_reason: `Auto-cancelled: ${errMsg}`,
              executed_at: new Date().toISOString()
            });
            activeOrdersRef.current = activeOrdersRef.current.filter(o => o.id !== order.id);
          } catch (_) {}
        } else {
          // Transient error — show toast once but allow retry
          toast.error(`Sell failed for ${sym}`, { description: errMsg });
        }
      } finally {
        processingRef.current.delete(order.id);
      }
    }
  }, [wsPrices, userEmail, isSimMode, refreshOrders]);

  // Run check every time prices update (wsUpdateCounter increments on every WS/poll event)
  useEffect(() => {
    if (!userEmail) return;
    checkOrders();
  }, [wsUpdateCounter, checkOrders, userEmail]);

  // Also run on a 30s interval as a safety net
  useEffect(() => {
    if (!userEmail) return;
    const id = setInterval(checkOrders, 30000);
    return () => clearInterval(id);
  }, [checkOrders, userEmail]);

  // Force refresh orders when a trade completes (new conditional order may have been created)
  useEffect(() => {
    const handler = () => {
      lastOrderFetchRef.current = 0; // invalidate cache
    };
    window.addEventListener('trade:completed', handler);
    return () => window.removeEventListener('trade:completed', handler);
  }, []);
}