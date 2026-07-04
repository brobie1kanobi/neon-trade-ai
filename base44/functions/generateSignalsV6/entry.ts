import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * SIGNAL GENERATOR V7 — Multi-Strategy Engine
 * 
 * Reads user's strategy toggles from UserSettings and dynamically computes
 * signals using ONLY the strategies the user has enabled:
 *   - RSI (Momentum)
 *   - MACD (Trend)
 *   - Bollinger Bands (Volatility/Mean-Reversion)
 *   - Trend Alignment (Multi-timeframe: 1h + 4h)
 *   - Volume Confirmation (Volume vs 20-period average)
 *   - Sentiment Analysis (LLM-powered market sentiment)
 *   - Historical Performance (Past win-rate per asset)
 * 
 * TP/SL percentages are read from user settings — NEVER hardcoded.
 * BTC correlation still applied to altcoins.
 */

const KRAKEN_PAIR_MAP = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', XRP: 'XXRPZUSD', ADA: 'ADAUSD',
  DOGE: 'XDGUSD', DOT: 'DOTUSD', LINK: 'LINKUSD', MATIC: 'MATICUSD', AVAX: 'AVAXUSD',
  UNI: 'UNIUSD', ATOM: 'ATOMUSD', LTC: 'XLTCZUSD', BCH: 'BCHUSD', XLM: 'XXLMZUSD',
  TRX: 'TRXUSD', SHIB: 'SHIBUSD', PEPE: 'PEPEUSD', HBAR: 'HBARUSD'
};

const BTC_CORRELATED_ALTS = new Set(['ETH', 'XRP', 'SOL', 'TRX', 'DOGE', 'ADA', 'LINK', 'DOT', 'AVAX', 'LTC']);

// ==================== TECHNICAL INDICATOR FUNCTIONS ====================

function calcSMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const s = prices.slice(-period);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

function calcEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
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

function calcMACD(closes) {
  if (!closes || closes.length < 35) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 == null || ema26 == null) return null;
  const macdLine = ema12 - ema26;

  // Signal line: EMA(9) of MACD values over recent history
  const macdValues = [];
  const k12 = 2 / 13, k26 = 2 / 27;
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  for (let i = 12; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i >= 26) {
      e26 = closes[i] * k26 + e26 * (1 - k26);
      macdValues.push(e12 - e26);
    }
  }
  if (macdValues.length < 9) return { macdLine, signalLine: 0, histogram: macdLine };
  const signalLine = calcEMA(macdValues, 9);
  const histogram = macdLine - (signalLine || 0);
  return { macdLine, signalLine: signalLine || 0, histogram };
}

function calcBollingerBands(closes, period = 20, stdDevMult = 2) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: sma + stdDevMult * stdDev,
    middle: sma,
    lower: sma - stdDevMult * stdDev,
    bandwidth: stdDev > 0 ? ((sma + stdDevMult * stdDev) - (sma - stdDevMult * stdDev)) / sma * 100 : 0,
    percentB: stdDev > 0 ? (closes[closes.length - 1] - (sma - stdDevMult * stdDev)) / (2 * stdDevMult * stdDev) : 0.5
  };
}

function calcVolumeRatio(volumes, period = 20) {
  if (!volumes || volumes.length < period + 1) return null;
  const avgVol = volumes.slice(-(period + 1), -1).reduce((a, b) => a + b, 0) / period;
  const currentVol = volumes[volumes.length - 1];
  if (avgVol <= 0) return null;
  return currentVol / avgVol;
}

// ==================== STRATEGY SCORING FUNCTIONS ====================
// Each returns a score from -100 (strong sell) to +100 (strong buy)

