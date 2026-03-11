import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * Kraken Trade Executor - COMPLETE WebSocket v2 Trading Implementation
 * 
 * Supports ALL Kraken order types:
 * - market: Immediate execution at best available price
 * - limit: Execute at specified price or better
 * - stop-loss: Market order triggered at stop price
 * - stop-loss-limit: Limit order triggered at stop price
 * - take-profit: Market order triggered at profit target
 * - take-profit-limit: Limit order triggered at profit target
 * - trailing-stop: Market order triggered when price reverts from peak
 * - trailing-stop-limit: Limit order triggered when price reverts from peak
 * - iceberg: Large order split into smaller visible portions
 * 
 * CRITICAL: Only for admin/creator users in LIVE mode
 */

const WS_URL = 'wss://ws-auth.kraken.com/v2';
const WS_PUBLIC_URL = 'wss://ws.kraken.com/v2';
const WS_TIMEOUT = 30000; // 30 second timeout for robustness

// Per-user trade-key token bucket to avoid EAPI:Rate limit exceeded
const __tradeBuckets = new Map();
function __getTradeBucket(userEmail) {
  const key = String(userEmail || 'anon');
  if (!__tradeBuckets.has(key)) {
    __tradeBuckets.set(key, { tokens: 4, last: Date.now() });
  }
  return __tradeBuckets.get(key);
}
export async function tradeRateGate(userEmail, cost = 1) {
  const bucket = __getTradeBucket(userEmail);
  const now = Date.now();
  const elapsed = (now - bucket.last) / 1000;
  // ~0.6 tokens/sec refill, cap 4
  bucket.tokens = Math.min(4, bucket.tokens + elapsed * 0.6);
  bucket.last = now;
  if (bucket.tokens >= cost) { bucket.tokens -= cost; return; }
  const deficit = cost - bucket.tokens;
  const wait = Math.ceil((deficit / 0.6) * 1000) + 50;
  await new Promise(r => setTimeout(r, Math.min(wait, 3000)));
}

// Per-user in-memory queue to serialize add_order calls (prevents EAPI:Rate limit exceeded)
const __orderLocks = new Map();
async function withOrderLock(userEmail, task) {
  const key = String(userEmail || 'anon');
  const prev = __orderLocks.get(key) || Promise.resolve();
  let resolveNext;
  const next = (async () => {
    try { return await prev; } catch (_) { /* ignore previous errors in chain */ }
  })().then(task);
  __orderLocks.set(key, next.then(() => {}, () => {}));
  return next;
}

/**
 * Format symbol for Kraken (e.g., "BTC" -> "BTC/USD")
 * CRITICAL: Uses official Kraken trading pair format
 */
/**
 * Kraken price decimal requirements per asset
 * Reference: https://support.kraken.com/hc/en-us/articles/4521313131540-Price-and-volume-decimal-precision
 */
const PRICE_DECIMALS = {
  'BTC': 1,
  'XBT': 1,
  'ETH': 2,
  'XRP': 5,  // XRP trades around $2, needs 5 decimals
  'LTC': 2,
  'SOL': 2,
  'ADA': 5,  // ADA trades around $0.40
  'DOT': 3,
  'DOGE': 5, // DOGE trades around $0.10
  'XDG': 5,
  'LINK': 3,
  'UNI': 3,
  'MATIC': 4,
  'POL': 4,
  'ATOM': 3,
  'AVAX': 2,
  'BCH': 2,
  'TRX': 5,
  'SHIB': 8, // SHIB trades very low
  'XLM': 5,  // XLM trades around $0.20
  'ALGO': 4,
  'FIL': 3,
  'NEAR': 3,
  'APT': 3,
  'ARB': 4,
  'OP': 3,
  'INJ': 2,
  'PEPE': 9, // PEPE trades very low
  'SUI': 4
};

/**
 * Round price to Kraken's required decimal precision for the asset
 */
function roundPriceForKraken(price, symbol) {
  const baseSymbol = symbol.replace('/USD', '').toUpperCase();
  const decimals = PRICE_DECIMALS[baseSymbol] ?? 4; // Default to 4 decimals if unknown
  const factor = Math.pow(10, decimals);
  return Math.round(price * factor) / factor;
}

function formatKrakenSymbol(symbol) {
  // If already in pair format, return as-is
  if (symbol.includes('/')) {
    return symbol.toUpperCase();
  }
  
  // Map common symbols to Kraken pairs
  // Note: Kraken uses specific pair formats - some assets need XXLM format
  const symbolMap = {
    'BTC': 'BTC/USD',
    'XBT': 'BTC/USD', // Kraken alias
    'ETH': 'ETH/USD',
    'XRP': 'XRP/USD',
    'LTC': 'LTC/USD',
    'SOL': 'SOL/USD',
    'ADA': 'ADA/USD',
    'DOT': 'DOT/USD',
    'DOGE': 'DOGE/USD',
    'XDG': 'DOGE/USD', // Kraken alias
    'LINK': 'LINK/USD',
    'UNI': 'UNI/USD',
    'MATIC': 'MATIC/USD',
    'POL': 'POL/USD',  // Polygon rebrand
    'ATOM': 'ATOM/USD',
    'AVAX': 'AVAX/USD',
    'BCH': 'BCH/USD',
    'TRX': 'TRX/USD',
    'SHIB': 'SHIB/USD',
    'XLM': 'XLM/USD',  // Stellar - verified format
    'ALGO': 'ALGO/USD',
    'FIL': 'FIL/USD',
    'NEAR': 'NEAR/USD',
    'APT': 'APT/USD',
    'ARB': 'ARB/USD',
    'OP': 'OP/USD',
    'INJ': 'INJ/USD',
    'PEPE': 'PEPE/USD',
    'SUI': 'SUI/USD',
    'HBAR': 'HBAR/USD',
    'KAS': 'KAS/USD',
    'TAO': 'TAO/USD',
    'EIGEN': 'EIGEN/USD',
    'ENA': 'ENA/USD',
    'GRASS': 'GRASS/USD',
    'GOAT': 'GOAT/USD',
    'TRUMP': 'TRUMP/USD',
    'FARTCOIN': 'FARTCOIN/USD',
    'MOVE': 'MOVE/USD',
    'KAITO': 'KAITO/USD',
    'TIA': 'TIA/USD',
    'FET': 'FET/USD',
    'JUP': 'JUP/USD',
    'WIF': 'WIF/USD',
    'BONK': 'BONK/USD',
    'FLOKI': 'FLOKI/USD',
    'BABY': 'BABY/USD'
  };
  
  return symbolMap[symbol.toUpperCase()] || `${symbol.toUpperCase()}/USD`;
  }

  // Normalize Kraken asset key (e.g., XXLM -> XLM, XBT -> BTC)
  function normalizeAssetKey(key) {
    let s = String(key || '').toUpperCase();
    if (s.startsWith('Z')) s = s.slice(1); // ZUSD -> USD
    if (s.startsWith('XX')) s = s.slice(1); // XXLM -> XLM
    const map = {
      XBT: 'BTC', XXBT: 'BTC', BT: 'BTC',
      ETH: 'ETH', XETH: 'ETH',
      XRP: 'XRP', XXRP: 'XRP',
      XLM: 'XLM', XXLM: 'XLM', LM: 'XLM',
      DOGE: 'DOGE', XDG: 'DOGE',
      USDT: 'USDT', USDC: 'USDC', USD: 'USD'
    };
    return map[s] || s;
  }

  // Fetch available (free) holdings per asset from Kraken extended balance
  async function getAvailableMap(base44) {
    try {
      const resp = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getExtendedBalance' });
      let data = resp?.data || resp;
      if (data?.data) data = data.data;
      const out = {};
      const bal = data?.balance || data;
      if (!bal) return out;
      for (const [k, v] of Object.entries(bal)) {
        const sym = normalizeAssetKey(k);
        const qty = typeof v === 'object' && v !== null ? parseFloat(v.balance ?? v.total ?? 0) : parseFloat(v || 0);
        if (!isNaN(qty)) out[sym] = qty;
      }
      return out;
    } catch (_e) {
      return {};
    }
  }

