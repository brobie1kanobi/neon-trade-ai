import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * manualTestTrade — Admin-only manual test trade executor.
 * Delegates to krakenTrade (the real live execution path) and then
 * polls Kraken for fill details via krakenApi.
 *
 * Params: { symbol, usd_amount, action: "buy"|"sell" }
 * Returns: { kraken_order_id, status, filled_quantity, fill_price, fee, error }
 */

Deno.serve(async (req) => {
  const t0 = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const role = (user.role || '').toLowerCase();
    console.log(`[manualTestTrade] User: ${user.email}, role: ${user.role}, is_creator: ${user.is_creator}`);
    if (role !== 'admin' && !user.is_creator) {
      return Response.json({ error: 'Admin only', user_role: user.role }, { status: 403 });
    }

    const body = await req.json();
    const { symbol, usd_amount, action } = body;

    if (!symbol || !usd_amount || !action) {
      return Response.json({ error: 'Required: symbol, usd_amount, action (buy|sell)' }, { status: 400 });
    }
    if (action !== 'buy' && action !== 'sell') {
      return Response.json({ error: 'action must be "buy" or "sell"' }, { status: 400 });
    }

    console.log(`[manualTestTrade] ${action.toUpperCase()} ~$${usd_amount} of ${symbol} for ${user.email}`);

    // ---- Step 1: Determine quantity ----
    let quantity;

    if (action === 'buy') {
      // Fetch current price to calculate quantity
      const priceResp = await base44.asServiceRole.functions.invoke('getKrakenMarketPrices', { symbols: [symbol] });
      const priceData = priceResp?.data || priceResp;
      const price = priceData?.prices?.[symbol] || priceData?.[symbol];
      if (!price || price <= 0) {
        return Response.json({ error: `Could not fetch price for ${symbol}`, price_data: priceData }, { status: 200 });
      }
      quantity = usd_amount / price;
      console.log(`[manualTestTrade] Price: $${price}, raw qty: ${quantity}`);
    } else {
      // Sell: query Kraken balance for available amount
      const balResp = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getExtendedBalance' });
      const balData = balResp?.data || balResp;
      const bal = balData?.balance || balData;
      // Find the asset key (Kraken uses various prefixes)
      const sym = symbol.toUpperCase();
      let available = 0;
      for (const [k, v] of Object.entries(bal || {})) {
        const norm = k.toUpperCase().replace(/^X{1,2}/, '').replace(/^Z/, '');
        const mapped = { XBT: 'BTC', XXBT: 'BTC', XDG: 'DOGE' };
        const resolved = mapped[k.toUpperCase()] || norm;
        if (resolved === sym) {
          if (v && typeof v === 'object') {
            const rawBal = parseFloat(v.balance ?? v.total ?? 0) || 0;
            const held = parseFloat(v.hold_trade ?? v.hold ?? 0) || 0;
            available = rawBal - held;
          } else {
            available = parseFloat(v || 0) || 0;
          }
          break;
        }
      }
      if (available <= 0) {
        return Response.json({ error: `No available ${symbol} to sell`, available }, { status: 200 });
      }
      // Apply 0.5% haircut to avoid "insufficient funds" from fee holds
      quantity = Math.floor(available * 0.995 * 1e8) / 1e8;
      console.log(`[manualTestTrade] Available ${symbol}: ${available}, selling: ${quantity}`);
    }

    // ---- Step 2: Execute via krakenTrade (the real pipeline) ----
    // CRITICAL: Use user-scoped invoke (not asServiceRole) so krakenTrade sees the admin user token
    console.log(`[manualTestTrade] Invoking krakenTrade: ${action} ${quantity} ${symbol}`);
    const tradeResp = await base44.functions.invoke('krakenTrade', {
      action: 'place_order',
      symbol,
      side: action,
      quantity: String(quantity),
      orderType: 'market'
    });
    const tradeData = tradeResp?.data || tradeResp;
    console.log('[manualTestTrade] krakenTrade response:', JSON.stringify(tradeData));

    if (!tradeData?.success) {
      return Response.json({
        step: 'place_order',
        error: tradeData?.error || 'krakenTrade returned failure',
        raw: tradeData,
        duration_ms: Date.now() - t0
      }, { status: 200 });
    }

    const krakenOrderId = tradeData.order_id;

    // ---- Step 3: Poll for fill details ----
    // Market orders usually fill instantly. Poll closed orders a few times.
    let fillInfo = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(r => setTimeout(r, 3000)); // wait 3s between polls
      console.log(`[manualTestTrade] Polling fill (attempt ${attempt + 1})...`);
      try {
        const histResp = await base44.asServiceRole.functions.invoke('krakenApi', {
          action: 'getClosedOrders',
          payload: { trades: true }
        });
        const histData = histResp?.data || histResp;
        const closed = histData?.closed || histData?.result?.closed || {};
        const order = closed[krakenOrderId];
        if (order && (order.status === 'closed' || order.status === 'canceled')) {
          fillInfo = {
            status: order.status,
            filled_quantity: parseFloat(order.vol_exec || 0),
            fill_price: parseFloat(order.price || order.avg_price || 0),
            fee: parseFloat(order.fee || 0),
            cost: parseFloat(order.cost || 0),
            raw_order: order
          };
          console.log('[manualTestTrade] Fill found:', JSON.stringify(fillInfo));
          break;
        }
      } catch (pollErr) {
        console.warn('[manualTestTrade] Poll error:', pollErr.message);
      }
    }

    // ---- Step 4: Return result ----
    return Response.json({
      success: true,
      action,
      symbol,
      usd_amount,
      requested_quantity: quantity,
      kraken_order_id: krakenOrderId,
      filled: !!fillInfo,
      status: fillInfo?.status || 'pending (not yet confirmed)',
      filled_quantity: fillInfo?.filled_quantity || null,
      fill_price: fillInfo?.fill_price || null,
      fee: fillInfo?.fee || null,
      cost: fillInfo?.cost || null,
      duration_ms: Date.now() - t0
    }, { status: 200 });

  } catch (error) {
    console.error('[manualTestTrade] Fatal:', error.message);
    return Response.json({ error: error.message, duration_ms: Date.now() - t0 }, { status: 500 });
  }
});