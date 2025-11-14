import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

async function fetchJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function mapPolygonList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((i) => {
    const symbol = (i?.ticker || i?.symbol || '').toUpperCase();
    const name = i?.name || i?.companyName || symbol;
    const day = i?.day || {};
    const last = i?.last || {};
    const price = typeof last?.price === 'number' ? last.price
      : typeof day?.close === 'number' ? day.close
      : (typeof i?.price === 'number' ? i.price : null);
    const pct = typeof day?.percent_change === 'number' ? day.percent_change
      : typeof i?.todaysChangePerc === 'number' ? i.todaysChangePerc
      : typeof i?.change_percent === 'number' ? i.change_percent
      : (typeof i?.changePercentage === 'number' ? i.changePercentage : null);
    const val = typeof day?.change === 'number' ? day.change
      : typeof i?.todaysChange === 'number' ? i.todaysChange
      : (price != null && typeof pct === 'number' ? (price * pct / 100) : null);
    return { symbol, name, price, change24hPct: pct, change24hVal: val, source: 'polygon' };
  }).filter(x => x.symbol);
}

function mapAlphaSection(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((i) => {
    const symbol = (i?.ticker || i?.symbol || '').toUpperCase();
    const name = i?.ticker || symbol;
    const price = typeof i?.price === 'string' ? Number(i.price) : (typeof i?.price === 'number' ? i.price : null);
    let pct = null;
    if (typeof i?.change_percentage === 'string') {
      const s = i.change_percentage.replace('%', '').trim();
      pct = Number(s);
    } else if (typeof i?.change_percentage === 'number') {
      pct = i.change_percentage;
    }
    const val = typeof i?.change_amount === 'string' ? Number(i.change_amount) :
      (typeof i?.change_amount === 'number' ? i.change_amount : (price != null && typeof pct === 'number' ? price * pct / 100 : null));
    return { symbol, name, price, change24hPct: pct, change24hVal: val, source: 'alpha' };
  }).filter(x => x.symbol);
}

function mergeBySymbol(primaryList, secondaryList) {
  const map = new Map();
  for (const it of secondaryList) {
    map.set(it.symbol, it);
  }
  for (const it of primaryList) {
    const prev = map.get(it.symbol);
    if (!prev) {
      map.set(it.symbol, it);
      continue;
    }
    const pickPrimary =
      (typeof it.change24hPct === 'number' && typeof it.price === 'number') ||
      (typeof it.change24hPct === 'number' && typeof prev.change24hPct !== 'number');
    map.set(it.symbol, pickPrimary ? it : prev);
  }
  return Array.from(map.values());
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read payload (even though we don't use it, prevents empty payload issue)
    let body = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch (e) {
      // Ignore parse errors
    }

    const polyKey = Deno.env.get('POLY_API_KEY');
    const alphaKey = Deno.env.get('ALPHA_VANTAGE_API');

    let polyG = [], polyL = [];
    if (polyKey) {
      try {
        const jG = await fetchJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${polyKey}`);
        const jL = await fetchJson(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${polyKey}`);
        polyG = mapPolygonList(jG?.tickers || jG?.results || []);
        polyL = mapPolygonList(jL?.tickers || jL?.results || []);
      } catch (_e) {
        // ignore polygon failure
      }
    }

    let alphaG = [], alphaL = [];
    if (alphaKey) {
      try {
        const a = await fetchJson(`https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=${alphaKey}`);
        alphaG = mapAlphaSection(a?.top_gainers || a?.top_gainers_losers || a?.top_gainers_losers?.top_gainers || []);
        alphaL = mapAlphaSection(a?.top_losers || a?.top_gainers_losers?.top_losers || []);
      } catch (_e) {
        // ignore alpha failure
      }
    }

    let gainers = mergeBySymbol(polyG, alphaG);
    let losers = mergeBySymbol(polyL, alphaL);

    gainers = gainers
      .filter(g => typeof g.change24hPct === 'number')
      .sort((a, b) => (b.change24hPct - a.change24hPct))
      .slice(0, 30);

    losers = losers
      .filter(l => typeof l.change24hPct === 'number')
      .sort((a, b) => (a.change24hPct - b.change24hPct))
      .slice(0, 30);

    try {
      const nowIso = new Date().toISOString();
      await base44.asServiceRole.entities.StockMoversCache.create({
        type: 'gainers',
        data_json: JSON.stringify(gainers),
        cached_at: nowIso,
      });
      await base44.asServiceRole.entities.StockMoversCache.create({
        type: 'losers',
        data_json: JSON.stringify(losers),
        cached_at: nowIso,
      });
    } catch (_e) {
      // cache write best-effort
    }

    return Response.json({
      gainers,
      losers,
      as_of: new Date().toISOString(),
      sources: {
        polygon: Boolean(polyKey),
        alpha_vantage: Boolean(alphaKey)
      }
    });
  } catch (error) {
    try {
      const base44 = createClientFromRequest(req);
      const [gCached] = await base44.asServiceRole.entities.StockMoversCache.filter({ type: 'gainers' }, '-cached_at', 1);
      const [lCached] = await base44.asServiceRole.entities.StockMoversCache.filter({ type: 'losers' }, '-cached_at', 1);
      const gainers = gCached?.data_json ? JSON.parse(gCached.data_json) : [];
      const losers = lCached?.data_json ? JSON.parse(lCached.data_json) : [];
      return Response.json({ gainers, losers, cached: true });
    } catch (_e2) {
      return Response.json({ error: error?.message || 'Unknown error' }, { status: 500 });
    }
  }
});