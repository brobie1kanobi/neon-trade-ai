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

export function useConditionalOrderMonitor(userEmail) {
  const { settings } = useSettings();
  const { prices: wsPrices, wsUpdateCounter } = useKrakenWebSocket();
  const isSimMode = settings?.sim_trading_mode !== false;

  const activeOrdersRef = useRef([]);
  const lastOrderFetchRef = useRef(0);
  const lastCheckRef = useRef(0);
  const processingRef = useRef(new Set());

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
        toast.error(`Sell failed for ${sym}`, { description: err.message });
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