/**
 * Build order parameters based on order type
 * CRITICAL: Follows Kraken WebSocket v2 API spec exactly
 * 
 * SUPPORTED FEATURES (matching Kraken Pro):
 * - All order types: market, limit, stop-loss, take-profit, trailing-stop, etc.
 * - OTO (One-Triggers-Other) for attaching TP/SL to buy orders
 * - Percentage-based triggers (price_type: 'pct')
 * - Static price triggers (price_type: 'static')
 * - Quote offset triggers (price_type: 'quote')
 */
function buildOrderParams(orderConfig) {
  const {
    orderType = 'market',
    side,
    quantity,
    symbol,
    limitPrice,
    stopPrice,
    triggerPrice,
    trailingAmount,
    trailingPercent,
    timeInForce = 'gtc', // gtc, ioc, gtd
    postOnly = false,
    reduceOnly = false,
    displayQty, // For iceberg orders
    conditionalCloseOrder, // For OTO (One-Triggers-Other)
    // NEW: Enhanced TP/SL parameters
    takeProfitPercent,    // e.g., 3 for +3% TP
    stopLossPercent,      // e.g., 1 for -1% SL
    takeProfitPrice,      // Absolute USD price for TP
    stopLossPrice,        // Absolute USD price for SL
    triggerReference = 'last' // 'last' or 'index'
  } = orderConfig;

  // FIXED: Generate valid 32-bit userref (Kraken requirement)
  // Use random number + last 6 digits of timestamp to ensure uniqueness
  const userref = parseInt((Math.floor(Math.random() * 1000) * 1000000 + parseInt(Date.now().toString().slice(-6))).toString().slice(-9));
  
  const formattedSymbol = formatKrakenSymbol(symbol);
  const parsedQty = parseFloat(quantity);

  console.log('[buildOrderParams] Input:', { orderType, side, quantity: parsedQty, symbol: formattedSymbol, stopPrice, limitPrice });

  // CRITICAL: For market orders, DON'T include time_in_force
  // Kraken WebSocket v2 API: market orders do NOT accept time_in_force parameter
  if (orderType === 'market') {
    const params = {
      order_type: 'market',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      order_userref: userref
    };
    console.log('[buildOrderParams] Market order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For limit orders - supports OTO (One-Triggers-Other) for TP/SL
  if (orderType === 'limit') {
    if (!limitPrice || parseFloat(limitPrice) <= 0) {
      throw new Error('Limit orders require a valid limit_price');
    }
    const params = {
      order_type: 'limit',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      limit_price: parseFloat(limitPrice),
      time_in_force: timeInForce,
      order_userref: userref
    };
    if (postOnly) params.post_only = true;
    
    // CRITICAL: Add OTO conditional close order if specified
    // This attaches a TP or SL to fire when the primary order fills
    // NOTE: Kraken only supports ONE conditional per order, so we can do TP or SL, not both
    if (conditionalCloseOrder) {
      params.conditional = {
        order_type: conditionalCloseOrder.orderType || 'take-profit',
        trigger_price: parseFloat(conditionalCloseOrder.triggerPrice),
        trigger_price_type: conditionalCloseOrder.priceType || 'static'
      };
      if (conditionalCloseOrder.limitPrice) {
        params.conditional.limit_price = parseFloat(conditionalCloseOrder.limitPrice);
      }
      console.log('[buildOrderParams] OTO conditional:', JSON.stringify(params.conditional));
    }
    
    console.log('[buildOrderParams] Limit order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For stop-loss orders - Kraken requires triggers.price and triggers.price_type
  if (orderType === 'stop-loss') {
    if (!stopPrice || parseFloat(stopPrice) <= 0) {
      throw new Error('Stop-loss orders require a valid stopPrice');
    }
    // CRITICAL: Round price to Kraken's required decimal precision
    const roundedPrice = roundPriceForKraken(parseFloat(stopPrice), formattedSymbol);
    console.log('[buildOrderParams] Stop-loss price rounded:', stopPrice, '->', roundedPrice, 'for', formattedSymbol);
    
    const params = {
      order_type: 'stop-loss',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',
        price: roundedPrice,
        price_type: 'static'
      }
    };
    console.log('[buildOrderParams] Stop-loss order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For stop-loss-limit orders
  if (orderType === 'stop-loss-limit') {
    if (!stopPrice || parseFloat(stopPrice) <= 0) {
      throw new Error('Stop-loss-limit orders require a valid stopPrice');
    }
    if (!limitPrice || parseFloat(limitPrice) <= 0) {
      throw new Error('Stop-loss-limit orders require a valid limitPrice');
    }
    const params = {
      order_type: 'stop-loss-limit',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      limit_price: parseFloat(limitPrice),
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',
        price: parseFloat(stopPrice),
        price_type: 'static'
      }
    };
    console.log('[buildOrderParams] Stop-loss-limit order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For take-profit orders
  // Kraken WebSocket v2 uses 'take-profit' order type with triggers object
  // The trigger fires when market price RISES to or above the trigger price (for sell side)
  // From Kraken docs: "A market order is triggered when the reference price reaches the stop price (from a favourable direction)"
  if (orderType === 'take-profit') {
    const tpPrice = triggerPrice || stopPrice;
    if (!tpPrice || parseFloat(tpPrice) <= 0) {
      throw new Error('Take-profit orders require a valid triggerPrice');
    }
    
    // CRITICAL: Round price to Kraken's required decimal precision
    const roundedTpPrice = roundPriceForKraken(parseFloat(tpPrice), formattedSymbol);
    console.log('[buildOrderParams] Take-profit price rounded:', tpPrice, '->', roundedTpPrice, 'for', formattedSymbol);
    
    console.log('[buildOrderParams] Building take-profit order:', {
      side: side.toLowerCase(),
      qty: parsedQty,
      symbol: formattedSymbol,
      triggerPrice: roundedTpPrice
    });
    
    // CRITICAL: Use 'static' price_type for absolute USD trigger price
    const params = {
      order_type: 'take-profit',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',       // Use last traded price as reference
        price: roundedTpPrice,   // Absolute price in USD (rounded)
        price_type: 'static'     // Static price target (not percentage)
      }
    };
    
    console.log('[buildOrderParams] Take-profit order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For take-profit-limit orders
  if (orderType === 'take-profit-limit') {
    const tpPrice = triggerPrice || stopPrice;
    if (!tpPrice || parseFloat(tpPrice) <= 0) {
      throw new Error('Take-profit-limit orders require a valid triggerPrice');
    }
    if (!limitPrice || parseFloat(limitPrice) <= 0) {
      throw new Error('Take-profit-limit orders require a valid limitPrice');
    }
    const params = {
      order_type: 'take-profit-limit',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      limit_price: parseFloat(limitPrice),
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',
        price: parseFloat(tpPrice),
        price_type: 'static'
      }
    };
    console.log('[buildOrderParams] Take-profit-limit order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For trailing-stop orders
  // Kraken trailing-stop: market order triggered when price reverts from peak by specified amount
  // - price_type: 'pct' = percentage (e.g., 5 = 5% reversion from peak)
  // - price_type: 'quote' = USD amount (e.g., 500 = $500 reversion from peak)
  if (orderType === 'trailing-stop') {
    let trailPrice = 5.0; // Default 5% trailing
    let trailPriceType = 'pct';
    
    // Check for explicit price type override
    if (orderConfig.trailingPriceType === 'quote' && trailingAmount && parseFloat(trailingAmount) > 0) {
      trailPrice = parseFloat(trailingAmount);
      trailPriceType = 'quote';
    } else if (orderConfig.trailingPriceType === 'pct' && trailingPercent && parseFloat(trailingPercent) > 0) {
      trailPrice = parseFloat(trailingPercent);
      trailPriceType = 'pct';
    } else if (trailingPercent && parseFloat(trailingPercent) > 0) {
      // Default: if trailingPercent is provided, use percentage
      trailPrice = parseFloat(trailingPercent);
      trailPriceType = 'pct';
    } else if (trailingAmount && parseFloat(trailingAmount) > 0) {
      // Fallback: if trailingAmount is provided, use quote
      trailPrice = parseFloat(trailingAmount);
      trailPriceType = 'quote';
    }
    
    // Validate trailing price is positive (Kraken requirement)
    if (trailPrice <= 0) {
      throw new Error('Trailing stop offset must be a positive value');
    }
    
    const params = {
      order_type: 'trailing-stop',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: triggerReference, // 'last' or 'index'
        price: trailPrice,
        price_type: trailPriceType
      }
    };
    console.log('[buildOrderParams] Trailing-stop order params:', JSON.stringify(params));
    console.log('[buildOrderParams] Trail offset:', trailPrice, trailPriceType === 'pct' ? '%' : 'USD');
    return params;
  }

  // CRITICAL: For trailing-stop-limit orders
  // Same as trailing-stop but executes as limit order when triggered
  // limit_price_type can be 'static', 'pct', or 'quote' (offset from trigger price)
  if (orderType === 'trailing-stop-limit') {
    // For trailing-stop-limit, limit price can be:
    // - A static USD price
    // - A percentage offset from trigger (e.g., 0 = same as trigger, -1 = 1% below trigger)
    // - A quote offset from trigger (e.g., 0 = same as trigger, -100 = $100 below trigger)
    
    let trailPrice = 5.0;
    let trailPriceType = 'pct';
    let limitPriceValue = 0; // Default: same as trigger price
    let limitPriceTypeValue = 'quote'; // Default: offset in USD
    
    // Determine trailing offset
    if (orderConfig.trailingPriceType === 'quote' && trailingAmount && parseFloat(trailingAmount) > 0) {
      trailPrice = parseFloat(trailingAmount);
      trailPriceType = 'quote';
    } else if (orderConfig.trailingPriceType === 'pct' && trailingPercent && parseFloat(trailingPercent) > 0) {
      trailPrice = parseFloat(trailingPercent);
      trailPriceType = 'pct';
    } else if (trailingPercent && parseFloat(trailingPercent) > 0) {
      trailPrice = parseFloat(trailingPercent);
      trailPriceType = 'pct';
    } else if (trailingAmount && parseFloat(trailingAmount) > 0) {
      trailPrice = parseFloat(trailingAmount);
      trailPriceType = 'quote';
    }
    
    // Validate trailing price
    if (trailPrice <= 0) {
      throw new Error('Trailing stop offset must be a positive value');
    }
    
    // Handle limit price - can be static or offset
    if (limitPrice && parseFloat(limitPrice) > 0) {
      // User specified a static limit price
      limitPriceValue = parseFloat(limitPrice);
      limitPriceTypeValue = 'static';
    } else if (orderConfig.limitPriceOffset !== undefined) {
      // User specified an offset from trigger
      limitPriceValue = parseFloat(orderConfig.limitPriceOffset) || 0;
      limitPriceTypeValue = orderConfig.limitPriceOffsetType || 'quote';
    }
    
    const params = {
      order_type: 'trailing-stop-limit',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      limit_price: limitPriceValue,
      limit_price_type: limitPriceTypeValue,
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: triggerReference,
        price: trailPrice,
        price_type: trailPriceType
      }
    };
    console.log('[buildOrderParams] Trailing-stop-limit params:', JSON.stringify(params));
    console.log('[buildOrderParams] Trail offset:', trailPrice, trailPriceType === 'pct' ? '%' : 'USD');
    console.log('[buildOrderParams] Limit price:', limitPriceValue, limitPriceTypeValue);
    return params;
  }

  // CRITICAL: For iceberg orders
  if (orderType === 'iceberg') {
    if (!limitPrice || parseFloat(limitPrice) <= 0) {
      throw new Error('Iceberg orders require a valid limitPrice');
    }
    if (!displayQty || parseFloat(displayQty) <= 0) {
      throw new Error('Iceberg orders require a valid displayQty');
    }
    const params = {
      order_type: 'iceberg',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      limit_price: parseFloat(limitPrice),
      display_qty: parseFloat(displayQty),
      time_in_force: timeInForce,
      order_userref: userref
    };
    console.log('[buildOrderParams] Iceberg order params:', JSON.stringify(params));
    return params;
  }

  // Fallback for unknown order types - use market
  console.warn('[buildOrderParams] Unknown order type:', orderType, '- falling back to market');
  return {
    order_type: 'market',
    side: side.toLowerCase(),
    order_qty: parsedQty,
    symbol: formattedSymbol,
    order_userref: userref
  };
}

/**
 * Execute BRACKET ORDERS sequentially via separate WebSocket connections
 * Places TP and SL orders with dedicated connections to ensure both complete
 */
function executeBracketOrders(token, tpParams, slParams, delayMs = 4000) {
  return new Promise(async (resolve) => {
    const results = { tp: null, sl: null };

    console.log('[krakenTrade] === BRACKET ORDER EXECUTION ===');
    console.log('[krakenTrade] Symbol:', tpParams.symbol);
    console.log('[krakenTrade] Delaying SL by', delayMs, 'ms');

    // Execute TP order first
    try {
      console.log('[krakenTrade] 📤 Sending TP order...');
      results.tp = await executeKrakenTrade(token, tpParams);
      console.log('[krakenTrade] ✅ TP order result:', JSON.stringify(results.tp));
    } catch (error) {
      console.error('[krakenTrade] ❌ TP order failed:', error.message);
      results.tp = { success: false, error: error.message };
    }

    // Wait before sending SL order
    await new Promise(res => setTimeout(res, delayMs));

    // Execute SL order
    try {
      console.log('[krakenTrade] 📤 Sending SL order...');
      results.sl = await executeKrakenTrade(token, slParams);
      console.log('[krakenTrade] ✅ SL order result:', JSON.stringify(results.sl));
    } catch (error) {
      console.error('[krakenTrade] ❌ SL order failed:', error.message);
      results.sl = { success: false, error: error.message };
    }

    resolve(results);
  });
}

/**
 * Execute single trade via Kraken WebSocket v2
 * Used for market orders, not bracket orders
 */
function executeKrakenTrade(token, orderParams) {
  return new Promise((resolve, reject) => {
    let ws;
    let isResolved = false;
    
    const uniqueReqId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const uniqueUserRef = parseInt(`${Math.floor(Math.random() * 100000)}${Date.now() % 10000}`.slice(0, 9));
    
    console.log('[krakenTrade] === SINGLE ORDER ===');
    console.log('[krakenTrade] Type:', orderParams.order_type, 'Symbol:', orderParams.symbol);
    
    // Longer timeout for occasional auth latency
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        if (ws) { try { ws.close(); } catch (e) {} }
        reject(new Error('Trade execution timeout'));
      }
    }, 45000);
    
    try {
      ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        console.log('[krakenTrade] ✅ Connected - sending order');
        const message = {
          method: 'add_order',
          params: { token, ...orderParams, order_userref: uniqueUserRef },
          req_id: uniqueReqId
        };
        const jitter = 150 + Math.floor(Math.random() * 250); // 150-400ms
        setTimeout(() => {
          console.log('[krakenTrade] 📤 Sending (delayed', jitter, 'ms):', JSON.stringify(message));
          ws.send(JSON.stringify(message));
        }, jitter);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[krakenTrade] 📥 Received:', JSON.stringify(data));
          
          if (data.method === 'add_order') {
            clearTimeout(timeout);
            if (data.success === true) {
              console.log('[krakenTrade] ✅ SUCCESS:', data.result?.order_id);
              if (!isResolved) {
                isResolved = true;
                try { ws.close(1000); } catch (e) {}
                resolve({
                  success: true,
                  order_id: data.result?.order_id,
                  order_userref: data.result?.order_userref
                });
              }
            } else {
              console.error('[krakenTrade] ❌ FAILED:', data.error);
              if (!isResolved) {
                isResolved = true;
                try { ws.close(1000); } catch (e) {}
                reject(new Error(data.error || 'Order failed'));
              }
            }
          }
        } catch (e) {
          console.error('[krakenTrade] Parse error:', e);
        }
      };
      
      ws.onerror = (error) => {
        console.error('[krakenTrade] ERROR:', error?.message);
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket error: ' + (error?.message || 'unknown')));
        }
      };
      
      ws.onclose = (event) => {
        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          reject(new Error(`WebSocket closed (code: ${event?.code})`));
        }
      };
      
    } catch (error) {
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    }
  });
}

