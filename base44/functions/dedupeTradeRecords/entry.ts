import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { callKrakenPrivate, normalizeKrakenSymbol } from '../../shared/krakenPrivate.ts';

/**
 * ONE-TIME CLEANUP: remove phantom duplicate LIVE Trade records.
 *
 * A single Kraken sell used to produce TWO local Trade records:
 *  - one written by monitorConditionalOrders from an optimistic ticker price
 *    (falsely showing a profit), and
 *  - one written by syncTradesWithKraken from the real fill.
 *
 * This groups LIVE trades into clusters (same symbol + side, within a short time
 * window), then keeps the ONE record that matches Kraken's actual fill and deletes
 * the phantom(s). A cluster is only touched when a genuine Kraken fill backs it —
 * records with no matching exchange fill are reported, never deleted.
 *
 * Call with { apply: true } to delete. Default is a dry run.
 */

const CLUSTER_WINDOW_MS = 300000; // 5 minutes

function tradeTime(t) {
  return new Date(t.filled_at || t.submitted_at || t.created_date || 0).getTime();
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden', success: false }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const apply = body?.apply === true;

    const apiKey = (Deno.env.get('Kraken_API_Key') || '').trim();
    const apiSecret = (Deno.env.get('Kraken_API_Secret') || '').trim();
    if (!apiKey || !apiSecret) {
      return Response.json({ success: false, error: 'Missing Kraken API credentials' }, { status: 200 });
    }

    // 1. Kraken's authoritative fills. TradesHistory returns 50 per page, so page
    // through it — with only one page most clusters have no exchange data to
    // compare against and nothing can be safely cleaned.
    const rawFills = {};
    const MAX_PAGES = Number(body?.maxPages) > 0 ? Math.min(Number(body.maxPages), 20) : 12;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await callKrakenPrivate(apiKey, apiSecret, '/0/private/TradesHistory', {
        type: 'all',
        ofs: String(page * 50)
      });
      if (res?.error?.length) {
        if (page === 0) {
          return Response.json({ success: false, error: res.error.join(', ') }, { status: 200 });
        }
        break;
      }
      const pageTrades = res?.result?.trades || {};
      const keys = Object.keys(pageTrades);
      if (keys.length === 0) break;
      for (const k of keys) rawFills[k] = pageTrades[k];
      if (keys.length < 50) break;
      await new Promise(r => setTimeout(r, 1200)); // respect Kraken rate limits
    }
    if (Object.keys(rawFills).length === 0) {
      return Response.json({ success: false, error: 'No Kraken trade history returned' }, { status: 200 });
    }
    const krakenFills = Object.entries(rawFills).map(([txid, t]) => ({
      id: String(t.trade_id || txid),
      ordertxid: t.ordertxid ? String(t.ordertxid) : null,
      symbol: normalizeKrakenSymbol(t.pair),
      type: t.type,
      time: Number(t.time) * 1000,
      vol: parseFloat(t.vol),
      price: parseFloat(t.price),
      cost: parseFloat(t.cost)
    }));

    // CRITICAL: Kraken's TradesHistory returns individual FILLS, and one order can
    // fill in several pieces. The app writes ONE Trade record per order, so fills
    // must be collapsed to order level — otherwise a single order that filled twice
    // looks like two legitimate trades and its duplicate record is never spotted.
    const orderMap = new Map();
    for (const f of krakenFills) {
      const key = f.ordertxid || `fill_${f.id}`;
      const existing = orderMap.get(key);
      if (!existing) {
        orderMap.set(key, { ...f, fill_count: 1 });
      } else {
        existing.vol += f.vol;
        existing.cost += f.cost;
        existing.fill_count += 1;
        existing.price = existing.vol > 0 ? existing.cost / existing.vol : existing.price;
        existing.time = Math.min(existing.time, f.time);
      }
    }
    const krakenOrders = [...orderMap.values()];

    // 2. All local LIVE trades
    const localTrades = await base44.asServiceRole.entities.Trade.filter({
      is_simulation: false,
      created_by: user.email
    });

    // 3. Cluster by symbol + side + time proximity
    const bySide = new Map();
    for (const t of localTrades) {
      const key = `${String(t.symbol).toUpperCase()}_${t.type}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push(t);
    }

    const clusters = [];
    for (const [key, list] of bySide.entries()) {
      list.sort((a, b) => tradeTime(a) - tradeTime(b));
      let current = [];
      for (const t of list) {
        if (current.length === 0 || (tradeTime(t) - tradeTime(current[current.length - 1])) <= CLUSTER_WINDOW_MS) {
          current.push(t);
        } else {
          if (current.length > 1) clusters.push({ key, trades: current });
          current = [t];
        }
      }
      if (current.length > 1) clusters.push({ key, trades: current });
    }

    const deleted = [];
    const kept = [];
    const skipped = [];

    for (const cluster of clusters) {
      const [symbol, side] = cluster.key.split('_');
      const clusterStart = tradeTime(cluster.trades[0]);
      const clusterEnd = tradeTime(cluster.trades[cluster.trades.length - 1]);

      // Real Kraken ORDERS for this symbol/side inside the cluster window
      const fills = krakenOrders.filter(f =>
        f.symbol === symbol &&
        f.type === side &&
        f.time >= clusterStart - CLUSTER_WINDOW_MS &&
        f.time <= clusterEnd + CLUSTER_WINDOW_MS
      );

      // Only ever collapse down to the number of REAL orders. No orders = leave alone.
      if (fills.length === 0 || cluster.trades.length <= fills.length) {
        skipped.push({
          symbol,
          side,
          cluster_time: new Date(clusterStart).toISOString(),
          local_count: cluster.trades.length,
          kraken_orders: fills.length,
          reason: fills.length === 0 ? 'no matching exchange order in window' : 'record count matches exchange orders'
        });
        continue;
      }

      // Score each local record on how well it matches a real fill:
      // exchange ids first, then exact price/qty agreement.
      const scored = cluster.trades.map(t => {
        let score = 0;
        if (t.kraken_trade_id) score += 100;
        if (t.status === 'pending_fill') score -= 50; // never resolved by the sync
        const best = fills.reduce((acc, f) => {
          const priceDiff = f.price > 0 ? Math.abs(Number(t.price || 0) - f.price) / f.price : 1;
          const qtyDiff = f.vol > 0 ? Math.abs(Number(t.quantity || 0) - f.vol) / f.vol : 1;
          const closeness = priceDiff + qtyDiff;
          return closeness < acc ? closeness : acc;
        }, Number.POSITIVE_INFINITY);
        if (best < 0.0001) score += 60;
        else if (best < 0.005) score += 30;
        return { trade: t, score, closeness: best };
      });

      scored.sort((a, b) => (b.score - a.score) || (a.closeness - b.closeness));

      const keepers = scored.slice(0, fills.length);
      const phantoms = scored.slice(fills.length);

      for (const k of keepers) {
        kept.push({ id: k.trade.id, symbol, side, time: new Date(tradeTime(k.trade)).toISOString(), price: k.trade.price, quantity: k.trade.quantity, status: k.trade.status });
      }
      for (const p of phantoms) {
        deleted.push({ id: p.trade.id, symbol, side, time: new Date(tradeTime(p.trade)).toISOString(), price: p.trade.price, quantity: p.trade.quantity, status: p.trade.status, total_value: p.trade.total_value });
        if (apply) {
          try {
            await base44.asServiceRole.entities.Trade.delete(p.trade.id);
          } catch (e) {
            console.error('[dedupeTradeRecords] Delete failed', p.trade.id, e.message);
          }
        }
      }
    }

    return Response.json({
      success: true,
      applied: apply,
      local_live_trades: localTrades.length,
      kraken_fills: krakenFills.length,
      kraken_orders: krakenOrders.length,
      clusters_examined: clusters.length,
      phantoms_removed: apply ? deleted.length : 0,
      phantoms_identified: deleted.length,
      removed: deleted,
      kept,
      skipped
    }, { status: 200 });

  } catch (error) {
    console.error('[dedupeTradeRecords] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}