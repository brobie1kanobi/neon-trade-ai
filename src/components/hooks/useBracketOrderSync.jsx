import { useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { ConditionalOrder } from '@/entities/all';
import { notify } from '@/components/utils/notifications';

/**
 * BRACKET ORDER SYNCHRONIZATION HOOK
 * 
 * When a stop-loss OR take-profit order is filled on Kraken,
 * this hook automatically cancels the other paired order.
 * 
 * Flow:
 * 1. WebSocket receives 'filled' execution for an order
 * 2. This hook looks up the ConditionalOrder to find the paired order IDs
 * 3. Cancels the remaining order(s) on Kraken
 * 4. Updates the local ConditionalOrder status
 */

export function useBracketOrderSync(isSimMode, userEmail) {
  const processingRef = useRef(new Set());
  const lastProcessedRef = useRef(new Map());

  // Handle when an order is filled on Kraken
  const handleOrderFilled = useCallback(async (event) => {
    const eventData = event.detail || event;
    const { order_id, side, quantity, price, exec_type } = eventData;
    // CRITICAL: symbol may come as 'symbol' or 'pair' from Kraken WebSocket
    const symbol = eventData.symbol || eventData.pair || null;
    
    if (!order_id || !userEmail || isSimMode) return;
    
    // Prevent duplicate processing
    const processKey = `${order_id}-${Date.now()}`;
    if (processingRef.current.has(order_id)) {
      console.log('[BracketSync] Already processing order:', order_id);
      return;
    }
    
    // Debounce - don't process same order within 5 seconds
    const lastProcessed = lastProcessedRef.current.get(order_id);
    if (lastProcessed && Date.now() - lastProcessed < 5000) {
      console.log('[BracketSync] Recently processed order:', order_id);
      return;
    }
    
    processingRef.current.add(order_id);
    lastProcessedRef.current.set(order_id, Date.now());
    
    console.log('[BracketSync] 🔔 Order filled on Kraken:', order_id, symbol, side, quantity, '@ $', price);
    
    try {
      // Find the ConditionalOrder that contains this Kraken order ID
      const conditionalOrders = await ConditionalOrder.filter({
        created_by: userEmail,
        status: 'active',
        is_simulation: false
      });
      
      // Look for the order that contains this kraken_order_id
      const matchingOrder = conditionalOrders.find(co => {
        if (!co.kraken_order_id) return false;
        const orderIds = co.kraken_order_id.split(',').map(id => id.trim());
        return orderIds.includes(order_id);
      });
      
      if (!matchingOrder) {
        console.log('[BracketSync] No matching ConditionalOrder found for Kraken order:', order_id);
        processingRef.current.delete(order_id);
        return;
      }
      
      console.log('[BracketSync] Found ConditionalOrder:', matchingOrder.id, 'for symbol:', matchingOrder.symbol);
      
      // Get all paired order IDs (stop-loss + take-profit)
      const allOrderIds = matchingOrder.kraken_order_id.split(',').map(id => id.trim()).filter(Boolean);
      
      // Find the OTHER order(s) that need to be cancelled
      const ordersToCancel = allOrderIds.filter(id => id !== order_id);
      
      if (ordersToCancel.length === 0) {
        console.log('[BracketSync] No paired orders to cancel');
      } else {
        console.log('[BracketSync] 🗑️ Cancelling paired orders on Kraken:', ordersToCancel);
        
        try {
          const cancelResponse = await base44.functions.invoke('krakenTrade', {
            action: 'cancel_order',
            orderIds: ordersToCancel
          });
          
          const cancelData = cancelResponse?.data || cancelResponse;
          
          if (cancelData?.success) {
            console.log('[BracketSync] ✅ Successfully cancelled paired orders:', cancelData.order_ids);
            notify.success(`🔄 Bracket Order Cleanup`, {
              description: `${symbol} ${side === 'sell' ? 'Sold' : 'Bought'} - cancelled ${ordersToCancel.length} paired order(s)`,
              duration: 4000
            });
          } else {
            console.warn('[BracketSync] Cancel may have failed:', cancelData?.error);
            notify.warning('Bracket cleanup may have failed', {
              description: cancelData?.error || 'Orders may already be cancelled on Kraken'
            });
            // Don't fail completely - the order might have already been cancelled
          }
        } catch (cancelError) {
          console.error('[BracketSync] Cancel error:', cancelError.message);
          // Continue to update local order - Kraken order might already be cancelled
        }
      }
      
      // Calculate the result of this trade
      const fillPrice = parseFloat(price) || 0;
      const fillQty = parseFloat(quantity) || matchingOrder.quantity || 0;
      const purchasePrice = matchingOrder.purchase_price || 0;
      const pnl = (fillPrice - purchasePrice) * fillQty;
      const pnlPct = purchasePrice > 0 ? ((fillPrice - purchasePrice) / purchasePrice) * 100 : 0;
      
      // Determine if this was stop-loss or take-profit
      const wasStopLoss = fillPrice < purchasePrice;
      const orderType = wasStopLoss ? 'stop-loss' : 'take-profit';
      
      // Update the local ConditionalOrder
      await ConditionalOrder.update(matchingOrder.id, {
        status: 'executed',
        closure_reason: `${orderType.toUpperCase()} triggered: Sold ${fillQty.toFixed(4)} ${symbol} @ $${fillPrice.toFixed(2)} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}, ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%). Paired orders cancelled.`,
        error_message: null
      });
      
      console.log('[BracketSync] ✅ Updated ConditionalOrder:', matchingOrder.id, 'as executed');
      
      // Record the trade in local DB
      try {
        await base44.entities.Trade.create({
          symbol: displaySymbol,
          type: 'sell',
          asset_type: matchingOrder.asset_type || 'crypto',
          quantity: fillQty,
          price: fillPrice,
          total_value: fillQty * fillPrice,
          is_auto_trade: true,
          is_simulation: false,
          status: 'executed',
          created_by: userEmail
        });
        console.log('[BracketSync] ✅ Recorded trade in local DB');
      } catch (tradeError) {
        console.error('[BracketSync] Failed to record trade:', tradeError);
      }
      
      // Emit event for UI refresh
      window.dispatchEvent(new CustomEvent('app:data-updated', {
        detail: { 
          type: 'bracket-order-filled', 
          source: 'bracket-sync',
          data: { order_id, symbol, side, quantity, price, pnl, orderType }
        }
      }));
      
      // Show prominent notification
      // CRITICAL: Use matchingOrder.symbol as fallback since event symbol may be undefined
      const displaySymbol = symbol || matchingOrder.symbol || 'Unknown';
      const emoji = pnl >= 0 ? '💰' : '🛡️';
      notify.success(`${emoji} ${orderType === 'take-profit' ? 'Profit Taken!' : 'Stop-Loss Triggered'}`, {
        description: `${displaySymbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`,
        duration: 6000,
        data: {
          symbol: displaySymbol,
          orderType,
          pnl: pnl.toFixed(2),
          pnlPct: pnlPct.toFixed(2),
          fillPrice: fillPrice.toFixed(2),
          quantity: fillQty.toFixed(4),
          purchasePrice: purchasePrice.toFixed(2)
        }
      });
      
      // Send push notification if app is in background
      if (document.visibilityState === 'hidden') {
        base44.functions.invoke('pushNotifications', {
          action: 'sendNotification',
          payload: {
            title: `${emoji} ${orderType === 'take-profit' ? 'Profit Taken!' : 'Stop-Loss Triggered'} • ${displaySymbol}`,
            body: `Sold at $${fillPrice.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`,
            data: { type: 'bracket_executed', symbol: displaySymbol, orderType, pnl }
          }
        }).catch(() => {});
      }
      
    } catch (error) {
      console.error('[BracketSync] Error handling filled order:', error);
    } finally {
      processingRef.current.delete(order_id);
    }
  }, [isSimMode, userEmail]);

  // Handle when an order is cancelled on Kraken (external cancellation)
  const handleOrderCanceled = useCallback(async (event) => {
    const { order_id, symbol, exec_type } = event.detail || event;
    
    if (!order_id || !userEmail || isSimMode) return;
    
    console.log('[BracketSync] 🔔 Order cancelled on Kraken:', order_id, symbol, exec_type);
    
    // We don't need to do much here - just log it
    // If the user manually cancelled on Kraken, they can also cancel in the app
  }, [isSimMode, userEmail]);

  // Listen for WebSocket events
  useEffect(() => {
    if (isSimMode || !userEmail) return;
    
    const handleFilledEvent = (e) => handleOrderFilled(e);
    const handleCanceledEvent = (e) => handleOrderCanceled(e);
    
    window.addEventListener('kraken:order-filled', handleFilledEvent);
    window.addEventListener('kraken:order-canceled', handleCanceledEvent);
    
    console.log('[BracketSync] ✅ Listening for Kraken order events');
    
    return () => {
      window.removeEventListener('kraken:order-filled', handleFilledEvent);
      window.removeEventListener('kraken:order-canceled', handleCanceledEvent);
    };
  }, [isSimMode, userEmail, handleOrderFilled, handleOrderCanceled]);

  return {
    handleOrderFilled,
    handleOrderCanceled
  };
}