import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

function keyFor(h) {
  return `${(h.asset_type || '').toLowerCase()}::${(h.symbol || '').toUpperCase()}`;
}

function computeFromTrades(trades) {
  // Build end-state per symbol from trades only (non-destructive merge later keeps symbols without trades)
  const map = new Map();
  // Sort oldest -> newest to compute average cost properly
  const ordered = [...trades].sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());
  for (const t of ordered) {
    const k = keyFor(t);
    if (!map.has(k)) {
      map.set(k, {
        symbol: (t.symbol || '').toUpperCase(),
        asset_type: (t.asset_type || '').toLowerCase(),
        quantity: 0,
        average_cost_price: 0
      });
    }
    const cur = map.get(k);
    if ((t.type || '').toLowerCase() === 'buy') {
      const q = Number(t.quantity) || 0;
      const p = Number(t.price) || 0;
      if (q > 0 && p > 0) {
        const oldQty = cur.quantity || 0;
        const oldCost = (cur.average_cost_price || 0) * oldQty;
        const newQty = oldQty + q;
        const newCost = oldCost + (q * p);
        cur.quantity = newQty;
        cur.average_cost_price = newQty > 0 ? (newCost / newQty) : 0;
      }
    } else if ((t.type || '').toLowerCase() === 'sell') {
      const q = Number(t.quantity) || 0;
      const oldQty = cur.quantity || 0;
      const newQty = oldQty - q;
      cur.quantity = newQty; // can go to or below zero; we'll avoid deletes later
      // Keep average_cost_price unchanged on sell
    }
    map.set(k, cur);
  }
  return map;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Optional body (unused for now)
    let body = {};
    try {
      body = await req.json();
    } catch { /* no-op */ }

    const email = user.email;

    // Process both modes safely (no deletions)
    const modes = [true, false]; // true = sim, false = live
    const results = [];

    for (const isSim of modes) {
      // Fetch existing holdings for merge
      const existingHoldings = await base44.entities.Holding.filter({ created_by: email, is_simulation: isSim });
      const existingMap = new Map(existingHoldings.map(h => [keyFor(h), h]));

      // Fetch trades for this mode
      const trades = await base44.entities.Trade.filter({ created_by: email, is_simulation: isSim });
      const computedMap = computeFromTrades(trades);

      // Upsert without deleting:
      // - If a symbol has trades and computed quantity > 0 => upsert with new qty/avg
      // - If a symbol has trades and computed <= 0 => leave existing as-is (do NOT delete)
      // - Symbols without any trades are untouched (keep existing)
      for (const [k, c] of computedMap.entries()) {
        if (!c || typeof c.quantity !== 'number') continue;
        if (c.quantity > 0) {
          const existing = existingMap.get(k);
          if (existing) {
            await base44.entities.Holding.update(existing.id, {
              quantity: c.quantity,
              average_cost_price: c.average_cost_price
            });
          } else {
            await base44.entities.Holding.create({
              symbol: c.symbol,
              asset_type: c.asset_type,
              quantity: c.quantity,
              average_cost_price: c.average_cost_price,
              is_simulation: isSim,
              created_by: email
            });
          }
        } else {
          // Non-destructive: skip deletes when quantity <= 0
        }
      }

      results.push({ mode: isSim ? 'sim' : 'live', updated: computedMap.size, existing: existingHoldings.length });
    }

    // Reconcile wallet balances for both modes to ensure cash/portfolio totals are correct across app
    try {
      await base44.functions.invoke('reconcileWallet', { mode: 'both' });
    } catch (_e) {
      // Continue even if reconcile fails; frontend will still refresh
    }

    return Response.json({ success: true, results });
  } catch (error) {
    return Response.json({ error: error.message || String(error) }, { status: 500 });
  }
});