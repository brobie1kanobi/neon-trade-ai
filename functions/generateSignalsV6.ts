import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Lightweight, reliable signal generator (v6)
// - Always produces signals by deriving symbols from AutoBuyPreference -> UserSettings.watched_crypto -> defaults
// - Ignores non-4h signals when deciding reuse to avoid suppression from 1d short-term signals
// - Works in scheduled (no user) or interactive (admin) contexts

const KRAKEN_PAIR_MAP = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', XRP: 'XXRPZUSD', ADA: 'ADAUSD',
  DOGE: 'XDGUSD', DOT: 'DOTUSD', LINK: 'LINKUSD', MATIC: 'MATICUSD', AVAX: 'AVAXUSD',
  UNI: 'UNIUSD', ATOM: 'ATOMUSD', LTC: 'XLTCZUSD', BCH: 'BCHUSD', XLM: 'XXLMZUSD',
  TRX: 'TRXUSD', SHIB: 'SHIBUSD', PEPE: 'PEPEUSD', HBAR: 'HBARUSD'
};

function calcSMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const s = prices.slice(-period);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

Deno.serve(async (req) => {
  const start = Date.now();
  const DEADLINE = 25000;
  const timeLeft = () => Math.max(0, DEADLINE - (Date.now() - start));

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    // Allow scheduled (no user). If there is a user, require admin/creator.
    if (user) {
      const isAdmin = (user?.role || '').toLowerCase() === 'admin';
      const isCreator = !!user?.is_creator;
      if (!isAdmin && !isCreator) {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({}));
    let symbols = Array.isArray(body?.symbols) ? body.symbols.map(s => String(s || '').toUpperCase()) : [];

    // 1) AutoBuyPreference (global)
    if (symbols.length === 0) {
      try {
        const prefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({ enabled: true });
        const fromPrefs = Array.from(new Set((prefs || []).map(p => String(p.symbol || '').toUpperCase()).filter(Boolean)));
        if (fromPrefs.length > 0) symbols = fromPrefs;
      } catch (_) {}
    }

    // 2) Latest UserSettings.watched_crypto (global)
    if (symbols.length === 0) {
      try {
        const latest = await base44.asServiceRole.entities.UserSettings.filter({}, '-updated_date', 1);
        const watched = Array.from(new Set(((latest?.[0]?.watched_crypto) || []).map(s => String(s || '').toUpperCase())));
        if (watched.length > 0) symbols = watched;
      } catch (_) {}
    }

    // 3) Safe defaults
    if (symbols.length === 0) symbols = ['BTC', 'ETH', 'SOL'];

    // Map to Kraken pairs and fetch ticker
    const krakenSymbols = symbols.filter(s => KRAKEN_PAIR_MAP[s]);
    if (krakenSymbols.length === 0) krakenSymbols.push('BTC', 'ETH', 'SOL');

    const pairs = krakenSymbols.map(s => KRAKEN_PAIR_MAP[s]).join(',');

    let market = [];
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), Math.min(8000, timeLeft() - 200));
      const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`, { signal: ac.signal });
      clearTimeout(to);
      if (resp.ok) {
        const data = await resp.json();
        for (const sym of krakenSymbols) {
          const t = data?.result?.[KRAKEN_PAIR_MAP[sym]];
          if (!t) continue;
          const price = parseFloat(t.c?.[0] || '0');
          const open24h = parseFloat(t.o || '0');
          const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
          market.push({ symbol: sym, price, change24h });
        }
      }
    } catch (e) {
      console.warn('[v6] Ticker fetch error:', e?.message || e);
    }

    // Fetch minimal OHLC for simple RSI/MA check (1h)
    const tech = {};
    for (const sym of krakenSymbols) {
      if (timeLeft() < 4000) break;
      const pair = KRAKEN_PAIR_MAP[sym];
      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), Math.min(7000, timeLeft() - 200));
        const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=60`, { signal: ac.signal });
        clearTimeout(to);
        if (r.ok) {
          const j = await r.json();
          const key = Object.keys(j.result || {}).find(k => k !== 'last');
          const candles = (j?.result?.[key] || []).slice(0, -1); // drop in-progress
          const closes = candles.map(c => parseFloat(c[4]));
          const rsi = calcRSI(closes, 14);
          const sma20 = calcSMA(closes, 20);
          const last = closes[closes.length - 1];
          tech[sym] = { rsi, sma20, last };
        }
      } catch (e) {
        console.warn('[v6] OHLC error for', sym, e?.message || e);
      }
    }

    // Reuse only existing 4h signals
    let existing4h = [];
    try {
      existing4h = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true, timeframe: '4h' });
    } catch (_) {}
    const existingMap = new Map(existing4h.map(s => [String(s.asset_symbol || '').toUpperCase(), s]));

    // Build signals
    const ttlMs = 60 * 60 * 1000; // 1h
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    let created = 0, updated = 0;
    for (const m of market) {
      const sym = m.symbol;
      const t = tech[sym] || {};
      // Basic rules: prefer buy when RSI<65 and price >= SMA20 or RSI<40 (oversold bounce)
      let action = 'hold';
      if (t.rsi != null) {
        if (t.rsi < 40) action = 'buy';
        else if (t.rsi < 65 && t.last && t.sma20 && t.last >= t.sma20) action = 'buy';
        else if (t.rsi > 75) action = 'sell';
      } else {
        action = m.change24h >= 0 ? 'buy' : 'hold';
      }
      const confidence = action === 'buy' ? (m.change24h > 1 ? 62 : 55) : action === 'sell' ? 58 : 50;

      const payload = {
        asset_symbol: sym,
        asset_type: 'crypto',
        timeframe: '4h',
        signal_type: action,
        confidence_score: confidence,
        price_at_signal: m.price || 0,
        change_24h: m.change24h || 0,
        reasoning: `v6 heuristic: RSI=${t.rsi?.toFixed(1) ?? 'n/a'}, SMA20=${t.sma20?.toFixed(2) ?? 'n/a'}`,
        is_active: true,
        expires_at: expiresAt,
        take_profit_pct: 4,
        stop_loss_pct: 2,
        metadata_json: JSON.stringify({ generated_at: new Date().toISOString(), v: 'v6', rsi: t.rsi ?? null, sma20: t.sma20 ?? null })
      };

      const existing = existingMap.get(sym);
      try {
        if (existing) {
          await base44.asServiceRole.entities.AssetSignal.update(existing.id, payload);
          updated++;
        } else {
          await base44.asServiceRole.entities.AssetSignal.create(payload);
          created++;
        }
      } catch (e) {
        console.warn('[v6] Save error for', sym, e?.message || e);
      }
    }

    return Response.json({
      success: true,
      analyzed: krakenSymbols,
      created,
      updated,
      duration_ms: Date.now() - start
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});