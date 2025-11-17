import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Technical indicator calculations
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod) return null;
  
  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);
  const macdLine = emaFast - emaSlow;
  
  const macdHistory = [];
  for (let i = 0; i < prices.length; i++) {
    const fast = calculateEMA(prices.slice(0, i + 1), fastPeriod);
    const slow = calculateEMA(prices.slice(0, i + 1), slowPeriod);
    macdHistory.push(fast - slow);
  }
  
  const signalLine = calculateEMA(macdHistory.slice(-signalPeriod), signalPeriod);
  const histogram = macdLine - signalLine;
  
  return { macdLine, signalLine, histogram };
}

function calculateEMA(prices, period) {
  if (prices.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { action, payload } = await req.json();
    
    if (action === 'calculate') {
      const { prices, indicators } = payload;
      
      const results = {};
      
      if (indicators.rsi_period) {
        results.rsi = calculateRSI(prices, indicators.rsi_period);
      }
      
      if (indicators.macd_fast) {
        results.macd = calculateMACD(
          prices,
          indicators.macd_fast,
          indicators.macd_slow,
          indicators.macd_signal
        );
      }
      
      if (indicators.ma_short) {
        results.ma_short = calculateSMA(prices, indicators.ma_short);
      }
      
      if (indicators.ma_long) {
        results.ma_long = calculateSMA(prices, indicators.ma_long);
      }
      
      return Response.json({ success: true, indicators: results });
    }
    
    if (action === 'evaluateSignal') {
      const { prices, strategy } = payload;
      const indicators = strategy.indicators || {};
      
      const rsi = indicators.rsi_period ? calculateRSI(prices, indicators.rsi_period) : null;
      const macd = indicators.macd_fast ? calculateMACD(prices, indicators.macd_fast, indicators.macd_slow, indicators.macd_signal) : null;
      const maShort = indicators.ma_short ? calculateSMA(prices, indicators.ma_short) : null;
      const maLong = indicators.ma_long ? calculateSMA(prices, indicators.ma_long) : null;
      
      let buySignal = false;
      let sellSignal = false;
      let signalType = null;
      
      // Entry signals
      if (strategy.entry_conditions === 'RSI_OVERSOLD' && rsi && rsi < indicators.rsi_oversold) {
        buySignal = true;
        signalType = 'RSI_OVERSOLD';
      }
      
      if (strategy.entry_conditions === 'MACD_BULLISH_CROSS' && macd && macd.histogram > 0) {
        buySignal = true;
        signalType = 'MACD_BULLISH_CROSS';
      }
      
      if (strategy.entry_conditions === 'MA_CROSS_UP' && maShort && maLong && maShort > maLong) {
        buySignal = true;
        signalType = 'MA_CROSS_UP';
      }
      
      // Exit signals
      if (strategy.exit_conditions === 'RSI_OVERBOUGHT' && rsi && rsi > indicators.rsi_overbought) {
        sellSignal = true;
        signalType = 'RSI_OVERBOUGHT';
      }
      
      if (strategy.exit_conditions === 'MACD_BEARISH_CROSS' && macd && macd.histogram < 0) {
        sellSignal = true;
        signalType = 'MACD_BEARISH_CROSS';
      }
      
      if (strategy.exit_conditions === 'MA_CROSS_DOWN' && maShort && maLong && maShort < maLong) {
        sellSignal = true;
        signalType = 'MA_CROSS_DOWN';
      }
      
      return Response.json({
        success: true,
        signal: {
          buy: buySignal,
          sell: sellSignal,
          type: signalType,
          indicators: { rsi, macd, maShort, maLong }
        }
      });
    }
    
    return Response.json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (error) {
    console.error('Technical indicators error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});