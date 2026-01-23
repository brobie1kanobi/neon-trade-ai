import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Sync Kraken Orders - Check and update local ConditionalOrder status
 * 
 * This function fetches open orders from Kraken and reconciles them with
 * local ConditionalOrder records to ensure status accuracy.
 * 
 * CRITICAL: Orders showing as "cancelled" locally but still active on Kraken
 * will be updated to "active" status.
 */

const WS_URL = 'wss://ws-auth.kraken.com/v2';

function getKrakenOpenOrders(token) {
  return new Promise((resolve, reject) => {
    let ws;
    let isResolved = false;
    
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        if (ws) { try { ws.close(); } catch (e) {} }
        reject(new Error('Timeout fetching open orders'));
      }
    }, 15000);
    
    try {
      ws = new WebSocket(WS_URL);
      const orders = [];
      
      ws.onopen = () => {
        console.log('[syncKrakenOrders] WebSocket connected');
        const message = {
          method: 'get_open_orders',
          params: { token },
          req_id: Date.now()
        };
        ws.send(JSON.stringify(message));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[syncKrakenOrders] Received:', data.method);
          
          if (data.channel === 'open_orders' && Array.isArray(data.data)) {
            // Accumulate orders from multiple messages
            orders.push(...data.data);
          }
          
          if (data.method === 'get_open_orders') {
            clearTimeout(timeout);
            if (!isResolved) {
              isResolved = true;
              ws.close();
              
              // Extract order IDs from accumulated data
              const orderIds = orders
                .filter(o => o.order_id)
                .map(o => o.order_id);
              
              console.log('[syncKrakenOrders] Total open orders:', orderIds.length);
              resolve({ success: true, order_ids: orderIds, orders });
            }
          }
        } catch (e) {
          console.error('[syncKrakenOrders] Parse error:', e);
        }
      };
      
      ws.onerror = (error) => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket error: ' + (error?.message || 'unknown')));
        }
      };
      
      ws.onclose = (event) => {
        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          // If connection closed normally after receiving data, consider it success
          if (orders.length > 0) {
            const orderIds = orders
              .filter(o => o.order_id)
              .map(o => o.order_id);
            resolve({ success: true, order_ids: orderIds, orders });
          } else {
            reject(new Error(`WebSocket closed (code: ${event?.code})`));
          }
        }
      };
      
    } catch (error) {
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    }
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    // Get Kraken connection
    const connections = await base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }, '-updated_date', 1);

    if (!connections || connections.length === 0) {
      return Response.json({
        error: 'Kraken account not connected',
        success: false,
        synced: 0
      }, { status: 200 });
    }

    // Fetch open orders via REST using BALANCE key
    const ordersResp = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getOpenOrders' });
    const ordersData = ordersResp?.data || ordersResp;
    if (ordersData?.success === false) {
      throw new Error(ordersData?.error || 'Failed to fetch open orders');
    }
    const activeKrakenOrderIds = (ordersData?.orders || []).map(o => o.order_id).filter(Boolean);
    
    console.log('[syncKrakenOrders] Active Kraken orders:', activeKrakenOrderIds.length);

    // Get all local ConditionalOrders (LIVE mode only)
    const localOrders = await base44.asServiceRole.entities.ConditionalOrder.filter({
      created_by: user.email,
      is_simulation: false
    });

    console.log('[syncKrakenOrders] Local conditional orders:', localOrders.length);

    let updatedCount = 0;
    let cancelledCount = 0;
    const updates = [];

    for (const localOrder of localOrders) {
      if (!localOrder.kraken_order_id) continue;
      
      const localKrakenIds = localOrder.kraken_order_id
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
      
      // Check if ANY of the local order's Kraken IDs are still active
      const hasActiveKrakenOrder = localKrakenIds.some(id => 
        activeKrakenOrderIds.includes(id)
      );
      
      // Check which specific orders are still active
      const stillActiveIds = localKrakenIds.filter(id => 
        activeKrakenOrderIds.includes(id)
      );
      
      if (hasActiveKrakenOrder && localOrder.status !== 'active') {
        // Order is active on Kraken but marked as cancelled/executed locally - FIX IT
        console.log('[syncKrakenOrders] 🔧 Reactivating order:', localOrder.id, 'for', localOrder.symbol);
        
        await base44.asServiceRole.entities.ConditionalOrder.update(localOrder.id, {
          status: 'active',
          error_message: null,
          closure_reason: null
        });
        
        updatedCount++;
        updates.push({
          order_id: localOrder.id,
          symbol: localOrder.symbol,
          action: 'reactivated',
          kraken_order_ids: stillActiveIds
        });
      } else if (!hasActiveKrakenOrder && localOrder.status === 'active') {
        // Order is cancelled on Kraken but still active locally - mark as cancelled
        console.log('[syncKrakenOrders] 🔧 Cancelling stale order:', localOrder.id, 'for', localOrder.symbol);
        
        await base44.asServiceRole.entities.ConditionalOrder.update(localOrder.id, {
          status: 'cancelled',
          closure_reason: 'Kraken order no longer active - synced from exchange'
        });
        
        cancelledCount++;
        updates.push({
          order_id: localOrder.id,
          symbol: localOrder.symbol,
          action: 'cancelled',
          reason: 'not_found_on_kraken'
        });
      } else if (hasActiveKrakenOrder && stillActiveIds.length < localKrakenIds.length) {
        // Some orders filled, some still active - this is a partial bracket execution
        console.log('[syncKrakenOrders] 🔧 Partial bracket detected for:', localOrder.symbol);
        console.log('[syncKrakenOrders] Still active:', stillActiveIds);
        console.log('[syncKrakenOrders] Missing:', localKrakenIds.filter(id => !stillActiveIds.includes(id)));
        
        // Keep order active but update the error message to reflect partial state
        await base44.asServiceRole.entities.ConditionalOrder.update(localOrder.id, {
          status: 'active',
          error_message: `Partial bracket: ${stillActiveIds.length} of ${localKrakenIds.length} orders still active`,
          kraken_order_id: stillActiveIds.join(',') // Update to only active orders
        });
        
        updatedCount++;
        updates.push({
          order_id: localOrder.id,
          symbol: localOrder.symbol,
          action: 'partial_bracket_update',
          active_ids: stillActiveIds,
          filled_ids: localKrakenIds.filter(id => !stillActiveIds.includes(id))
        });
      }
    }

    console.log('[syncKrakenOrders] ✅ Sync complete:', {
      reactivated: updatedCount,
      cancelled: cancelledCount,
      total_updates: updates.length
    });

    return Response.json({
      success: true,
      kraken_open_orders: activeKrakenOrderIds.length,
      local_orders_checked: localOrders.length,
      reactivated: updatedCount,
      cancelled: cancelledCount,
      updates
    }, { status: 200 });

  } catch (error) {
    console.error('[syncKrakenOrders] Error:', error.message);
    
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});