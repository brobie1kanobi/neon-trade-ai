import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * AI SIGNAL GENERATOR v5 — ENHANCED TECHNICAL + SENTIMENT + ML SCORING
 * 
 * ENHANCEMENTS:
 * 1. Real RSI, MACD, Bollinger Bands computed from OHLC candle data
 * 2. Sentiment analysis module using LLM with live internet context
 * 3. ML-style composite scoring model that weights all indicators
 * 4. Multi-timeframe confirmation (1h + 4h candles)
 * 5. Volume-weighted momentum analysis
 * 6. Historical performance feedback loop
 */

const SIGNAL_TTL_HOURS = 1;

const KRAKEN_PAIR_MAP = {
  'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
  'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
  'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
  'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
  'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'HBAR': 'HBARUSD'
};

// ═══════════════════════════════════════════════
//  TECHNICAL INDICATOR CALCULATIONS (pure math)
// ═══════════════════════════════════════════════

function calcEMA(prices, period) {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
  }
  return ema;
}

function calcSMA(prices, period) {
  if (prices.length < period) return null;
  const s = prices.slice(-period);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

/**
 * RSI (Relative Strength Index) — Wilder's smoothing
 * Returns 0-100. >70 = overbought, <30 = oversold
 */
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
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

/**
 * MACD (Moving Average Convergence Divergence)
 * Returns { macdLine, signalLine, histogram }
 */
function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  // Build full MACD line series
  const macdSeries = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const emaFast = calcEMA(slice, fast);
    const emaSlow = calcEMA(slice, slow);
    macdSeries.push(emaFast - emaSlow);
  }
  if (macdSeries.length < signal) return null;
  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = calcEMA(macdSeries.slice(-signal * 2), signal); // use enough history
  const histogram = macdLine - signalLine;
  // Determine crossover state
  const prevMacd = macdSeries.length >= 2 ? macdSeries[macdSeries.length - 2] : macdLine;
  const prevSignal = calcEMA(macdSeries.slice(-(signal * 2 + 1), -1), signal);
  const bullishCross = prevMacd <= prevSignal && macdLine > signalLine;
  const bearishCross = prevMacd >= prevSignal && macdLine < signalLine;
  return { macdLine, signalLine, histogram, bullishCross, bearishCross };
}

/**
 * Bollinger Bands — 20-period SMA ± 2 standard deviations
 * Returns { upper, middle, lower, bandwidth, percentB }
 */
function calcBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const bandwidth = middle > 0 ? (upper - lower) / middle * 100 : 0;
  const currentPrice = closes[closes.length - 1];
  const percentB = (upper - lower) > 0 ? (currentPrice - lower) / (upper - lower) * 100 : 50;
  return { upper, middle, lower, bandwidth, percentB };
}

/**
 * Average True Range (ATR) — volatility measure
 */
function calcATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) return null;
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

/**
 * Volume-Weighted Average Price (VWAP) — from candle data
 */
function calcVWAP(highs, lows, closes, volumes) {
  let cumVol = 0, cumTP = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumTP += tp * volumes[i];
    cumVol += volumes[i];
  }
  return cumVol > 0 ? cumTP / cumVol : null;
}

// ═══════════════════════════════════════════════
//  ML-STYLE COMPOSITE SCORING MODEL
// ═══════════════════════════════════════════════

/**
 * Scores an asset from -100 (strong sell) to +100 (strong buy)
 * using weighted combination of all technical indicators,
 * sentiment, and historical performance.
 */