function scoreRSI(rsi) {
  if (rsi == null) return 0;
  if (rsi < 25) return 80;       // Deeply oversold → strong buy
  if (rsi < 35) return 50;       // Oversold → buy
  if (rsi < 45) return 20;       // Leaning oversold
  if (rsi < 55) return 0;        // Neutral
  if (rsi < 65) return -15;      // Leaning overbought
  if (rsi < 75) return -40;      // Overbought → lean sell
  return -70;                     // Deeply overbought → strong sell
}

function scoreMACD(macd) {
  if (!macd) return 0;
  const { macdLine, signalLine, histogram } = macd;
  let score = 0;
  // Bullish crossover: MACD above signal and histogram positive
  if (macdLine > signalLine && histogram > 0) {
    score = Math.min(60, histogram * 5000); // Scale based on histogram strength
  } else if (macdLine < signalLine && histogram < 0) {
    score = Math.max(-60, histogram * 5000);
  }
  // Bonus for MACD line above 0 (bullish territory)
  if (macdLine > 0) score += 10;
  else if (macdLine < 0) score -= 10;
  return Math.max(-100, Math.min(100, score));
}

function scoreBollinger(bb, currentPrice) {
  if (!bb) return 0;
  const { percentB, bandwidth } = bb;
  // percentB < 0: below lower band (oversold) → buy
  // percentB > 1: above upper band (overbought) → sell
  // bandwidth very low: squeeze → breakout expected
  let score = 0;
  if (percentB < 0.05) score = 70;        // Below lower band → strong buy
  else if (percentB < 0.2) score = 40;    // Near lower band → buy
  else if (percentB < 0.4) score = 15;    // Lower half
  else if (percentB < 0.6) score = 0;     // Middle (neutral)
  else if (percentB < 0.8) score = -15;   // Upper half
  else if (percentB < 0.95) score = -40;  // Near upper band → sell
  else score = -70;                        // Above upper band → strong sell

  // Squeeze bonus: very tight bands suggest imminent move
  if (bandwidth < 3) score += (score > 0 ? 10 : -10);
  return Math.max(-100, Math.min(100, score));
}

function scoreVolume(volumeRatio, priceDirection) {
  if (volumeRatio == null) return 0;
  // High volume + price moving up = bullish confirmation
  // High volume + price moving down = bearish confirmation
  // Low volume = weak signal
  if (volumeRatio > 2.0) {
    return priceDirection > 0 ? 40 : -40;  // Very high volume confirms direction
  } else if (volumeRatio > 1.3) {
    return priceDirection > 0 ? 20 : -20;  // Above average confirms
  } else if (volumeRatio < 0.5) {
    return 0; // Very low volume → no conviction either way
  }
  return priceDirection > 0 ? 5 : -5;
}

function scoreTrendAlignment(closes1h, closes4h) {
  // Check if both timeframes agree on direction
  let score = 0;
  if (closes1h && closes1h.length >= 50) {
    const sma20_1h = calcSMA(closes1h, 20);
    const sma50_1h = calcSMA(closes1h, 50);
    const last1h = closes1h[closes1h.length - 1];
    if (sma20_1h && sma50_1h) {
      if (last1h > sma20_1h && sma20_1h > sma50_1h) score += 40; // 1h uptrend
      else if (last1h < sma20_1h && sma20_1h < sma50_1h) score -= 40; // 1h downtrend
    }
  }
  if (closes4h && closes4h.length >= 50) {
    const sma20_4h = calcSMA(closes4h, 20);
    const sma50_4h = calcSMA(closes4h, 50);
    const last4h = closes4h[closes4h.length - 1];
    if (sma20_4h && sma50_4h) {
      if (last4h > sma20_4h && sma20_4h > sma50_4h) score += 40; // 4h uptrend
      else if (last4h < sma20_4h && sma20_4h < sma50_4h) score -= 40; // 4h downtrend
    }
  }
  return Math.max(-100, Math.min(100, score));
}

function scoreHistorical(winRate, totalTrades) {
  if (totalTrades < 3) return 0; // Not enough data
  if (winRate >= 80) return 30;
  if (winRate >= 65) return 15;
  if (winRate >= 50) return 0;
  if (winRate >= 35) return -20;
  return -40; // Very poor history
}

