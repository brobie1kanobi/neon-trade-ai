import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Sync Kraken Orders — Routes through krakenApi to respect rate limits.
 * No direct Kraken API or WebSocket calls.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });

    const hasBal = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
    if (!hasBal) {
      return Response.json({ error: 'Kraken account not connected', success: false, synced: 0 }, { status: 200 });
    }

    // Fetch open orders via krakenApi (rate-limited)
    const ordersRes = await base44.functions.invoke('krakenApi', { action: 'getOpenOrders' });
    const ordersData = ordersRes?.data || ordersRes;
    if (!ordersData?.success) {
      throw new Error(ordersData?.error || 'Failed to fetch open orders');
    }

    const activeKrakenOrderIds = (ordersData.orders || []).map(o => o.order_id).filter(Boolean);
    console.log('[syncKrakenOrders] Active Kraken orders:', activeKrakenOrderIds.length);

    // Get all local ConditionalOrders (LIVE mode only)
    const localOrders = await base44.asServiceRole.entities.ConditionalOrder.filter({
      created_by: user.email, is_simulation: false
    });
    console.log('[syncKrakenOrders] Local conditional orders:', localOrders.length);

    let updatedCount = 0;
    let cancelledCount = 0;
    const updates = [];

    for (const localOrder of localOrders) {
      if (!localOrder.kraken_order_id) continue;

      const localKrakenIds = localOrder.kraken_order_id.split(',').map(id => id.trim()).filter(Boolean);
      const hasActiveKrakenOrder = localKrakenIds.some(id => activeKrakenOrderIds.includes(id));
      const stillActiveIds = localKrakenIds.filter(id => activeKrakenOrderIds.includes(id));

      if (hasActiveKrakenOrder && localOrder.status !== 'active') {
        console.log('[syncKrakenOrders] 🔧 Reactivating order:', localOrder.id, 'for', localOrder.symbol);
        await base44.asServiceRole.entities.ConditionalOrder.update(localOrder.id, {
          status: 'active', error_message: null, closure_reason: null
        });
        updatedCount++;
        updates.push({ order_id: localOrder.id, symbol: localOrder.symbol, action: 'reactivated', kraken_order_ids: stillActiveIds });
      } else if (!hasActiveKrakenOrder && localOrder.status === 'active') {
        console.log('[syncKrakenOrders] 🔧 Cancelling stale order:', localOrder.id, 'for', localOrder.symbol);
        await base44.asServiceRole.entities.ConditionalOrder.update(localOrder.id, {
          status: 'cancelled', closure_reason: 'Kraken order no longer active - synced from exchange'
        });
        cancelledCount++;
        updates.push({ order_id: localOrder.id, symbol: localOrder.symbol, action: 'cancelled', reason: 'not_found_on_kraken' });
      } else if (hasActiveKrakenOrder && stillActiveIds.length < localKrakenIds.length) {
        console.log('[syncKrakenOrders] 🔧 Partial bracket detected for:', localOrder.symbol);
        await base44.asServiceRole.entities.ConditionalOrder.update(localOrder.id, {
          status: 'active',
          error_message: `Partial bracket: ${stillActiveIds.length} of ${localKrakenIds.length} orders still active`,
          kraken_order_id: stillActiveIds.join(',')
        });
        updatedCount++;
        updates.push({
          order_id: localOrder.id, symbol: localOrder.symbol, action: 'partial_bracket_update',
          active_ids: stillActiveIds, filled_ids: localKrakenIds.filter(id => !stillActiveIds.includes(id))
        });
      }
    }

    console.log('[syncKrakenOrders] ✅ Sync complete:', { reactivated: updatedCount, cancelled: cancelledCount });

    return Response.json({
      success: true,
      kraken_open_orders: activeKrakenOrderIds.length,
      local_orders_checked: localOrders.length,
      reactivated: updatedCount, cancelled: cancelledCount, updates
    }, { status: 200 });

  } catch (error) {
    console.error('[syncKrakenOrders] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});