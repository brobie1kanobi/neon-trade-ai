import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Lightweight, reliable signal generator (v6 + BTC Correlation)
// - Always produces signals by deriving symbols from AutoBuyPreference -> UserSettings.watched_crypto -> defaults
// - Ignores non-4h signals when deciding reuse to avoid suppression from 1d short-term signals
// - Works in scheduled (no user) or interactive (admin) contexts
// - NEW: Monitors BTC short-term momentum and uses it to boost/suppress altcoin signals

const KRAKEN_PAIR_MAP = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', XRP: 'XXRPZUSD', ADA: 'ADAUSD',
  DOGE: 'XDGUSD', DOT: 'DOTUSD', LINK: 'LINKUSD', MATIC: 'MATICUSD', AVAX: 'AVAXUSD',
  UNI: 'UNIUSD', ATOM: 'ATOMUSD', LTC: 'XLTCZUSD', BCH: 'BCHUSD', XLM: 'XXLMZUSD',
  TRX: 'TRXUSD', SHIB: 'SHIBUSD', PEPE: 'PEPEUSD', HBAR: 'HBARUSD'
};

// Top 10 major altcoins by market cap — these follow BTC most closely
const BTC_CORRELATED_ALTS = new Set(['ETH', 'XRP', 'SOL', 'TRX', 'DOGE', 'ADA', 'LINK', 'DOT', 'AVAX', 'LTC']);

/**
 * Compute BTC short-term momentum from 5-minute OHLC candles.
 * Returns a score from -100 (strong bearish) to +100 (strong bullish)
 * and component metrics for transparency.
 */
function computeBtcMomentum(candles5m) {
  if (!candles5m || candles5m.length < 50) return { score: 0, details: 'insufficient data' };

  const closes = candles5m.map(c => parseFloat(c[4]));
  const now = closes[closes.length - 1];

  // 15-minute change (last 3 candles)
  const c15m = closes.length >= 3 ? closes[closes.length - 4] : now;
  const pct15m = c15m > 0 ? ((now - c15m) / c15m) * 100 : 0;

  // 1-hour change (last 12 candles)
  const c1h = closes.length >= 12 ? closes[closes.length - 13] : now;
  const pct1h = c1h > 0 ? ((now - c1h) / c1h) * 100 : 0;

  // 4-hour change (last 48 candles)
  const c4h = closes.length >= 48 ? closes[closes.length - 49] : now;
  const pct4h = c4h > 0 ? ((now - c4h) / c4h) * 100 : 0;

  // RSI on 5m candles (last 14)
  const rsi5m = calcRSI(closes, 14);

  // Weighted momentum score:
  // 15m = recent/fast signal (weight 40%), 1h = medium (35%), 4h = trend (25%)
  const raw = (pct15m * 40 + pct1h * 35 + pct4h * 25);
  // Normalize: 1% move per period ≈ raw ~100, so divide by ~1 to keep scale
  // Clamp to -100..+100
  const score = Math.max(-100, Math.min(100, raw));

  // Trend direction: all three timeframes agreeing = strong signal
  const allUp = pct15m > 0 && pct1h > 0 && pct4h > 0;
  const allDown = pct15m < 0 && pct1h < 0 && pct4h < 0;
  const trend = allUp ? 'aligned_bullish' : allDown ? 'aligned_bearish' : 'mixed';

  return {
    score: Math.round(score * 10) / 10,
    trend,
    pct15m: Math.round(pct15m * 1000) / 1000,
    pct1h: Math.round(pct1h * 1000) / 1000,
    pct4h: Math.round(pct4h * 1000) / 1000,
    rsi5m: rsi5m != null ? Math.round(rsi5m * 10) / 10 : null,
    btcPrice: now
  };
}

/**
 * Apply BTC momentum to an altcoin signal.
 * Returns adjusted { action, confidence, reason_suffix }
 */