// ==================== BTC MOMENTUM ====================

function computeBtcMomentum(candles5m) {
  if (!candles5m || candles5m.length < 50) return { score: 0, details: 'insufficient data' };
  const closes = candles5m.map(c => parseFloat(c[4]));
  const now = closes[closes.length - 1];
  const c15m = closes.length >= 3 ? closes[closes.length - 4] : now;
  const pct15m = c15m > 0 ? ((now - c15m) / c15m) * 100 : 0;
  const c1h = closes.length >= 12 ? closes[closes.length - 13] : now;
  const pct1h = c1h > 0 ? ((now - c1h) / c1h) * 100 : 0;
  const c4h = closes.length >= 48 ? closes[closes.length - 49] : now;
  const pct4h = c4h > 0 ? ((now - c4h) / c4h) * 100 : 0;
  const raw = (pct15m * 40 + pct1h * 35 + pct4h * 25);
  const score = Math.max(-100, Math.min(100, raw));
  const allUp = pct15m > 0 && pct1h > 0 && pct4h > 0;
  const allDown = pct15m < 0 && pct1h < 0 && pct4h < 0;
  const trend = allUp ? 'aligned_bullish' : allDown ? 'aligned_bearish' : 'mixed';
  return {
    score: Math.round(score * 10) / 10, trend,
    pct15m: Math.round(pct15m * 1000) / 1000,
    pct1h: Math.round(pct1h * 1000) / 1000,
    pct4h: Math.round(pct4h * 1000) / 1000,
    btcPrice: now
  };
}

function applyBtcCorrelation(action, confidence, btcMomentum, isCorrelatedAlt) {
  if (!btcMomentum || btcMomentum.score === 0 || btcMomentum.details === 'insufficient data') {
    return { action, confidence, reason_suffix: '' };
  }
  const score = btcMomentum.score;
  const trend = btcMomentum.trend;
  const weight = isCorrelatedAlt ? 1.0 : 0.5;
  let adjAction = action, adjConf = confidence, suffix = '';

  if (score > 20 && trend === 'aligned_bullish') {
    if (action === 'hold' && score > 35) { adjAction = 'buy'; adjConf = Math.min(68, 50 + Math.round(score * 0.15 * weight)); suffix = `BTC rally (+${btcMomentum.pct1h.toFixed(2)}% 1h) → upgraded`; }
    else if (action === 'buy') { adjConf = Math.min(80, confidence + Math.round(score * 0.12 * weight)); suffix = `BTC bullish → conf boosted`; }
    else if (action === 'strong_buy') { adjConf = Math.min(90, confidence + Math.round(score * 0.08 * weight)); suffix = `BTC confirms strong_buy`; }
  } else if (score < -20 && trend === 'aligned_bearish') {
    if (action === 'buy' && score < -30) { adjAction = 'hold'; adjConf = 42; suffix = `BTC falling → downgraded`; }
    else if (action === 'strong_buy' && score < -25) { adjAction = 'buy'; adjConf = Math.max(48, confidence - 15); suffix = `BTC bearish → downgraded`; }
    else if (action === 'hold' && score < -40) { adjAction = 'sell'; adjConf = Math.min(62, 50 + Math.round(Math.abs(score) * 0.1 * weight)); suffix = `BTC dump → sell`; }
  }
  return { action: adjAction, confidence: adjConf, reason_suffix: suffix };
}

// ==================== HUGGING FACE LLM HELPER ====================

const HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
const HF_URL = 'https://router.huggingface.co/v1/chat/completions';