// Retry wrapper to mitigate rate limits and transient WS errors
async function executeKrakenTradeWithRetry(token, orderParams, maxAttempts = 5) {
  let attempt = 0;
  let lastErr;
  while (attempt < maxAttempts) {
    try {
      return await executeKrakenTrade(token, orderParams);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      // CRITICAL: Don't retry permission issues or insufficient funds - these won't resolve with retries
      if (/permission denied/i.test(msg)) { throw e; }
      if (/insufficient funds/i.test(msg) || /EOrder:Insufficient funds/i.test(msg)) {
        console.error('[krakenTrade] Insufficient funds - not retrying');
        throw e;
      }
      if (/insufficient margin/i.test(msg) || /EOrder:Insufficient margin/i.test(msg)) {
        console.error('[krakenTrade] Insufficient margin - not retrying');
        throw e;
      }
      // Don't retry order-specific errors that won't resolve
      if (/invalid volume/i.test(msg) || /EOrder:Invalid volume/i.test(msg)) { throw e; }
      if (/unknown order/i.test(msg) || /EOrder:Unknown order/i.test(msg)) { throw e; }
      if (/invalid price/i.test(msg) || /EOrder:Invalid price/i.test(msg)) { throw e; }
      
      const shouldRetry = /rate limit|EAPI:Rate limit|timeout|WebSocket closed|WebSocket error/i.test(msg);
      if (!shouldRetry) { throw e; }
      const delay = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
      console.warn(`[krakenTrade] Retry ${attempt + 1}/${maxAttempts} after ${delay}ms due to: ${msg}`);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
  throw lastErr;
}

/**
  * Cancel order via Kraken WebSocket v2
 */
function cancelKrakenOrder(token, orderIds) {
  return new Promise((resolve, reject) => {
    let ws;
    let isResolved = false;
    
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        if (ws) {
          try { ws.close(); } catch (e) { console.log(e); }
        }
        reject(new Error('Cancel order timeout'));
      }
    }, 10000);
    
    try {
      ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        console.log('[krakenTrade] WebSocket connected for cancel');
        
        const message = {
          method: 'cancel_order',
          params: {
            token,
            order_id: Array.isArray(orderIds) ? orderIds : [orderIds]
          },
          req_id: Date.now()
        };
        
        console.log('[krakenTrade] Sending cancel:', JSON.stringify(message));
        ws.send(JSON.stringify(message));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[krakenTrade] Cancel response:', JSON.stringify(data));
          
          if (data.method === 'cancel_order' && data.success) {
            clearTimeout(timeout);
            if (!isResolved) {
              isResolved = true;
              ws.close();
              resolve({
                success: true,
                order_ids: data.result?.order_ids || [],
                result: data.result
              });
            }
          }
          
          if (data.error) {
            clearTimeout(timeout);
            if (!isResolved) {
              isResolved = true;
              ws.close();
              reject(new Error(data.error || 'Cancel failed'));
            }
          }
        } catch (parseError) {
          console.error('[krakenTrade] Parse error:', parseError);
        }
      };
      
      ws.onerror = (error) => {
        console.error('[krakenTrade] Cancel WebSocket error:', error?.message || error);
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket connection error for cancel: ' + (error?.message || 'unknown')));
        }
      };
      
      ws.onclose = (event) => {
        console.log('[krakenTrade] Cancel WebSocket closed. Code:', event?.code);
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`WebSocket closed unexpectedly for cancel (code: ${event?.code})`));
        }
      };
      
    } catch (error) {
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    }
  });
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth
    const user = await Promise.race([
      base44.auth.me(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 2000))
    ]);

    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    // CRITICAL: Only privileged users can execute real trades
    const role = (user?.role || '').toLowerCase();
    const isAdmin = role === 'admin';
    const isOwner = role === 'owner';
    const isCreator = !!user?.is_creator;
    
    if (!isAdmin && !isOwner && !isCreator) {
      return Response.json({ 
        error: 'Access denied - live trading requires admin/owner privileges', 
        success: false 
      }, { status: 403 });
    }

    // Parse request body
    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      return Response.json({ error: 'Invalid JSON', success: false }, { status: 400 });
    }

    const { action = 'place_order' } = body;

    console.log('[krakenTrade] Action:', action, 'User:', user.email);

    // Get Kraken connection
    // Secrets-based credentials; presence validated when requesting WS token
    const tradeKey = Deno.env.get('Trade_Key');
    const tradeSecret = Deno.env.get('Trade_Secret');
    if (!tradeKey || !tradeSecret) {
      return Response.json({ error: 'Missing Trade_Key/Trade_Secret in application secrets', success: false }, { status: 200 });
    }
    // Proceed without connection entity; krakenApi will verify permissions

    // Get WebSocket token (allow caller to pass one to avoid extra GetWebSocketsToken calls)
    // CRITICAL: forceRefresh=false to use cached token and prevent rate limit spam
    let wsToken = body?.wsToken || body?.token;
    let tokenData;
    if (!wsToken) {
      console.log('[krakenTrade] Getting WebSocket token (using cache if available)...');
      // Rate-limit token and order placement calls per user to avoid EAPI:Rate limit exceeded
      await tradeRateGate(user.email, 1); // Reduced cost since we're using cache
      const tokenResponse = await Promise.race([
        base44.asServiceRole.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade', forceRefresh: false } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
      ]);
      tokenData = tokenResponse?.data || tokenResponse;
      wsToken = tokenData?.token;
      // Guard: token must come from TRADE key
      if (tokenData?.used_key_type && tokenData.used_key_type !== 'trade') {
        throw new Error('Invalid token source: expected TRADE key');
      }
    }

    if (!wsToken) {
      const detail = (tokenData && (tokenData.error || tokenData.used_key_type)) ? (`Failed to get WebSocket token (${tokenData.used_key_type || 'unknown'} key)`) : 'Failed to get WebSocket token';
      throw new Error(detail);
    }

    console.log('[krakenTrade] ✅ Got WebSocket token');

    // ============================================
    // ACTION: PLACE BUY WITH TP/SL (Complete trading setup)
    // Matches Kraken Pro order form behavior
    // ============================================
    if (action === 'place_buy_with_tpsl') {
      const { 
        symbol, 
        quantity, 
        entryPrice,           // Limit price for entry (null for market)
        takeProfitPrice,      // Absolute price or null
        stopLossPrice,        // Absolute price or null
        takeProfitPercent,    // Percentage from entry (e.g., 3 for +3%)
        stopLossPercent,      // Percentage from entry (e.g., 1 for -1%)
        useMarketEntry = false // Use market order for immediate execution
      } = body;

      if (!symbol || !quantity) {
        return Response.json({ 
          error: 'Missing required fields: symbol, quantity', 
          success: false 
        }, { status: 400 });
      }

      const parsedQty = parseFloat(quantity);
      const formattedSymbol = formatKrakenSymbol(symbol);

      console.log('[krakenTrade] === BUY WITH TP/SL ===');
      console.log('[krakenTrade] Symbol:', formattedSymbol, 'Qty:', parsedQty);
      console.log('[krakenTrade] Entry:', entryPrice || 'MARKET', 'TP:', takeProfitPrice || `+${takeProfitPercent}%`, 'SL:', stopLossPrice || `-${stopLossPercent}%`);

      // Kraken minimums for potential future SELL orders (TP/SL)
      const minOrderSizes = {
        'BTC': 0.00005, 'XBT': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4, 'DOT': 0.5, 'DOGE': 13.0, 'XDG': 13.0,
        'LINK': 0.2, 'UNI': 0.5, 'MATIC': 10.0, 'POL': 10.0, 'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0,
        'SHIB': 100000.0, 'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.7, 'NEAR': 0.7, 'APT': 2.2, 'ARB': 5.2, 'OP': 16.0, 'INJ': 0.9,
        'PEPE': 500000.0, 'SUI': 3.0
      };
      const sellMinQty = minOrderSizes[symbol.toUpperCase()] || 0.00001;
      const canPlaceSellOrders = parsedQty >= sellMinQty;

      // Step 1: Place the BUY order (market or limit)
      let buyParams;
      if (useMarketEntry || !entryPrice) {
        buyParams = {
          order_type: 'market',
          side: 'buy',
          order_qty: parsedQty,
          symbol: formattedSymbol
        };
      } else {
        buyParams = {
          order_type: 'limit',
          side: 'buy',
          order_qty: parsedQty,
          symbol: formattedSymbol,
          limit_price: parseFloat(entryPrice),
          time_in_force: 'gtc'
        };
      }

      console.log('[krakenTrade] 📤 Placing BUY order...');
      await tradeRateGate(user.email, 2);
      let buyResult;
      try {
        buyResult = await withOrderLock(user.email, () => executeKrakenTradeWithRetry(wsToken, buyParams));
        console.log('[krakenTrade] ✅ BUY executed:', buyResult.order_id);
      } catch (buyError) {
        console.error('[krakenTrade] ❌ BUY failed:', buyError.message);
        const isPerm = /permission denied/i.test(buyError.message || '');
        // If permission error, force refresh WS token from trade key and retry once
        if (isPerm) {
          try {
            console.warn('[krakenTrade] Forcing WS token refresh and retrying BUY once...');
            const refresh = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade', forceRefresh: true } });
            const freshToken = refresh?.data?.token || refresh?.token;
            if (freshToken) {
              buyResult = await executeKrakenTradeWithRetry(freshToken, buyParams);
              console.log('[krakenTrade] ✅ BUY executed after token refresh:', buyResult.order_id);
            } else {
              throw new Error('WS token refresh returned no token');
            }
          } catch (retryErr) {
            return Response.json({
              success: false,
              error: `Buy order failed: ${retryErr?.message || buyError.message}`,
              permission_hint: 'Ensure the Trade key has: Access WebSockets API, Create & Modify Orders, Query Open/Closed Orders.',
              duration_ms: Date.now() - startTime
            }, { status: 200 });
          }
        } else {
          return Response.json({
            success: false,
            error: `Buy order failed: ${buyError.message}`,
            duration_ms: Date.now() - startTime
          }, { status: 200 });
        }
      }

      // Step 2: Calculate TP and SL prices if percentages given
      let finalTpPrice = takeProfitPrice;
      let finalSlPrice = stopLossPrice;
      
      if (!finalTpPrice && takeProfitPercent && entryPrice) {
        finalTpPrice = parseFloat(entryPrice) * (1 + takeProfitPercent / 100);
      }
      if (!finalSlPrice && stopLossPercent && entryPrice) {
        finalSlPrice = parseFloat(entryPrice) * (1 - stopLossPercent / 100);
      }

      // Step 3: Place TP and SL orders if specified
      let tpResult = null;
      let slResult = null;

      if (finalTpPrice && canPlaceSellOrders) {
        // CRITICAL: Round TP price to Kraken's required decimal precision
        const roundedTpPrice = roundPriceForKraken(parseFloat(finalTpPrice), formattedSymbol);
        console.log('[krakenTrade] TP price rounded:', finalTpPrice, '->', roundedTpPrice);
        
        const tpParams = {
          order_type: 'take-profit',
          side: 'sell',
          order_qty: finalQty,
          symbol: formattedSymbol,
          time_in_force: 'gtc',
          triggers: {
            reference: 'last',
            price: roundedTpPrice,
            price_type: 'static'
          }
        };

        try {
          console.log('[krakenTrade] 📤 Placing TP order at', roundedTpPrice);
          await tradeRateGate(user.email, 2);
          tpResult = await withOrderLock(user.email, () => executeKrakenTradeWithRetry(wsToken, tpParams));
          console.log('[krakenTrade] ✅ TP placed:', tpResult.order_id);
        } catch (tpError) {
          console.error('[krakenTrade] ❌ TP failed:', tpError.message);
          tpResult = { success: false, error: tpError.message };
        }
      }

      // Small delay between orders
      await new Promise(res => setTimeout(res, 2000));

      if (finalSlPrice && canPlaceSellOrders) {
        // CRITICAL: Round SL price to Kraken's required decimal precision
        const roundedSlPrice = roundPriceForKraken(parseFloat(finalSlPrice), formattedSymbol);
        console.log('[krakenTrade] SL price rounded:', finalSlPrice, '->', roundedSlPrice);
        
        const slParams = {
          order_type: 'stop-loss',
          side: 'sell',
          order_qty: parsedQty,
          symbol: formattedSymbol,
          time_in_force: 'gtc',
          triggers: {
            reference: 'last',
            price: roundedSlPrice,
            price_type: 'static'
          }
        };

        try {
          console.log('[krakenTrade] 📤 Placing SL order at', roundedSlPrice);
          await tradeRateGate(user.email, 2);
          slResult = await withOrderLock(user.email, () => executeKrakenTradeWithRetry(wsToken, slParams));
          console.log('[krakenTrade] ✅ SL placed:', slResult.order_id);
        } catch (slError) {
          console.error('[krakenTrade] ❌ SL failed:', slError.message);
          slResult = { success: false, error: slError.message };
        }
      }

      // Log the complete trade setup
      await base44.asServiceRole.entities.KrakenLog.create({
        event_type: 'create_order',
        status: 'success',
        message: `BUY ${quantity} ${symbol} with TP/SL`,
        details_json: JSON.stringify({
          buy_order_id: buyResult.order_id,
          tp_order_id: tpResult?.order_id,
          sl_order_id: slResult?.order_id,
          entry_price: entryPrice,
          tp_price: finalTpPrice,
          sl_price: finalSlPrice
        }),
        created_by: user.email
      });

      return Response.json({
        success: true,
        buy_order_id: buyResult.order_id,
        tp_order_id: tpResult?.order_id || null,
        sl_order_id: slResult?.order_id || null,
        tp_success: tpResult?.success !== false,
        sl_success: slResult?.success !== false,
        entry_price: entryPrice,
        tp_price: finalTpPrice,
        sl_price: finalSlPrice,
        duration_ms: Date.now() - startTime
      }, { status: 200 });
    }

    // ============================================
    // ACTION: PLACE TRAILING STOP (for auto-trader)
    // Supports both percentage and quote offset modes
    // ============================================
    if (action === 'place_trailing_stop') {
      const { 
        symbol, 
        quantity, 
        trailingPercent,      // e.g., 3 for 3% trailing
        trailingAmount,       // e.g., 500 for $500 trailing
        trailingPriceType = 'pct', // 'pct' or 'quote'
        triggerReference = 'last', // 'last' or 'index'
        useLimit = false,     // Use trailing-stop-limit instead of trailing-stop
        limitPriceOffset = 0, // Offset from trigger for limit orders
        limitPriceOffsetType = 'quote'
      } = body;

      if (!symbol || !quantity) {
        return Response.json({ 
          error: 'Missing required fields: symbol, quantity', 
          success: false 
        }, { status: 400 });
      }

      // Validate trailing offset is provided
      const hasTrailingOffset = (trailingPercent && parseFloat(trailingPercent) > 0) || 
                                (trailingAmount && parseFloat(trailingAmount) > 0);
      if (!hasTrailingOffset) {
        return Response.json({ 
          error: 'Missing trailing offset: provide trailingPercent or trailingAmount', 
          success: false 
        }, { status: 400 });
      }

      const parsedQty = parseFloat(quantity);
      const formattedSymbol = formatKrakenSymbol(symbol);

      console.log('[krakenTrade] === TRAILING STOP ORDER ===');
      console.log('[krakenTrade] Symbol:', formattedSymbol, 'Qty:', parsedQty);
      console.log('[krakenTrade] Trailing:', trailingPriceType === 'pct' ? `${trailingPercent}%` : `$${trailingAmount}`);
      console.log('[krakenTrade] Use limit:', useLimit, 'Reference:', triggerReference);

      // Enforce Kraken minimums and available holdings for SELL side
      const minOrderSizes = {
        'BTC': 0.00005, 'XBT': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4, 'DOT': 0.5, 'DOGE': 13.0, 'XDG': 13.0,
        'LINK': 0.2, 'UNI': 0.5, 'MATIC': 10.0, 'POL': 10.0, 'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0,
        'SHIB': 100000.0, 'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.7, 'NEAR': 0.7, 'APT': 2.2, 'ARB': 5.2, 'OP': 16.0, 'INJ': 0.9,
        'PEPE': 500000.0, 'SUI': 3.0
      };
      const minQty = minOrderSizes[symbol.toUpperCase()] || 0.00001;
      let finalQty = parsedQty;
      const availMap = await getAvailableMap(base44);
      const available = availMap[symbol.toUpperCase()] || 0;
      finalQty = Math.min(parsedQty, available);
      if (finalQty < minQty) {
        return Response.json({ success: false, error: `Insufficient available ${symbol} (${available.toFixed(8)}). Kraken minimum sell is ${minQty}.` }, { status: 200 });
      }

      // Determine trailing offset value
      let trailPrice, trailPriceType;
      if (trailingPriceType === 'quote' && trailingAmount) {
        trailPrice = parseFloat(trailingAmount);
        trailPriceType = 'quote';
      } else {
        trailPrice = parseFloat(trailingPercent) || 5;
        trailPriceType = 'pct';
      }

      // Build order params
      const orderParams = {
        order_type: useLimit ? 'trailing-stop-limit' : 'trailing-stop',
        side: 'sell',
        order_qty: parsedQty,
        symbol: formattedSymbol,
        time_in_force: 'gtc',
        triggers: {
          reference: triggerReference,
          price: trailPrice,
          price_type: trailPriceType
        }
      };

      // Add limit price config for trailing-stop-limit
      if (useLimit) {
        orderParams.limit_price = parseFloat(limitPriceOffset) || 0;
        orderParams.limit_price_type = limitPriceOffsetType;
      }

      console.log('[krakenTrade] 📤 Placing trailing stop order:', JSON.stringify(orderParams));

      try {
        await tradeRateGate(user.email, 2);
        const result = await executeKrakenTrade(wsToken, orderParams);
        console.log('[krakenTrade] ✅ Trailing stop placed:', result.order_id);

        // Log the order
        await base44.asServiceRole.entities.KrakenLog.create({
          event_type: 'create_order',
          status: 'success',
          message: `Trailing ${useLimit ? 'stop-limit' : 'stop'} ${trailPrice}${trailPriceType === 'pct' ? '%' : ' USD'} for ${quantity} ${symbol}`,
          details_json: JSON.stringify({
            order_id: result.order_id,
            symbol,
            quantity,
            trailing_price: trailPrice,
            trailing_type: trailPriceType,
            use_limit: useLimit,
            trigger_reference: triggerReference
          }),
          created_by: user.email
        });

        return Response.json({
          success: true,
          order_id: result.order_id,
          order_type: useLimit ? 'trailing-stop-limit' : 'trailing-stop',
          trailing_price: trailPrice,
          trailing_type: trailPriceType,
          trigger_reference: triggerReference,
          duration_ms: Date.now() - startTime
        }, { status: 200 });

      } catch (error) {
        console.error('[krakenTrade] ❌ Trailing stop failed:', error.message);
        return Response.json({
          success: false,
          error: `Trailing stop order failed: ${error.message}`,
          duration_ms: Date.now() - startTime
        }, { status: 200 });
      }
    }

    // ============================================
    // ACTION: PLACE BRACKET ORDERS (TP + SL via single connection)
    // ============================================
    if (action === 'place_bracket_orders') {
      const { symbol, quantity, takeProfitPrice, stopLossPrice } = body;

      if (!symbol || !quantity || !takeProfitPrice || !stopLossPrice) {
        return Response.json({ 
          error: 'Missing required fields: symbol, quantity, takeProfitPrice, stopLossPrice', 
          success: false 
        }, { status: 400 });
      }

      const parsedQty = parseFloat(quantity);
      const formattedSymbol = formatKrakenSymbol(symbol);

      console.log('[krakenTrade] === BRACKET ORDERS ===');
      console.log('[krakenTrade] Symbol:', formattedSymbol, 'Qty:', parsedQty);
      console.log('[krakenTrade] TP:', takeProfitPrice, 'SL:', stopLossPrice);

      // Enforce Kraken minimums and available holdings for SELL side
      const minOrderSizes = {
        'BTC': 0.00005, 'XBT': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4, 'DOT': 0.5, 'DOGE': 13.0, 'XDG': 13.0,
        'LINK': 0.2, 'UNI': 0.5, 'MATIC': 10.0, 'POL': 10.0, 'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0,
        'SHIB': 100000.0, 'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.7, 'NEAR': 0.7, 'APT': 2.2, 'ARB': 5.2, 'OP': 16.0, 'INJ': 0.9,
        'PEPE': 500000.0, 'SUI': 3.0
      };
      const minQty = minOrderSizes[symbol.toUpperCase()] || 0.00001;
      const availMap = await getAvailableMap(base44);
      const available = availMap[symbol.toUpperCase()] || 0;
      const finalQty = Math.min(parsedQty, available);
      if (finalQty < minQty) {
        return Response.json({ success: false, error: `Insufficient available ${symbol} (${available.toFixed(8)}). Kraken minimum sell is ${minQty}.` }, { status: 200 });
      }

      // CRITICAL: Round prices to Kraken's required decimal precision
      const roundedTpPrice = roundPriceForKraken(parseFloat(takeProfitPrice), formattedSymbol);
      const roundedSlPrice = roundPriceForKraken(parseFloat(stopLossPrice), formattedSymbol);
      
      console.log('[krakenTrade] Rounded TP:', takeProfitPrice, '->', roundedTpPrice);
      console.log('[krakenTrade] Rounded SL:', stopLossPrice, '->', roundedSlPrice);

      // Ensure small pacing gap between the two bracket legs to avoid 429/invalid nonce corner cases
      await new Promise(res => setTimeout(res, 500));

      // Build TP order params
      const tpParams = {
        order_type: 'take-profit',
        side: 'sell',
        order_qty: parsedQty,
        symbol: formattedSymbol,
        time_in_force: 'gtc',
        triggers: {
          reference: 'last',
          price: roundedTpPrice,
          price_type: 'static'
        }
      };

      // Build SL order params
      const slParams = {
        order_type: 'stop-loss',
        side: 'sell',
        order_qty: parsedQty,
        symbol: formattedSymbol,
        time_in_force: 'gtc',
        triggers: {
          reference: 'last',
          price: roundedSlPrice,
          price_type: 'static'
        }
      };

      // Execute both orders over single WebSocket connection
      await tradeRateGate(user.email, 2);
      const bracketResult = await withOrderLock(user.email, () => executeBracketOrders(wsToken, tpParams, slParams, 4000));

      console.log('[krakenTrade] Bracket result:', JSON.stringify(bracketResult));

      const tpSuccess = bracketResult.tp?.success === true;
      const slSuccess = bracketResult.sl?.success === true;
      const orderIds = [bracketResult.tp?.order_id, bracketResult.sl?.order_id].filter(Boolean);

      // Log result
      await base44.asServiceRole.entities.KrakenLog.create({
        event_type: 'create_order',
        status: (tpSuccess && slSuccess) ? 'success' : 'partial',
        message: `Bracket orders: TP=${tpSuccess ? 'OK' : 'FAIL'}, SL=${slSuccess ? 'OK' : 'FAIL'}`,
        details_json: JSON.stringify({ symbol, quantity, takeProfitPrice, stopLossPrice, bracketResult }),
        created_by: user.email
      });

      return Response.json({
        success: tpSuccess || slSuccess,
        tp_success: tpSuccess,
        sl_success: slSuccess,
        tp_order_id: bracketResult.tp?.order_id || null,
        sl_order_id: bracketResult.sl?.order_id || null,
        tp_error: bracketResult.tp?.error || null,
        sl_error: bracketResult.sl?.error || null,
        order_ids: orderIds.join(','),
        duration_ms: Date.now() - startTime
      }, { status: 200 });
    }

    // ============================================
    // ACTION: PLACE ORDER (single order)
    // ============================================
    if (action === 'place_order') {
      const { 
        symbol, 
        side, 
        quantity, 
        orderType = 'market',
        limitPrice,
        stopPrice,
        triggerPrice,
        trailingAmount,
        trailingPercent,
        trailingPriceType,    // 'pct' or 'quote'
        limitPriceOffset,      // Offset from trigger for trailing-stop-limit
        limitPriceOffsetType,  // 'pct' or 'quote'
        triggerReference,      // 'last' or 'index'
        timeInForce,
        postOnly,
        reduceOnly,
        displayQty,
        conditionalCloseOrder
      } = body;

      // Validate required fields
      if (!symbol || !side || !quantity) {
        return Response.json({ 
          error: 'Missing required fields: symbol, side, quantity', 
          success: false 
        }, { status: 400 });
      }

      // CRITICAL: Validate quantity is positive and valid
      const parsedQty = parseFloat(quantity);
      if (isNaN(parsedQty) || parsedQty <= 0 || !isFinite(parsedQty)) {
        return Response.json({
          error: `Invalid quantity: ${quantity}`,
          success: false
        }, { status: 400 });
      }

      // CRITICAL: Minimum order validation (Kraken minimums - updated Dec 2024)
      // Source: https://support.kraken.com/articles/205893708-minimum-order-size-volume-for-trading
      const minOrderSizes = {
        'BTC': 0.00005,    // Updated Dec 2024
        'XBT': 0.00005,
        'ETH': 0.001,      // Updated Dec 2024
        'SOL': 0.02,       // Updated Dec 2024: mSOL is 0.017
        'XRP': 10.0,
        'ADA': 4.4,        // Updated Dec 2024
        'DOT': 0.5,
        'DOGE': 13.0,      // Updated Dec 2024
        'XDG': 13.0,       // Kraken alias for DOGE
        'LINK': 0.2,       // Updated Dec 2024
        'UNI': 0.5,
        'MATIC': 10.0,
        'POL': 10.0,
        'ATOM': 0.5,
        'AVAX': 0.1,
        'BCH': 0.01,       // Updated Dec 2024
        'LTC': 0.04,
        'TRX': 50.0,
        'SHIB': 100000.0,
        'XLM': 20.0,       // Verified Dec 2024 - NOT in list, check Stellar docs
        'ALGO': 10.0,
        'FIL': 0.7,        // Updated Dec 2024
        'NEAR': 0.7,       // Updated Dec 2024
        'APT': 2.2,        // Updated Dec 2024
        'ARB': 5.2,        // Updated Dec 2024
        'OP': 16.0,        // Updated Dec 2024
        'INJ': 0.9,        // Updated Dec 2024
        'PEPE': 500000.0,
        'SUI': 3.0,
        'BABY': 50.0,      // Updated Dec 2024
        'FLOKI': 105000.0, // Updated Dec 2024
        'WIF': 14.0,       // Updated Dec 2024
        'BONK': 500000.0,  // Updated Dec 2024
        'RENDER': 0.5,
        'FET': 18.0,       // Updated Dec 2024
        'RNDR': 0.5,
        'GRT': 10.0,
        'IMX': 16.0,       // Updated Dec 2024
        'SAND': 5.0,
        'MANA': 8.0,       // Updated Dec 2024
        'AXS': 4.5,        // Updated Dec 2024
        'ENS': 0.12,       // Updated Dec 2024
        'LDO': 2.8,        // Updated Dec 2024
        'RPL': 0.1,
        'CRV': 4.5,        // Updated Dec 2024
        'AAVE': 0.015,     // Updated Dec 2024
        'MKR': 0.0035,     // Updated Dec 2024
        'SNX': 2.0,
        'COMP': 0.06,      // Updated Dec 2024
        'YFI': 0.0002,
        'SUSHI': 5.0,
        '1INCH': 11.0,     // Updated Dec 2024
        'BAL': 1.5,        // Updated Dec 2024
        'ZRX': 9.0,        // Updated Dec 2024
        'ENJ': 148.0,      // Updated Dec 2024
        'CHZ': 50.0,
        'GALA': 650.0,     // Updated Dec 2024
        'APE': 18.0,       // Updated Dec 2024
        'BLUR': 129.0,     // Updated Dec 2024
        'SEI': 5.0,
        'TIA': 8.2,        // Updated Dec 2024
        'JUP': 20.0,       // Updated Dec 2024
        'PYTH': 10.0,
        'WLD': 1.0,
        'STRK': 2.0,
        'HBAR': 20.0,      // Added
        'KAS': 30.0,       // Added
        'TAO': 0.008,      // Added
        'EIGEN': 8.6,      // Added
        'ENA': 4.0,        // Added
        'GRASS': 13.0,     // Added
        'GOAT': 5.0,       // Added
        'TRUMP': 0.2,      // Added
        'FARTCOIN': 5.0,   // Added
        'MOVE': 6.0,       // Added
        'KAITO': 2.5       // Added
      };

      const minQty = minOrderSizes[symbol.toUpperCase()] || 0.00001;
      let finalQty = parsedQty;
      let qtyAdjusted = false;
      if (parsedQty < minQty) {
        finalQty = minQty;
        qtyAdjusted = true;
        console.warn('[krakenTrade] Quantity below minimum. Auto-adjusting', parsedQty, '->', finalQty);
      }

      console.log('[krakenTrade] Place order:', { symbol, side, quantity, orderType });

      // Build order parameters
      const orderParams = buildOrderParams({
        orderType,
        side,
        quantity: finalQty,
        symbol,
        limitPrice,
        stopPrice,
        triggerPrice,
        trailingAmount,
        trailingPercent,
        trailingPriceType,
        limitPriceOffset,
        limitPriceOffsetType,
        triggerReference,
        timeInForce,
        postOnly,
        reduceOnly,
        displayQty,
        conditionalCloseOrder
      });

      console.log('[krakenTrade] Order params:', JSON.stringify(orderParams, null, 2));

      // Execute trade via WebSocket
      // Gentle pacing to avoid rate-limit burst when placing sequential orders
      await new Promise(res => setTimeout(res, 350));
      let tradeResult;
      try {
        await tradeRateGate(user.email, 2);
        tradeResult = await withOrderLock(user.email, () => executeKrakenTradeWithRetry(wsToken, orderParams));
      } catch (firstErr) {
        if (/permission denied/i.test(firstErr?.message || '')) {
          console.warn('[krakenTrade] Forcing WS token refresh and retrying single order...');
          const refresh = await base44.asServiceRole.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade', forceRefresh: true } });
          const freshToken = refresh?.data?.token || refresh?.token;
          tradeResult = await executeKrakenTradeWithRetry(freshToken || wsToken, orderParams);
        } else {
          throw firstErr;
        }
      }

      console.log('[krakenTrade] ✅ Trade executed:', tradeResult);

      // Log successful trade
      await base44.asServiceRole.entities.KrakenLog.create({
        event_type: 'create_order',
        status: 'success',
        message: `${side} ${finalQty} ${symbol} ${orderType} order executed`,
        details_json: JSON.stringify({ 
          order_id: tradeResult.order_id,
          symbol,
          side,
          quantity: finalQty,
          orderType,
          result: tradeResult.result,
          warnings: tradeResult.warnings
        }),
        created_by: user.email
      });

      // CRITICAL: Return the ACTUAL executed quantity from Kraken
      // For market orders, this is the quantity we submitted (finalQty)
      // For limit orders, execution happens later
      console.log(`[krakenTrade] Order placed - requested qty: ${finalQty}, order type: ${orderType}`);
      
      return Response.json({
        success: true,
        order_id: tradeResult.order_id,
        order_userref: tradeResult.order_userref,
        client_order_id: tradeResult.client_order_id,
        symbol: orderParams.symbol,
        side,
        quantity: finalQty,           // What we requested
        executed_qty: finalQty,       // For market orders, this is what we get
        orderType,
        // Echo back calculated notional so client can prefill totals accurately
        notional_usd: finalQty * (parseFloat(limitPrice) || 0),
        warnings: qtyAdjusted ? [
          ...(Array.isArray(tradeResult.warnings) ? tradeResult.warnings : []),
          `Adjusted to Kraken minimum for ${symbol}: ${minQty}`
        ] : tradeResult.warnings,
        time_in: tradeResult.time_in,
        time_out: tradeResult.time_out,
        duration_ms: Date.now() - startTime
      }, { status: 200 });
    }

    // ============================================
    // ACTION: CANCEL ORDER
    // ============================================
    if (action === 'cancel_order') {
      const { orderIds } = body;

      if (!orderIds || (Array.isArray(orderIds) && orderIds.length === 0)) {
        return Response.json({ 
          error: 'Missing orderIds', 
          success: false 
        }, { status: 400 });
      }

      console.log('[krakenTrade] Cancel orders:', orderIds);

      const cancelResult = await cancelKrakenOrder(wsToken, orderIds);

      console.log('[krakenTrade] ✅ Orders cancelled:', cancelResult);

      // Log cancellation
      await base44.asServiceRole.entities.KrakenLog.create({
        event_type: 'cancel_order',
        status: 'success',
        message: `Cancelled ${cancelResult.order_ids?.length || 0} orders`,
        details_json: JSON.stringify({ 
          order_ids: cancelResult.order_ids,
          result: cancelResult.result
        }),
        created_by: user.email
      });

      return Response.json({
        success: true,
        order_ids: cancelResult.order_ids,
        cancelled_count: cancelResult.order_ids?.length || 0,
        duration_ms: Date.now() - startTime
      }, { status: 200 });
    }

    // Unknown action
    return Response.json({ 
      error: 'Unknown action. Use "place_order" or "cancel_order"', 
      success: false 
    }, { status: 400 });

  } catch (error) {
    console.error('[krakenTrade] ❌ Error:', error.message);
    
    // Log error
    try {
      const base44 = createClientFromRequest(req);
      const user = await base44.auth.me();
      
      if (user) {
        await base44.asServiceRole.entities.KrakenLog.create({
          event_type: body.action || 'unknown',
          status: 'error',
          message: 'Failed to execute action',
          details_json: JSON.stringify({ error: error.message, stack: error.stack }),
          created_by: user.email
        });
      }
    } catch (logError) {
      console.error('[krakenTrade] Logging error:', logError);
    }
    
    return Response.json({
      success: false,
      error: error.message || 'Failed to execute action',
      duration_ms: Date.now() - startTime
    }, { status: 200 });
  }
});