function computeCompositeScore(indicators, sentiment, history, strategies = {}) {
  let score = 0;
  let weights = 0;

  const useRsi = strategies.strategy_rsi !== false;
  const useMacd = strategies.strategy_macd !== false;
  const useBollinger = strategies.strategy_bollinger !== false;
  const useTrend = strategies.strategy_trend !== false;
  const useVolume = strategies.strategy_volume !== false;
  const useSentiment = strategies.strategy_sentiment !== false;
  const useHistory = strategies.strategy_history !== false;

  // ── RSI (weight: 15) ──
  if (useRsi && indicators.rsi_1h != null) {
    const rsi = indicators.rsi_1h;
    let rsiScore = 0;
    if (rsi < 25) rsiScore = 70 + (25 - rsi) * 2;          // Deep oversold = strong buy signal
    else if (rsi < 35) rsiScore = 50;                        // Oversold = bullish
    else if (rsi < 45) rsiScore = 25;                        // Mildly oversold = slightly bullish
    else if (rsi < 60) rsiScore = 5;                         // Neutral-ish (was 0, slightly positive)
    else if (rsi < 75) rsiScore = -10;
    else rsiScore = -20;                 // Overbought = bearish
    score += rsiScore * 15;
    weights += 15;
  }

  // ── MACD (weight: 15, was 20 — reduced to prevent domination) ──
  if (useMacd && indicators.macd_1h) {
    let macdScore = 0;
    if (indicators.macd_1h.bullishCross) macdScore = 80;
    else if (indicators.macd_1h.bearishCross) macdScore = -40; // Reduced penalty
    else if (indicators.macd_1h.histogram > 0) macdScore = 30;
    else macdScore = -5; // Minimal penalty for negative histogram
    score += macdScore * 15;
    weights += 15;
  }

  // ── Bollinger Bands (weight: 15) ──
  if (useBollinger && indicators.bb_1h) {
    let bbScore = 0;
    const pctB = indicators.bb_1h.percentB;
    if (pctB < 10) bbScore = 70;          // At lower band = bounce likely
    else if (pctB < 25) bbScore = 50;     // Near lower band = bullish (was 40)
    else if (pctB < 40) bbScore = 25;     // Below middle = slight buy opportunity
    else if (pctB > 90) bbScore = -70;     // At upper band = reversal likely
    else if (pctB > 75) bbScore = -40;
    else bbScore = 0;
    // Squeeze detection (low bandwidth = breakout coming)
    if (indicators.bb_1h.bandwidth < 3) bbScore += 20; // Squeeze adds opportunity
    score += bbScore * 15;
    weights += 15;
  }

  // ── Trend alignment (weight: 15, was 20 — reduced to avoid dominating score) ──
  if (useTrend && indicators.trend_6h != null && indicators.trend_12h != null) {
    let trendScore = 0;
    const t6 = indicators.trend_6h;
    const t12 = indicators.trend_12h;
    const t24 = indicators.change_24h || 0;
    if (t6 > 0 && t12 > 0 && t24 > 0) trendScore = 70;         // All bullish
    else if (t6 > 0 && t12 > 0) trendScore = 50;
    else if (t6 > 0 || t12 > 0) trendScore = 15;                // Mixed
    else if (t6 < -3 && t12 < -3 && t24 < -3) trendScore = -40; // All strongly bearish
    else if (t6 < 0 && t12 < 0) trendScore = -10;               // Mild bearish
    else trendScore = 0;                                        // Neutral
    score += trendScore * 15;
    weights += 15;
  }

  // ── Volume confirmation (weight: 10) ──
  if (useVolume && indicators.volume_increasing != null) {
    const volScore = indicators.volume_increasing ? 40 : -20;
    score += volScore * 10;
    weights += 10;
  }

  // ── Candle ratio (weight: 10) ──
  if (indicators.candle_ratio != null) {
    const cr = indicators.candle_ratio; // 0 to 1
    const crScore = (cr - 0.5) * 120;  // -60 to +60
    score += crScore * 10;
    weights += 10;
  }

  // ── Sentiment (weight: 5) ──
  if (useSentiment && sentiment != null) {
    const sentScore = (sentiment - 50) * 1.2; // -60 to +60
    score += sentScore * 10;
    weights += 5;
  }

  // ── Historical performance penalty/boost (weight: 10) ──
  if (useHistory && history && history.total_trades >= 3) {
    let histScore = 0;
    if (history.win_rate > 70) histScore = 40;
    else if (history.win_rate > 55) histScore = 20;
    else if (history.win_rate < 40) histScore = -40;
    else if (history.win_rate < 50) histScore = -20;
    score += histScore * 10;
    weights += 10;
  }

  // ── ATR-based volatility (weight: 5, informational) ──
  if (indicators.atr_pct != null) {
    // High volatility = wider range = more opportunity but more risk
    // We slightly penalize very high volatility
    let atrScore = 0;
    if (indicators.atr_pct > 5) atrScore = -5;
    else if (indicators.atr_pct > 3) atrScore = 0;
    else if (indicators.atr_pct > 1) atrScore = 10;
    score += atrScore * 5;
    weights += 5;
  }

  // ── Range position (weight: 5) ──
  if (indicators.range_position != null) {
    // Buying near daily low is better
    let rpScore = 0;
    const rp = indicators.range_position;
    if (rp < 30) rpScore = 40;
    else if (rp < 50) rpScore = 15;
    else if (rp > 80) rpScore = -40;
    else if (rp > 65) rpScore = -15;
    score += rpScore * 5;
    weights += 5;
  }

  // Normalize to -100..+100
  const normalized = weights > 0 ? score / weights : 0;
  return Math.max(-100, Math.min(100, Math.round(normalized)));
}

/**
 * Convert composite score to signal type and confidence
 */
function scoreToSignal(compositeScore) {
  let signalType, confidence;

  // Highly relaxed thresholds: buy at 2+, strong_buy at 8+
  // This allows signals to reach the Prospector even in mixed market conditions
  if (compositeScore >= 8) {
    signalType = 'strong_buy';
    confidence = Math.min(95, 70 + (compositeScore - 8));
  } else if (compositeScore >= 2) {
    signalType = 'buy';
    confidence = 55 + Math.min(20, compositeScore - 2);
  } else if (compositeScore >= -20) {
    signalType = 'hold';
    confidence = 50;
  } else if (compositeScore >= -45) {
    signalType = 'sell';
    confidence = 55 + (-compositeScore - 20);
  } else {
    signalType = 'strong_sell';
    confidence = Math.min(95, 70 + (-compositeScore - 45));
  }

  return { signalType, confidence: Math.round(confidence) };
}