async function callHuggingFace(systemPrompt, userPrompt, timeoutMs = 15000) {
  const token = Deno.env.get('HUGGINGFACE_API_TOKEN');
  if (!token) throw new Error('HUGGINGFACE_API_TOKEN not set');
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(HF_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: HF_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2048
      }),
      signal: ac.signal
    });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HF API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) throw new Error('No JSON in HF response');
    return JSON.parse(jsonMatch[1].trim());
  } catch (e) {
    clearTimeout(to);
    throw e;
  }
}

// ==================== SENTIMENT ANALYSIS (HF LLM) ====================

async function analyzeSentiment(base44, symbols, timeLeft) {
  if (timeLeft() < 8000) return {};
  const results = {};
  const symbolList = symbols.join(', ');
  try {
    const resp = await callHuggingFace(
      'You are a crypto market analyst. Always respond with valid JSON only, no extra text.',
      `Analyze current market sentiment for these assets: ${symbolList}

For each asset provide:
- sentiment_score: -100 (extreme fear/bearish) to +100 (extreme greed/bullish)
- brief reasoning (1 sentence)

Also provide an overall_market assessment with a score and brief summary.

Respond with JSON in this exact format:
{
  "assets": { "BTC": { "sentiment_score": 25, "reasoning": "..." }, ... },
  "overall_market": { "score": 30, "summary": "..." }
}`,
      Math.min(15000, timeLeft() - 1000)
    );
    if (resp?.assets) {
      for (const [sym, data] of Object.entries(resp.assets)) {
        const key = sym.toUpperCase();
        results[key] = {
          score: Math.max(-100, Math.min(100, Number(data.sentiment_score || 0))),
          reasoning: data.reasoning || ''
        };
      }
    }
    if (resp?.overall_market) {
      results.__overall = resp.overall_market;
    }
    console.log('[v7] Sentiment analysis complete for', Object.keys(results).length, 'assets');
  } catch (e) {
    console.warn('[v7] Sentiment analysis failed (HF):', e?.message || e);
  }
  return results;
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  const start = Date.now();
  const DEADLINE = 25000;
  const timeLeft = () => Math.max(0, DEADLINE - (Date.now() - start));

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    if (!isAdmin && !isCreator) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));

    // ===== 1. LOAD USER SETTINGS (strategies + margins) =====
    let userSettings = {};
    try {
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({}, '-updated_date', 1);
      userSettings = settingsList[0] || {};
    } catch (_) {}

    // Strategy toggles — all default to true if not explicitly set
    const strategies = {
      rsi: userSettings.strategy_rsi !== false,
      macd: userSettings.strategy_macd !== false,
      bollinger: userSettings.strategy_bollinger !== false,
      trend: userSettings.strategy_trend !== false,
      volume: userSettings.strategy_volume !== false,
      sentiment: userSettings.strategy_sentiment === true, // Default OFF (costs credits)
      history: userSettings.strategy_history !== false
    };

    // User's TP/SL margins — THE LAW, never overridden
    const userGainMargin = typeof userSettings.gain_margin === 'number' ? userSettings.gain_margin : 10;
    const userLossMargin = typeof userSettings.loss_margin === 'number' ? userSettings.loss_margin : 5;

    const enabledStrategies = Object.entries(strategies).filter(([, v]) => v).map(([k]) => k);
    console.log(`[v7] Enabled strategies: ${enabledStrategies.join(', ')}`);
    console.log(`[v7] User margins: TP=${userGainMargin}%, SL=${userLossMargin}%`);

    // ===== 2. RESOLVE SYMBOLS =====
    let symbols = Array.isArray(body?.symbols) ? body.symbols.map(s => String(s || '').toUpperCase()) : [];
    if (symbols.length === 0) {
      try {
        const prefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({ enabled: true });
        const fromPrefs = Array.from(new Set((prefs || []).map(p => String(p.symbol || '').toUpperCase()).filter(Boolean)));
        if (fromPrefs.length > 0) symbols = fromPrefs;
      } catch (_) {}
    }
    if (symbols.length === 0) {
      try {
        const latest = await base44.asServiceRole.entities.UserSettings.filter({}, '-updated_date', 1);
        const watched = Array.from(new Set(((latest?.[0]?.watched_crypto) || []).map(s => String(s || '').toUpperCase())));
        if (watched.length > 0) symbols = watched;
      } catch (_) {}
    }
    if (symbols.length === 0) symbols = ['BTC', 'ETH', 'SOL'];

    const krakenSymbols = symbols.filter(s => KRAKEN_PAIR_MAP[s]);
    if (krakenSymbols.length === 0) krakenSymbols.push('BTC', 'ETH', 'SOL');

    // ===== 3. FETCH MARKET DATA =====
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
    } catch (e) { console.warn('[v7] Ticker error:', e?.message); }

    // ===== 4. BTC MOMENTUM =====
    let btcMomentum = { score: 0, details: 'not fetched' };
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), Math.min(8000, timeLeft() - 200));
      const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XXBTZUSD&interval=5`, { signal: ac.signal });
      clearTimeout(to);
      if (r.ok) {
        const j = await r.json();
        const key = Object.keys(j.result || {}).find(k => k !== 'last');
        btcMomentum = computeBtcMomentum((j?.result?.[key] || []).slice(0, -1));
        console.log(`[v7] BTC momentum: score=${btcMomentum.score}, trend=${btcMomentum.trend}`);
      }
    } catch (e) { console.warn('[v7] BTC momentum error:', e?.message); }

    // ===== 5. FETCH OHLC FOR TECHNICAL ANALYSIS =====
    const tech = {};
    for (const sym of krakenSymbols) {
      if (timeLeft() < 5000) break;
      const pair = KRAKEN_PAIR_MAP[sym];

      // 1-hour candles (primary timeframe)
      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), Math.min(7000, timeLeft() - 200));
        const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=60`, { signal: ac.signal });
        clearTimeout(to);
        if (r.ok) {
          const j = await r.json();
          const key = Object.keys(j.result || {}).find(k => k !== 'last');
          const candles = (j?.result?.[key] || []).slice(0, -1);
          const closes = candles.map(c => parseFloat(c[4]));
          const volumes = candles.map(c => parseFloat(c[6]));
          tech[sym] = { closes_1h: closes, volumes_1h: volumes };
        }
      } catch (e) { console.warn('[v7] OHLC 1h error for', sym, e?.message); }

      // 4-hour candles (for trend alignment) — only if trend strategy enabled
      if (strategies.trend && timeLeft() > 4000) {
        try {
          const ac = new AbortController();
          const to = setTimeout(() => ac.abort(), Math.min(6000, timeLeft() - 200));
          const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=240`, { signal: ac.signal });
          clearTimeout(to);
          if (r.ok) {
            const j = await r.json();
            const key = Object.keys(j.result || {}).find(k => k !== 'last');
            const candles = (j?.result?.[key] || []).slice(0, -1);
            if (tech[sym]) tech[sym].closes_4h = candles.map(c => parseFloat(c[4]));
          }
        } catch (e) { console.warn('[v7] OHLC 4h error for', sym, e?.message); }
      }
    }

    // ===== 6. SENTIMENT ANALYSIS (if enabled) =====
    let sentiment = {};
    if (strategies.sentiment && timeLeft() > 8000) {
      sentiment = await analyzeSentiment(base44, krakenSymbols, timeLeft);
    }

    // ===== 7. HISTORICAL PERFORMANCE (if enabled) =====
    let historyMap = {};
    if (strategies.history) {
      try {
        const trades = await base44.asServiceRole.entities.Trade.filter({ type: 'sell', is_auto_trade: true }, '-created_date', 50);
        for (const t of trades) {
          const sym = (t.symbol || '').toUpperCase();
          if (!historyMap[sym]) historyMap[sym] = { wins: 0, losses: 0, total: 0 };
          historyMap[sym].total++;
          const pnl = (t.price || 0) - (t.average_cost_price || t.price || 0);
          if (pnl >= 0) historyMap[sym].wins++; else historyMap[sym].losses++;
        }
      } catch (_) {}
    }

    // ===== 8. EXISTING SIGNALS FOR REUSE =====
    let existing4h = [];
    try {
      existing4h = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true, timeframe: '4h' });
    } catch (_) {}
    const existingMap = new Map(existing4h.map(s => [String(s.asset_symbol || '').toUpperCase(), s]));

    // ===== 9. BUILD SIGNALS =====
    const ttlMs = 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    let created = 0, updated = 0;

    for (const m of market) {
      const sym = m.symbol;
      const t = tech[sym] || {};
      const closes1h = t.closes_1h || [];
      const volumes1h = t.volumes_1h || [];
      const closes4h = t.closes_4h || [];
      const last = closes1h.length > 0 ? closes1h[closes1h.length - 1] : m.price;

      // Calculate all enabled indicators
      const rsi = strategies.rsi ? calcRSI(closes1h, 14) : null;
      const macd = strategies.macd ? calcMACD(closes1h) : null;
      const bb = strategies.bollinger ? calcBollingerBands(closes1h, 20, 2) : null;
      const volRatio = strategies.volume ? calcVolumeRatio(volumes1h, 20) : null;
      const sma20 = calcSMA(closes1h, 20);

      // Score each enabled strategy
      const scores = {};
      const weights = {};
      let totalWeight = 0;

      if (strategies.rsi && rsi != null) {
        scores.rsi = scoreRSI(rsi);
        weights.rsi = 25;
        totalWeight += 25;
      }
      if (strategies.macd && macd) {
        scores.macd = scoreMACD(macd);
        weights.macd = 25;
        totalWeight += 25;
      }
      if (strategies.bollinger && bb) {
        scores.bollinger = scoreBollinger(bb, last);
        weights.bollinger = 20;
        totalWeight += 20;
      }
      if (strategies.trend && (closes1h.length >= 50 || closes4h.length >= 50)) {
        scores.trend = scoreTrendAlignment(closes1h, closes4h);
        weights.trend = 20;
        totalWeight += 20;
      }
      if (strategies.volume && volRatio != null) {
        scores.volume = scoreVolume(volRatio, m.change24h);
        weights.volume = 10;
        totalWeight += 10;
      }
      if (strategies.sentiment && sentiment[sym]) {
        scores.sentiment = sentiment[sym].score;
        weights.sentiment = 15;
        totalWeight += 15;
      }
      if (strategies.history) {
        const h = historyMap[sym];
        const winRate = h && h.total > 0 ? (h.wins / h.total) * 100 : 50;
        scores.history = scoreHistorical(winRate, h?.total || 0);
        weights.history = 10;
        totalWeight += 10;
      }

      // Weighted composite score (-100 to +100)
      let compositeScore = 0;
      if (totalWeight > 0) {
        for (const [key, s] of Object.entries(scores)) {
          compositeScore += s * (weights[key] / totalWeight);
        }
      }

      // Convert composite score to action
      let action = 'hold';
      if (compositeScore >= 50) action = 'strong_buy';
      else if (compositeScore >= 20) action = 'buy';
      else if (compositeScore <= -50) action = 'strong_sell';
      else if (compositeScore <= -20) action = 'sell';

      // Anti-pump safety: don't buy into parabolic moves regardless of indicators
      if ((action === 'buy' || action === 'strong_buy') && m.change24h > 6) {
        action = 'hold';
        compositeScore = Math.min(compositeScore, 10);
      }

      // Convert composite to confidence (0-100 scale)
      // composite -100..+100 → confidence 0..100
      let confidence = Math.round(50 + compositeScore * 0.4);
      confidence = Math.max(10, Math.min(95, confidence));

      // BTC correlation adjustment for altcoins
      const isCorrelated = BTC_CORRELATED_ALTS.has(sym);
      let btcSuffix = '';
      if (sym !== 'BTC') {
        const corr = applyBtcCorrelation(action, confidence, btcMomentum, isCorrelated);
        if (corr.action !== action || corr.confidence !== confidence) {
          console.log(`[v7] BTC corr ${sym}: ${action}(${confidence}) → ${corr.action}(${corr.confidence}) | ${corr.reason_suffix}`);
        }
        action = corr.action;
        confidence = corr.confidence;
        btcSuffix = corr.reason_suffix ? ` | BTC: ${corr.reason_suffix}` : '';
      }

      // Build reasoning string with all strategy details
      const reasonParts = [];
      if (strategies.rsi && rsi != null) reasonParts.push(`RSI=${rsi.toFixed(1)}(${scores.rsi > 0 ? '+' : ''}${scores.rsi})`);
      if (strategies.macd && macd) reasonParts.push(`MACD=${macd.histogram > 0 ? '+' : ''}${macd.histogram.toFixed(4)}(${scores.macd > 0 ? '+' : ''}${scores.macd})`);
      if (strategies.bollinger && bb) reasonParts.push(`BB%B=${bb.percentB.toFixed(2)}(${scores.bollinger > 0 ? '+' : ''}${scores.bollinger})`);
      if (strategies.trend && scores.trend != null) reasonParts.push(`Trend(${scores.trend > 0 ? '+' : ''}${scores.trend})`);
      if (strategies.volume && volRatio != null) reasonParts.push(`Vol=${volRatio.toFixed(1)}x(${scores.volume > 0 ? '+' : ''}${scores.volume})`);
      if (strategies.sentiment && sentiment[sym]) reasonParts.push(`Sent=${sentiment[sym].score}(${sentiment[sym].reasoning?.slice(0, 40)})`);
      if (strategies.history && scores.history != null) reasonParts.push(`Hist(${scores.history > 0 ? '+' : ''}${scores.history})`);

      const reasoning = `v7 multi-strategy [${enabledStrategies.join(',')}]: composite=${compositeScore.toFixed(1)} | ${reasonParts.join(', ')}${btcSuffix}`;

      const payload = {
        asset_symbol: sym,
        asset_type: 'crypto',
        timeframe: '4h',
        signal_type: action,
        confidence_score: confidence,
        price_at_signal: m.price || 0,
        change_24h: m.change24h || 0,
        reasoning,
        is_active: true,
        expires_at: expiresAt,
        // USER'S MARGINS — never hardcoded
        take_profit_pct: userGainMargin,
        stop_loss_pct: userLossMargin,
        metadata_json: JSON.stringify({
          generated_at: new Date().toISOString(),
          v: 'v7-multi-strategy',
          strategies_used: enabledStrategies,
          scores,
          composite_score: compositeScore,
          rsi: rsi ?? null,
          sma20: sma20 ?? null,
          macd: macd ? { line: macd.macdLine, signal: macd.signalLine, hist: macd.histogram } : null,
          bollinger: bb ? { percentB: bb.percentB, bandwidth: bb.bandwidth } : null,
          volume_ratio: volRatio ?? null,
          sentiment: sentiment[sym] || null,
          btc_momentum: sym !== 'BTC' ? btcMomentum : undefined,
          btc_correlated: isCorrelated,
          user_margins: { tp: userGainMargin, sl: userLossMargin }
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
      } catch (e) { console.warn('[v7] Save error for', sym, e?.message); }
    }

    return Response.json({
      success: true,
      version: 'v7-multi-strategy',
      strategies_enabled: enabledStrategies,
      user_margins: { gain: userGainMargin, loss: userLossMargin },
      analyzed: krakenSymbols,
      created, updated,
      btc_momentum: btcMomentum,
      sentiment_overall: sentiment.__overall || null,
      duration_ms: Date.now() - start
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});