import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

function withTimeout(promise, ms, label = 'op') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function normalizeSymbols(input) {
  if (!Array.isArray(input)) return [];
  return input.map(s => String(s || '').toUpperCase()).filter(Boolean);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (_e) {
      // ignore, checked below
    }
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const symbols = normalizeSymbols(body?.symbols || []);

    if (symbols.length === 0) {
      return Response.json([], { status: 200 });
    }

    // Use the multi-source market data aggregator to fetch safe quotes
    // and map to the expected shape for stock quotes
    try {
      const res = await withTimeout(
        base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { stockSymbols: symbols, cryptoSymbols: [], prefer: 'google_first' }
        }),
        7000,
        'watchlist'
      );

      const list = Array.isArray(res?.data) ? res.data : [];
      const out = symbols.map(sym => {
        const d = list.find(x => (x?.symbol || '').toUpperCase() === sym) || {};
        const price = typeof d.price === 'number'
          ? d.price
          : (typeof d.current_price === 'number' ? d.current_price : null);

        const change =
          typeof d.change === 'number' ? d.change :
          (typeof d.price_change_percentage_24h === 'number' ? d.price_change_percentage_24h :
          (typeof d.change_24h_percent === 'number' ? d.change_24h_percent : null));

        const change_value =
          typeof d.change_value === 'number' ? d.change_value :
          (typeof d.price_change_24h === 'number' ? d.price_change_24h : null);

        return {
          symbol: sym,
          price: price,
          change: (typeof change === 'number' ? change : null),
          change_value: (typeof change_value === 'number' ? change_value : null),
          name: d.name || sym
        };
      });

      return Response.json(out, { status: 200 });
    } catch (_e) {
      // Soft fallback on timeout/errors
      return Response.json([], { status: 200 });
    }
  } catch (error) {
    return Response.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
});