function applyBtcCorrelation(action, confidence, btcMomentum, isCorrelatedAlt) {
  if (!btcMomentum || btcMomentum.score === 0 || btcMomentum.details === 'insufficient data') {
    return { action, confidence, reason_suffix: '' };
  }

  const score = btcMomentum.score;
  const trend = btcMomentum.trend;
  // Correlated alts get stronger adjustments
  const weight = isCorrelatedAlt ? 1.0 : 0.5;

  let adjAction = action;
  let adjConf = confidence;
  let suffix = '';

  if (score > 20 && trend === 'aligned_bullish') {
    // BTC strongly bullish — boost buy signals, upgrade holds to buys
    if (action === 'hold' && score > 35) {
      adjAction = 'buy';
      adjConf = Math.min(68, 50 + Math.round(score * 0.15 * weight));
      suffix = `BTC rally (+${btcMomentum.pct1h.toFixed(2)}% 1h) → upgraded to buy`;
    } else if (action === 'buy') {
      adjConf = Math.min(80, confidence + Math.round(score * 0.12 * weight));
      suffix = `BTC bullish (+${btcMomentum.pct1h.toFixed(2)}% 1h) → confidence boosted`;
    } else if (action === 'strong_buy') {
      adjConf = Math.min(90, confidence + Math.round(score * 0.08 * weight));
      suffix = `BTC momentum confirms strong_buy`;
    } else if (action === 'sell') {
      // BTC rising but altcoin overbought — reduce sell urgency slightly
      adjConf = Math.max(45, confidence - 5);
      suffix = `BTC bullish → sell confidence reduced`;
    }
  } else if (score < -20 && trend === 'aligned_bearish') {
    // BTC strongly bearish — suppress buys, boost sells
    if (action === 'buy' && score < -30) {
      adjAction = 'hold';
      adjConf = 42;
      suffix = `BTC falling (${btcMomentum.pct1h.toFixed(2)}% 1h) → downgraded to hold`;
    } else if (action === 'strong_buy' && score < -25) {
      adjAction = 'buy';
      adjConf = Math.max(48, confidence - 15);
      suffix = `BTC bearish → downgraded from strong_buy`;
    } else if (action === 'hold' && score < -40) {
      adjAction = 'sell';
      adjConf = Math.min(62, 50 + Math.round(Math.abs(score) * 0.1 * weight));
      suffix = `BTC dump (${btcMomentum.pct1h.toFixed(2)}% 1h) → upgraded to sell`;
    } else if (action === 'sell') {
      adjConf = Math.min(80, confidence + Math.round(Math.abs(score) * 0.1 * weight));
      suffix = `BTC bearish confirms sell`;
    }
  } else if (Math.abs(score) > 5) {
    // Mild BTC movement — smaller adjustments
    const bump = Math.round(score * 0.05 * weight);
    if (action === 'buy' || action === 'strong_buy') {
      adjConf = Math.max(40, Math.min(85, confidence + bump));
      suffix = bump > 0 ? `BTC slightly bullish (+${bump} conf)` : `BTC slightly bearish (${bump} conf)`;
    }
  }

  return { action: adjAction, confidence: adjConf, reason_suffix: suffix };
}

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

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    if (!isAdmin && !isCreator) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
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

    // ===== BTC MOMENTUM: Fetch BTC 5-minute OHLC for short-term momentum =====
    let btcMomentum = { score: 0, details: 'not fetched' };
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), Math.min(8000, timeLeft() - 200));
      const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XXBTZUSD&interval=5`, { signal: ac.signal });
      clearTimeout(to);
      if (r.ok) {
        const j = await r.json();
        const key = Object.keys(j.result || {}).find(k => k !== 'last');
        const candles5m = (j?.result?.[key] || []).slice(0, -1);
        btcMomentum = computeBtcMomentum(candles5m);
        console.log(`[v6] BTC momentum: score=${btcMomentum.score}, trend=${btcMomentum.trend}, 15m=${btcMomentum.pct15m}%, 1h=${btcMomentum.pct1h}%, 4h=${btcMomentum.pct4h}%`);
      }
    } catch (e) {
      console.warn('[v6] BTC momentum fetch error:', e?.message || e);
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
      // ANTI-PUMP RULES: Only buy when conditions favor a good entry, not at highs
      // - RSI < 35: oversold bounce opportunity (strong_buy)
      // - RSI 35-50 AND price near/below SMA20: healthy pullback entry (buy)
      // - RSI > 60 OR 24h change > 4%: price is extended, skip (hold)
      // - RSI > 75: overbought, recommend sell
      let action = 'hold';
      if (t.rsi != null) {
        if (t.rsi < 35 && m.change24h < 3) {
          action = 'strong_buy'; // Oversold + not already pumping
        } else if (t.rsi < 50 && t.last && t.sma20 && t.last <= t.sma20 * 1.02 && m.change24h < 4) {
          action = 'buy'; // Near SMA support, not extended
        } else if (t.rsi > 75 || m.change24h > 8) {
          action = 'sell'; // Overbought or parabolic
        }
        // else: hold — RSI 50-75 with no clear pullback = don't chase
      } else {
        // No technical data — only buy on dips, not pumps
        action = m.change24h < -1 ? 'buy' : 'hold';
      }
      let confidence;
      if (action === 'strong_buy') {
        confidence = t.rsi < 30 ? 72 : 65;
      } else if (action === 'buy') {
        confidence = m.change24h < 0 ? 60 : 52; // Higher confidence on dips
      } else if (action === 'sell') {
        confidence = 58;
      } else {
        confidence = 45; // Hold = low confidence, won't trigger auto-trader
      }

      // ===== BTC CORRELATION: Adjust altcoin signal based on BTC momentum =====
      const isCorrelated = BTC_CORRELATED_ALTS.has(sym);
      let btcSuffix = '';
      if (sym !== 'BTC') {
        const corr = applyBtcCorrelation(action, confidence, btcMomentum, isCorrelated);
        if (corr.action !== action || corr.confidence !== confidence) {
          console.log(`[v6] BTC correlation for ${sym}: ${action}(${confidence}) → ${corr.action}(${corr.confidence}) | ${corr.reason_suffix}`);
        }
        action = corr.action;
        confidence = corr.confidence;
        btcSuffix = corr.reason_suffix ? ` | BTC: ${corr.reason_suffix}` : '';
      }

      const payload = {
        asset_symbol: sym,
        asset_type: 'crypto',
        timeframe: '4h',
        signal_type: action,
        confidence_score: confidence,
        price_at_signal: m.price || 0,
        change_24h: m.change24h || 0,
        reasoning: `v6 heuristic: RSI=${t.rsi?.toFixed(1) ?? 'n/a'}, SMA20=${t.sma20?.toFixed(2) ?? 'n/a'}${btcSuffix}`,
        is_active: true,
        expires_at: expiresAt,
        take_profit_pct: 4,
        stop_loss_pct: 2,
        metadata_json: JSON.stringify({
          generated_at: new Date().toISOString(),
          v: 'v6.1-btc-corr',
          rsi: t.rsi ?? null,
          sma20: t.sma20 ?? null,
          btc_momentum: sym !== 'BTC' ? btcMomentum : undefined,
          btc_correlated: isCorrelated
        })
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
      btc_momentum: btcMomentum,
      duration_ms: Date.now() - start
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});