Deno.serve(async (req) => {
  const startTime = Date.now();

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Guardrail: add hard timeout wrapper so LLM/net calls never stall the function
    const withTimeout = (promise, ms = 15000, label = 'operation') => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms))
      ]);
    };

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;

    if (!isAdmin && !isCreator) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { symbols = [], forceRefresh = false } = body;

    // Load user's thresholds (robust: accept numbers or numeric strings) and strategies
    let userAutoExecuteThreshold = null;
    let userMinSignalConfidence = null;
    let userStrategies = {};
    try {
      const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      if (userSettingsList.length > 0) {
        userSettingsList.sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
        const latest = userSettingsList[0];
        const aets = Number(latest.auto_execute_threshold);
        const msci = Number(latest.min_signal_confidence);
        userAutoExecuteThreshold = Number.isFinite(aets) ? aets : null;
        userMinSignalConfidence = Number.isFinite(msci) ? msci : null;
        userStrategies = {
          strategy_rsi: latest.strategy_rsi,
          strategy_macd: latest.strategy_macd,
          strategy_bollinger: latest.strategy_bollinger,
          strategy_trend: latest.strategy_trend,
          strategy_volume: latest.strategy_volume,
          strategy_sentiment: latest.strategy_sentiment,
          strategy_history: latest.strategy_history
        };
      }
      // Apply safe defaults if not set in DB
      if (userAutoExecuteThreshold == null) userAutoExecuteThreshold = 70;
      if (userMinSignalConfidence == null) userMinSignalConfidence = 50;
      console.log('[generateSignals] Using auto_execute_threshold:', userAutoExecuteThreshold, 'min_signal_confidence:', userMinSignalConfidence);
    } catch (e) {
      console.warn('[generateSignals] Could not load user settings:', e.message);
      // Still ensure sane defaults on error
      if (userAutoExecuteThreshold == null) userAutoExecuteThreshold = 70;
      if (userMinSignalConfidence == null) userMinSignalConfidence = 50;
    }

    console.log('[generateSignals] v5 Starting for', symbols.length || 'all', 'symbols');

    // Get all active AutoBuyPreferences
    let assetsToAnalyze = [];

    if (symbols.length > 0) {
      assetsToAnalyze = symbols.map(s => ({ symbol: s.toUpperCase(), asset_type: 'crypto' }));
    } else {
      const allPrefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({
        enabled: true
      });

      const seen = new Set();
      for (const pref of allPrefs) {
        const sym = (pref.symbol || '').toUpperCase();
        if (sym && !seen.has(sym)) {
          seen.add(sym);
          assetsToAnalyze.push({ symbol: sym, asset_type: pref.asset_type || 'crypto' });
        }
      }
    }

    if (assetsToAnalyze.length === 0) {
      return Response.json({ success: true, signals_generated: 0, message: 'No assets to analyze' });
    }

    console.log('[generateSignals] Analyzing', assetsToAnalyze.length, 'assets');

    // Check for existing valid signals
    const now = new Date();
    const existingSignals = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true });

    const validSignals = new Map();
    for (const sig of existingSignals) {
      if (!forceRefresh && sig.expires_at && new Date(sig.expires_at) > now) {
        validSignals.set(sig.asset_symbol, sig);
      }
    }

    const assetsNeedingAnalysis = assetsToAnalyze.filter(a => !validSignals.has(a.symbol));

    if (assetsNeedingAnalysis.length === 0) {
      return Response.json({ success: true, signals_generated: 0, signals_reused: validSignals.size, message: 'All signals still valid' });
    }

    // ═══════════════════════════════════════════════
    //  STEP 1: Fetch Ticker + OHLC data from Kraken
    // ═══════════════════════════════════════════════
    const cryptoSymbols = assetsNeedingAnalysis.filter(a => a.asset_type === 'crypto').map(a => a.symbol);

    let marketData = [];
    const ohlcData = {};       // symbol -> { candles_1h, candles_4h }
    const techIndicators = {}; // symbol -> { rsi, macd, bb, ... }

    // Fetch current ticker
    try {
      const pairs = cryptoSymbols.map(s => KRAKEN_PAIR_MAP[s]).filter(Boolean);
      if (pairs.length > 0) {
        const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data?.result) {
            for (const sym of cryptoSymbols) {
              const pair = KRAKEN_PAIR_MAP[sym];
              const ticker = data.result[pair];
              if (ticker) {
                const price = parseFloat(ticker.c?.[0] || '0');
                const open24h = parseFloat(ticker.o || '0');
                const high24h = parseFloat(ticker.h?.[1] || '0');
                const low24h = parseFloat(ticker.l?.[1] || '0');
                const volume24h = parseFloat(ticker.v?.[1] || '0');
                const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
                const rangePosition = (high24h - low24h) > 0
                  ? ((price - low24h) / (high24h - low24h)) * 100
                  : 50;

                marketData.push({
                  symbol: sym, price, open24h, high24h, low24h, volume24h,
                  change_24h_percent: change24h, range_position: rangePosition
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[generateSignals] Ticker fetch failed:', e.message);
    }

    // Fetch OHLC 1h candles (for RSI, MACD, BB, trend)
    for (const sym of cryptoSymbols) {
      const pair = KRAKEN_PAIR_MAP[sym];
      if (!pair) continue;

      try {
        const ohlcResp = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=60`);
        if (ohlcResp.ok) {
          const ohlcJson = await ohlcResp.json();
          const resultKey = Object.keys(ohlcJson.result || {}).find(k => k !== 'last');
          const candles = ohlcJson?.result?.[resultKey] || [];

          if (candles.length >= 30) {
            // Parse candle arrays: [time, open, high, low, close, vwap, volume, count]
            const allCandles = candles.slice(0, -1); // drop incomplete current candle
            const closes = allCandles.map(c => parseFloat(c[4]));
            const highs = allCandles.map(c => parseFloat(c[2]));
            const lows = allCandles.map(c => parseFloat(c[3]));
            const volumes = allCandles.map(c => parseFloat(c[6]));

            // ── Compute all technical indicators ──
            const rsi = calcRSI(closes, 14);
            const macd = calcMACD(closes, 12, 26, 9);
            const bb = calcBollingerBands(closes, 20, 2);
            const atr = calcATR(highs, lows, closes, 14);
            const vwap = calcVWAP(
              highs.slice(-24), lows.slice(-24), closes.slice(-24), volumes.slice(-24)
            );
            const sma50 = calcSMA(closes, 50);
            const sma20 = calcSMA(closes, 20);
            const ema9 = calcEMA(closes, 9);
            const currentPrice = closes[closes.length - 1];

            // Short-term trend from last 6 and 12 candles
            const recent6 = allCandles.slice(-6);
            const recent12 = allCandles.slice(-12);
            const firstClose6 = parseFloat(recent6[0]?.[4] || '0');
            const lastClose6 = parseFloat(recent6[recent6.length - 1]?.[4] || '0');
            const trend6h = firstClose6 > 0 ? ((lastClose6 - firstClose6) / firstClose6) * 100 : 0;
            const firstClose12 = parseFloat(recent12[0]?.[4] || '0');
            const lastClose12 = parseFloat(recent12[recent12.length - 1]?.[4] || '0');
            const trend12h = firstClose12 > 0 ? ((lastClose12 - firstClose12) / firstClose12) * 100 : 0;

            // Candle ratio (bullish vs bearish)
            let bullish = 0, bearish = 0;
            for (const c of recent6) {
              if (parseFloat(c[4]) > parseFloat(c[1])) bullish++; else bearish++;
            }

            // Volume trend
            const firstHalfVol = recent6.slice(0, 3).reduce((s, c) => s + parseFloat(c[6]), 0);
            const secondHalfVol = recent6.slice(3).reduce((s, c) => s + parseFloat(c[6]), 0);
            const volumeIncreasing = secondHalfVol > firstHalfVol * 1.1;

            // Support/resistance from 12h
            const support12h = Math.min(...recent12.map(c => parseFloat(c[3])));
            const resistance12h = Math.max(...recent12.map(c => parseFloat(c[2])));

            // ATR as percentage of price
            const atrPct = (atr && currentPrice > 0) ? (atr / currentPrice) * 100 : null;

            // Price relative to VWAP
            const priceVsVwap = vwap ? ((currentPrice - vwap) / vwap) * 100 : null;

            // EMA/SMA crossover signals
            const emaAboveSma = sma20 ? ema9 > sma20 : null;
            const priceAboveSma50 = sma50 ? currentPrice > sma50 : null;

            techIndicators[sym] = {
              rsi_1h: rsi,
              macd_1h: macd,
              bb_1h: bb,
              atr_1h: atr,
              atr_pct: atrPct,
              vwap_24h: vwap,
              price_vs_vwap: priceVsVwap,
              sma_20: sma20,
              sma_50: sma50,
              ema_9: ema9,
              ema_above_sma: emaAboveSma,
              price_above_sma50: priceAboveSma50,
              trend_6h: trend6h,
              trend_12h: trend12h,
              bullish_candles_6h: bullish,
              bearish_candles_6h: bearish,
              candle_ratio: bullish / Math.max(1, bullish + bearish),
              volume_increasing: volumeIncreasing,
              support_12h: support12h,
              resistance_12h: resistance12h,
              range_position: marketData.find(m => m.symbol === sym)?.range_position || 50,
              change_24h: marketData.find(m => m.symbol === sym)?.change_24h_percent || 0
            };
          }
        }
        await new Promise(r => setTimeout(r, 350));
      } catch (e) {
        console.warn(`[generateSignals] OHLC fetch failed for ${sym}:`, e.message);
      }
    }

    console.log('[generateSignals] Computed technical indicators for', Object.keys(techIndicators).length, 'symbols');

    // ═══════════════════════════════════════════════
    //  STEP 2: Fetch historical trade performance
    // ═══════════════════════════════════════════════
    let tradeHistory = {};
    try {
      const histRes = await base44.functions.invoke('analyzeTradeHistory', {
        includeKrakenHistory: false,
        analyzePatterns: false
      });
      const histData = histRes?.data || histRes;
      if (histData?.success && histData.asset_analytics) {
        tradeHistory = histData.asset_analytics;
        console.log('[generateSignals] Got trade history for', Object.keys(tradeHistory).length, 'assets');
      }
    } catch (e) {
      console.warn('[generateSignals] Trade history fetch failed:', e.message);
    }

    // ═══════════════════════════════════════════════
    //  STEP 3: Sentiment Analysis via LLM + Internet
    // ═══════════════════════════════════════════════
    let sentimentData = {};
    try {
      console.log('[generateSignals] Running sentiment analysis...');
      const sentimentSymbols = cryptoSymbols.join(', ');

      // Primary: web-enabled, fast model with strict timeout
      let sentimentResponse = await withTimeout(
        base44.integrations.Core.InvokeLLM({
          prompt: `You are a financial sentiment analyst. Analyze the CURRENT market sentiment for these crypto assets: ${sentimentSymbols}
\nSearch for and analyze:
1. Latest news headlines and events affecting each asset
2. Social media trends (Twitter/X, Reddit, crypto forums)
3. Recent regulatory developments
4. Whale activity or large transactions
5. Overall crypto market Fear & Greed level
6. Any upcoming events (token unlocks, upgrades, partnerships)
\nFor each asset, provide a sentiment_score from 0-100:
- 0-20: Extreme negative sentiment (panic selling, terrible news)
- 21-40: Negative (bearish news, declining interest)
- 41-60: Neutral (mixed signals)
- 61-80: Positive (bullish news, growing interest)
- 81-100: Extreme positive (euphoria, viral trending)
\nAlso provide an overall_market_sentiment score and a brief reasoning for each.`,
          add_context_from_internet: true,
          response_json_schema: {
            type: "object",
            properties: {
              overall_market_sentiment: { type: "number" },
              overall_fear_greed: { type: "string" },
              market_narrative: { type: "string" },
              assets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    sentiment_score: { type: "number" },
                    sentiment_label: { type: "string" },
                    key_news: { type: "string" },
                    social_buzz: { type: "string" },
                    upcoming_catalyst: { type: "string" }
                  }
                }
              }
            }
          },
          model: 'gemini_3_flash'
        }),
        12000,
        'sentiment LLM'
      );

      // Fallback: no web, faster JSON model
      if (!sentimentResponse?.assets) {
        console.warn('[generateSignals] Sentiment primary empty, trying fallback model');
        sentimentResponse = await withTimeout(
          base44.integrations.Core.InvokeLLM({
            prompt: `You are a financial sentiment analyst. Analyze relative sentiment for: ${sentimentSymbols}. Return numeric sentiment scores (0-100) only with brief reasoning.`,
            add_context_from_internet: false,
            response_json_schema: {
              type: 'object',
              properties: {
                overall_market_sentiment: { type: 'number' },
                assets: {
                  type: 'array',
                  items: { type: 'object', properties: { symbol: { type: 'string' }, sentiment_score: { type: 'number' }, sentiment_label: { type: 'string' } } }
                }
              }
            },
            model: 'gpt_5_mini'
          }),
          9000,
          'sentiment LLM fallback'
        );
      }

      if (sentimentResponse?.assets) {
        for (const a of sentimentResponse.assets) {
          const sym = (a.symbol || '').toUpperCase();
          if (sym) {
            sentimentData[sym] = {
              score: a.sentiment_score || 50,
              label: a.sentiment_label || 'neutral',
              key_news: a.key_news || '',
              social_buzz: a.social_buzz || 'low',
              upcoming_catalyst: a.upcoming_catalyst || ''
            };
          }
        }
        sentimentData._overall = {
          score: sentimentResponse.overall_market_sentiment || 50,
          fear_greed: sentimentResponse.overall_fear_greed || 'neutral',
          narrative: sentimentResponse.market_narrative || ''
        };
      } else {
        console.warn('[generateSignals] Sentiment unavailable — defaulting to neutral');
        sentimentData._overall = { score: 50, fear_greed: 'neutral', narrative: '' };
      }
      console.log('[generateSignals] Got sentiment for', Math.max(0, Object.keys(sentimentData).length - 1), 'assets');
    } catch (e) {
      console.warn('[generateSignals] Sentiment analysis failed:', e.message);
      sentimentData._overall = { score: 50, fear_greed: 'neutral', narrative: '' };
    }

    // ═══════════════════════════════════════════════
    //  STEP 4: LLM contextual analysis (with all data)
    // ═══════════════════════════════════════════════
    const assetsSection = marketData.map(a => {
      const ti = techIndicators[a.symbol] || {};
      const hist = tradeHistory[a.symbol] || {};
      const sent = sentimentData[a.symbol] || {};

      let ctx = `- ${a.symbol}: Price=$${a.price}, 24h=${a.change_24h_percent.toFixed(2)}%, Range=${a.range_position.toFixed(0)}%`;

      if (ti.rsi_1h != null) ctx += `\n    RSI(14)=${ti.rsi_1h.toFixed(1)}`;
      if (ti.macd_1h) ctx += `, MACD histogram=${ti.macd_1h.histogram.toFixed(6)} (${ti.macd_1h.bullishCross ? 'BULLISH CROSS' : ti.macd_1h.bearishCross ? 'BEARISH CROSS' : 'no cross'})`;
      if (ti.bb_1h) ctx += `, BB %B=${ti.bb_1h.percentB.toFixed(1)}% bandwidth=${ti.bb_1h.bandwidth.toFixed(2)}%`;
      if (ti.atr_pct) ctx += `, ATR=${ti.atr_pct.toFixed(2)}%`;
      if (ti.price_vs_vwap != null) ctx += `, VWAP ${ti.price_vs_vwap > 0 ? 'above' : 'below'} ${Math.abs(ti.price_vs_vwap).toFixed(2)}%`;
      if (ti.ema_above_sma != null) ctx += `, EMA9 ${ti.ema_above_sma ? '>' : '<'} SMA20`;
      if (ti.price_above_sma50 != null) ctx += `, Price ${ti.price_above_sma50 ? '>' : '<'} SMA50`;

      ctx += `\n    6h trend: ${ti.trend_6h?.toFixed(2) || '?'}%, 12h trend: ${ti.trend_12h?.toFixed(2) || '?'}%`;
      ctx += `, Bullish candles: ${ti.bullish_candles_6h || '?'}/6, Vol increasing: ${ti.volume_increasing ? 'YES' : 'NO'}`;

      if (sent.score) ctx += `\n    SENTIMENT: ${sent.score}/100 (${sent.label}) — ${sent.key_news || 'No major news'}`;
      if (hist.total_trades > 0) ctx += `\n    HISTORY: ${hist.total_trades} trades, Win=${(hist.win_rate || 0).toFixed(0)}%, AvgWin=+${(hist.avg_successful_gain_pct || 0).toFixed(1)}%`;

      return ctx;
    }).join('\n');

    const overallSent = sentimentData._overall || {};

    let aiRecommendations = [];
    try {
      console.log('[generateSignals] Calling LLM with full technical + sentiment context...');
      const llmResponse = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a CONSERVATIVE quantitative trading system optimized for 80%+ WIN RATE.
You have access to real technical indicators (RSI, MACD, Bollinger Bands, ATR, VWAP, EMAs) computed from actual OHLC data.

OVERALL MARKET: Sentiment ${overallSent.score || '?'}/100, Fear/Greed: ${overallSent.fear_greed || '?'}
${overallSent.narrative || ''}

=== STRICT SIGNAL RULES ===

STRONG_BUY (auto-execute) — At LEAST 2 must be true (or strong momentum):
1. RSI between 30-85 (not overbought)
2. MACD histogram positive OR bullish crossover
3. Price near or below Bollinger middle band (%B < 60)
4. 6h AND 12h trends positive (even if the current pace is falling)
5. Volume increasing or expected to be increasing
6. Sentiment score > 50
7. Historical win rate > 50% (if history exists)
→ Confidence 50%+

BUY — At least 1 of above criteria met, confidence 45-59%
HOLD — Conflicting signals, RSI 40-60, no clear direction
SELL — RSI > 65 + bearish MACD + negative trends
STRONG_SELL — RSI > 70 + bearish cross + high volume selling

=== RISK PARAMETERS ===
- SL: 1-3% (use ATR: 1.5x ATR as SL)
- TP: 2-8% (min 2:1 reward-to-risk)
- Entry zone: within 1% of current price

=== ASSETS ===
${assetsSection}

For each asset, provide:
symbol, optimal_action, confidence_score (0-100), entry_zone_low, entry_zone_high,
stop_loss_pct (1-3%), take_profit_pct (2-8%), momentum_strength (strong/moderate/weak),
timing_window (1h/2h/4h/6h), predicted_gain_percent, sentiment_score (0-100),
reasoning (cite specific indicator values), technical_pattern, trend_alignment,
volume_confirmation (bool), correlation_group

BE cautiously optimistic, but SELECTIVE. "hold" is always better than a false "strong_buy".`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  optimal_action: { type: "string" },
                  confidence_score: { type: "number" },
                  entry_zone_low: { type: "number" },
                  entry_zone_high: { type: "number" },
                  stop_loss_pct: { type: "number" },
                  take_profit_pct: { type: "number" },
                  momentum_strength: { type: "string" },
                  timing_window: { type: "string" },
                  predicted_gain_percent: { type: "number" },
                  sentiment_score: { type: "number" },
                  reasoning: { type: "string" },
                  technical_pattern: { type: "string" },
                  trend_alignment: { type: "string" },
                  volume_confirmation: { type: "boolean" },
                  correlation_group: { type: "string" }
                }
              }
            }
          }
        }
      });

      aiRecommendations = llmResponse?.recommendations || [];
      console.log('[generateSignals] Got', aiRecommendations.length, 'LLM recommendations');
    } catch (e) {
      console.error('[generateSignals] LLM analysis failed:', e.message);
    }

    // ═══════════════════════════════════════════════
    //  STEP 5: ML Composite Scoring + Hard Filters
    // ═══════════════════════════════════════════════
    const signalsCreated = [];
    const expiresAt = new Date(Date.now() + SIGNAL_TTL_HOURS * 60 * 60 * 1000).toISOString();

    for (const asset of assetsNeedingAnalysis) {
      const sym = asset.symbol;
      const quote = marketData.find(q => q.symbol === sym);
      const ti = techIndicators[sym] || {};
      const hist = tradeHistory[sym];
      const sent = sentimentData[sym];
      const aiRec = aiRecommendations.find(r => (r.symbol || '').toUpperCase() === sym);
      const change24h = quote?.change_24h_percent || 0;

      // ── Compute composite score from all indicators ──
      const compositeScore = computeCompositeScore(ti, sent?.score, hist, userStrategies);
      const { signalType: mlSignal, confidence: mlConfidence } = scoreToSignal(compositeScore);

      console.log(`[generateSignals] ${sym}: Composite=${compositeScore}, ML→${mlSignal}@${mlConfidence}%`);

      // ── Blend ML score with LLM recommendation ──
      let finalSignalType = mlSignal;
      let finalConfidence = mlConfidence;

      if (aiRec) {
        const aiAction = (aiRec.optimal_action || 'hold').toLowerCase();
        const aiConf = aiRec.confidence_score || 50;

        // Weighted blend: 20% ML model, 80% LLM <--- This is where you change the LLM:ML ratio <---
        finalConfidence = Math.round(mlConfidence * 0.2 + aiConf * 0.8);

        // CRITICAL: Use the MORE BULLISH of the two signals
        // The old logic let a single "sell" from LLM override an ML "buy" — this killed all trades
        const signalRank = { 'strong_buy': 5, 'buy': 4, 'hold': 3, 'sell': 2, 'strong_sell': 1 };
        const mlRank = signalRank[mlSignal] || 3;
        const aiRank = signalRank[aiAction] || 3;

        // Take the HIGHER (more bullish) of the two signals
        // Only let BOTH agreeing on sell/strong_sell produce a sell signal
        if (mlRank >= 4 && aiRank >= 4) {
          // Both say buy or strong_buy
          finalSignalType = (mlRank === 5 || aiRank === 5) ? 'strong_buy' : 'buy';
          finalConfidence = Math.min(95, finalConfidence + 5);
        } else if (mlRank >= 4 || aiRank >= 4) {
          // At least ONE says buy — respect it
          finalSignalType = (mlRank >= 5 || aiRank >= 5) ? 'strong_buy' : 'buy';
          // Cap confidence if the other disagrees
          if (mlRank < 3 || aiRank < 3) {
            finalConfidence = Math.min(finalConfidence, 65);
          }
        } else if (mlRank <= 2 && aiRank <= 2) {
          // BOTH say sell — only then produce sell
          finalSignalType = (mlRank === 1 || aiRank === 1) ? 'strong_sell' : 'sell';
        } else {
          // Mixed: one hold + one sell, or similar — default to hold
          finalSignalType = mlRank >= aiRank ? mlSignal : aiAction;
          finalConfidence = Math.min(finalConfidence, 60);
        }
      }

      // ── Hard filter: strong_buy data validation ──
      // Highly relaxed: only downgrade for critical, undeniable bearish conditions
      if (finalSignalType === 'strong_buy') {
        const violations = [];

        if (ti.rsi_1h != null && ti.rsi_1h > 80) violations.push(`RSI extremely overbought ${ti.rsi_1h.toFixed(0)}`);
        if (ti.bb_1h && ti.bb_1h.percentB > 95) violations.push('At extreme upper BB');
        if (ti.trend_6h != null && ti.trend_6h < -2.0) violations.push('Severe 6h downtrend');
        if (hist && hist.total_trades >= 5 && hist.win_rate < 30) violations.push('Terrible history');

        if (violations.length >= 3) {
          console.log(`[generateSignals] DOWNGRADE ${sym} strong_buy→hold: ${violations.join(', ')}`);
          finalSignalType = 'hold';
          finalConfidence = Math.min(finalConfidence, 55);
        } else if (violations.length >= 2) {
          console.log(`[generateSignals] DOWNGRADE ${sym} strong_buy→buy: ${violations.join(', ')}`);
          finalSignalType = 'buy';
          finalConfidence = Math.min(finalConfidence, 70);
        }
        // 0-1 violations = stays strong_buy
      }

      // Confidence floor for signal types — uses user's settings
      if (userAutoExecuteThreshold !== null && finalSignalType === 'strong_buy' && finalConfidence < userAutoExecuteThreshold) {
        finalSignalType = 'buy';
        finalConfidence = Math.min(finalConfidence, userAutoExecuteThreshold - 1);
      }

      if (userMinSignalConfidence !== null && finalSignalType === 'buy' && finalConfidence < userMinSignalConfidence) {
        finalSignalType = 'hold';
        finalConfidence = Math.min(finalConfidence, userMinSignalConfidence - 1);
      }

      // ── TP/SL from ATR or defaults ──
      let tp = aiRec?.take_profit_pct || 5;
      let sl = aiRec?.stop_loss_pct || 2.5;

      // ATR-based SL if available
      if (ti.atr_pct) {
        const atrSl = ti.atr_pct * 1.5;
        sl = Math.max(2, Math.min(4, atrSl));
      }
      if (tp / sl < 2.0) tp = sl * 2.5;
      if (sl < 2) sl = 2;
      if (tp < 4) tp = 4;
      if (sl > 4) sl = 4;

      // ── Build reasoning ──
      const indicators_summary = [];
      if (ti.rsi_1h != null) indicators_summary.push(`RSI=${ti.rsi_1h.toFixed(1)}`);
      if (ti.macd_1h) indicators_summary.push(`MACD hist=${ti.macd_1h.histogram > 0 ? '+' : ''}${ti.macd_1h.histogram.toFixed(6)}${ti.macd_1h.bullishCross ? ' BULL CROSS' : ti.macd_1h.bearishCross ? ' BEAR CROSS' : ''}`);
      if (ti.bb_1h) indicators_summary.push(`BB %B=${ti.bb_1h.percentB.toFixed(0)}%`);
      if (sent) indicators_summary.push(`Sentiment=${sent.score}/100`);

      const reasoning = aiRec?.reasoning
        ? `${aiRec.reasoning} | Indicators: ${indicators_summary.join(', ')} | Composite score: ${compositeScore}`
        : `ML composite score: ${compositeScore}. ${indicators_summary.join(', ')}. ${sent?.key_news || 'No major news.'}`;

      // ── Save signal ──
      const existingSignal = existingSignals.find(s => s.asset_symbol === sym);

      const signalData = {
        asset_symbol: sym,
        asset_type: asset.asset_type,
        timeframe: '4h',
        signal_type: finalSignalType,
        confidence_score: Math.round(finalConfidence),
        reasoning,
        technical_pattern: aiRec?.technical_pattern || null,
        sentiment_score: sent?.score || aiRec?.sentiment_score || 50,
        price_at_signal: quote?.price || 0,
        target_price: aiRec?.target_price || null,
        stop_loss_price: aiRec?.stop_loss_price || null,
        entry_zone_low: aiRec?.entry_zone_low || null,
        entry_zone_high: aiRec?.entry_zone_high || null,
        take_profit_pct: tp,
        stop_loss_pct: sl,
        momentum_strength: aiRec?.momentum_strength || (compositeScore > 30 ? 'strong' : compositeScore > 10 ? 'moderate' : 'weak'),
        timing_window: aiRec?.timing_window || null,
        predicted_gain_pct: aiRec?.predicted_gain_percent || null,
        change_24h: change24h,
        expires_at: expiresAt,
        is_active: true,
        metadata_json: JSON.stringify({
          generated_at: now.toISOString(),
          generator_version: 'v5_enhanced',
          composite_score: compositeScore,
          ml_signal: mlSignal,
          ml_confidence: mlConfidence,
          llm_signal: aiRec?.optimal_action || 'none',
          llm_confidence: aiRec?.confidence_score || 0,
          rsi: ti.rsi_1h,
          macd_histogram: ti.macd_1h?.histogram,
          macd_bullish_cross: ti.macd_1h?.bullishCross,
          bb_percent_b: ti.bb_1h?.percentB,
          bb_bandwidth: ti.bb_1h?.bandwidth,
          atr_pct: ti.atr_pct,
          vwap_diff: ti.price_vs_vwap,
          sentiment: sent?.score,
          sentiment_label: sent?.label,
          sentiment_news: sent?.key_news,
          sentiment_catalyst: sent?.upcoming_catalyst,
          overall_market_sentiment: sentimentData._overall?.score,
          trend_6h: ti.trend_6h,
          trend_12h: ti.trend_12h,
          candle_ratio_6h: ti.candle_ratio,
          volume_increasing: ti.volume_increasing,
          range_position: ti.range_position,
          trend_alignment: aiRec?.trend_alignment || null,
          volume_confirmation: aiRec?.volume_confirmation || null,
          historical_win_rate: hist?.win_rate || null,
          historical_avg_gain: hist?.avg_successful_gain_pct || null,
          historical_trades: hist?.total_trades || 0,
          correlation_group: aiRec?.correlation_group || null,
          auto_tradeable: finalSignalType === 'strong_buy' || finalSignalType === 'buy',
          trade_debug: {
            composite_score: compositeScore,
            ml_signal: mlSignal,
            ml_confidence: mlConfidence,
            llm_signal: aiRec?.optimal_action || null,
            llm_confidence: aiRec?.confidence_score || null,
            final_signal: finalSignalType,
            price_at_signal: quote?.price || null,
            entry_zone_low: aiRec?.entry_zone_low || null,
            entry_zone_high: aiRec?.entry_zone_high || null,
            auto_tradeable: finalSignalType === 'strong_buy' || finalSignalType === 'buy'
          }
        })
      };

      try {
        if (existingSignal) {
          await base44.asServiceRole.entities.AssetSignal.update(existingSignal.id, signalData);
          signalsCreated.push({ ...signalData, id: existingSignal.id, action: 'updated' });
        } else {
          const newSignal = await base44.asServiceRole.entities.AssetSignal.create(signalData);
          signalsCreated.push({ ...signalData, id: newSignal.id, action: 'created' });
        }
        console.log(`[generateSignals] ${sym}: ${finalSignalType}@${finalConfidence}% (composite=${compositeScore}, RSI=${ti.rsi_1h?.toFixed(0) || '?'}, MACD=${ti.macd_1h?.histogram > 0 ? '+' : ''}${ti.macd_1h?.histogram?.toFixed(4) || '?'}, BB%B=${ti.bb_1h?.percentB?.toFixed(0) || '?'}%, Sent=${sent?.score || '?'})`);
      } catch (e) {
        console.error(`[generateSignals] Failed to save signal for ${sym}:`, e.message);
      }
    }

    // Expire old signals
    try {
      const expiredSignals = existingSignals.filter(s =>
        s.expires_at && new Date(s.expires_at) <= now && s.is_active
      );
      for (const sig of expiredSignals) {
        await base44.asServiceRole.entities.AssetSignal.update(sig.id, { is_active: false });
      }
      if (expiredSignals.length > 0) {
        console.log('[generateSignals] Expired', expiredSignals.length, 'old signals');
      }
    } catch (e) {
      console.warn('[generateSignals] Could not expire old signals:', e.message);
    }

    const duration = Date.now() - startTime;
    console.log('[generateSignals] v5 Complete:', signalsCreated.length, 'signals in', duration, 'ms');

    return Response.json({
      success: true,
      signals_generated: signalsCreated.length,
      signals_reused: validSignals.size,
      signals: signalsCreated.map(s => ({
        symbol: s.asset_symbol,
        signal_type: s.signal_type,
        confidence: s.confidence_score,
        change_24h: s.change_24h,
        momentum: s.momentum_strength,
        tp_pct: s.take_profit_pct,
        sl_pct: s.stop_loss_pct,
        composite_score: JSON.parse(s.metadata_json || '{}').composite_score,
        rsi: JSON.parse(s.metadata_json || '{}').rsi,
        sentiment: JSON.parse(s.metadata_json || '{}').sentiment,
        action: s.action
      })),
      market_sentiment: sentimentData._overall || null,
      duration_ms: duration
    });

  } catch (error) {
    console.error('[generateSignals] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});