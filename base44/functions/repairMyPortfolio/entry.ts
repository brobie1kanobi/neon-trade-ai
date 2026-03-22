import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read current mode from user settings
    const settings = await base44.entities.UserSettings.filter({ created_by: user.email });
    const simMode = (settings?.[0]?.sim_trading_mode !== false);

    // Fetch all trades for this user and mode, sort chronologically
    let trades = await base44.entities.Trade.filter({ created_by: user.email, is_simulation: simMode }, 'created_date');
    trades = Array.isArray(trades) ? trades : [];
    trades.sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());

    // Rebuild holdings using correct average-cost basis
    const EPS = 1e-8;
    const state = {}; // symbol -> { qty, total_cost, asset_type }

    for (const t of trades) {
      const sym = (t.symbol || '').toUpperCase();
      if (!sym) continue;
      const qty = Number(t.quantity) || 0;
      const price = Number(t.price) || 0;
      const type = (t.type || '').toLowerCase();

      if (!state[sym]) {
        state[sym] = { qty: 0, total_cost: 0, asset_type: t.asset_type || 'crypto' };
      } else if (!state[sym].asset_type && t.asset_type) {
        state[sym].asset_type = t.asset_type;
      }

      if (type === 'buy') {
        state[sym].qty += qty;
        state[sym].total_cost += qty * price;
      } else if (type === 'sell') {
        const currentQty = state[sym].qty;
        const currentCost = state[sym].total_cost;
        const avgCost = currentQty > EPS ? (currentCost / currentQty) : 0;

        // Cap sell to available quantity; reduce cost basis at avg cost
        const sellQty = Math.min(qty, Math.max(0, currentQty));
        state[sym].qty = Math.max(0, currentQty - sellQty);
        state[sym].total_cost = Math.max(0, currentCost - sellQty * avgCost);
      }
    }

    // Build final holdings list (no negatives, sensible averages)
    const rebuilt = Object.entries(state)
      .map(([symbol, s]) => {
        const q = Number(s.qty) || 0;
        const c = Number(s.total_cost) || 0;
        if (q <= EPS) return null;
        const avg = c > 0 ? (c / q) : 0;
        return {
          symbol,
          asset_type: s.asset_type || 'crypto',
          quantity: q,
          average_cost_price: avg
        };
      })
      .filter(Boolean);

    // Safety snapshot of current holdings for rollback
    const existing = await base44.entities.Holding.filter({ created_by: user.email, is_simulation: simMode });
    await base44.entities.HoldingsSnapshot.create({
      is_simulation: simMode,
      holdings_json: JSON.stringify(existing || []),
      note: 'Auto-backup before repairMyPortfolio',
      created_at: new Date().toISOString(),
      created_by: user.email
    });

    // Replace only this user's holdings for the current mode
    for (const h of (existing || [])) {
      await base44.entities.Holding.delete(h.id);
    }
    for (const h of rebuilt) {
      await base44.entities.Holding.create({ ...h, is_simulation: simMode, created_by: user.email });
    }

    return Response.json({
      success: true,
      mode: simMode ? 'simulation' : 'live',
      trades_count: trades.length,
      holdings_before: existing?.length || 0,
      holdings_after: rebuilt.length
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
});