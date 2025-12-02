import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

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
const WS_TIMEOUT = 30000; // 30 second timeout for robustness

/**
 * Format symbol for Kraken (e.g., "BTC" -> "BTC/USD")
 * CRITICAL: Uses official Kraken trading pair format
 */
function formatKrakenSymbol(symbol) {
  // If already in pair format, return as-is
  if (symbol.includes('/')) {
    return symbol.toUpperCase();
  }
  
  // Map common symbols to Kraken pairs
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
    'POL': 'MATIC/USD', // New Polygon symbol
    'ATOM': 'ATOM/USD',
    'AVAX': 'AVAX/USD',
    'BCH': 'BCH/USD',
    'TRX': 'TRX/USD',
    'SHIB': 'SHIB/USD',
    'XLM': 'XLM/USD',
    'ALGO': 'ALGO/USD',
    'FIL': 'FIL/USD',
    'NEAR': 'NEAR/USD',
    'APT': 'APT/USD',
    'ARB': 'ARB/USD',
    'OP': 'OP/USD',
    'INJ': 'INJ/USD',
    'PEPE': 'PEPE/USD',
    'SUI': 'SUI/USD'
  };
  
  return symbolMap[symbol.toUpperCase()] || `${symbol.toUpperCase()}/USD`;
}

/**
 * Build order parameters based on order type
 * CRITICAL: Follows Kraken WebSocket v2 API spec exactly
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
    conditionalCloseOrder // For OTO (One-Triggers-Other)
  } = orderConfig;

  // FIXED: Generate valid 32-bit userref (Kraken requirement)
  // Use last 9 digits of timestamp (always < 2,147,483,647)
  const userref = parseInt(Date.now().toString().slice(-9));
  
  const formattedSymbol = formatKrakenSymbol(symbol);
  const parsedQty = parseFloat(quantity);

  console.log('[buildOrderParams] Input:', { orderType, side, quantity: parsedQty, symbol: formattedSymbol, stopPrice, limitPrice });

  // CRITICAL: For market orders, use simple params
  if (orderType === 'market') {
    const params = {
      order_type: 'market',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      time_in_force: timeInForce === 'gtc' ? 'ioc' : timeInForce, // Market orders should be IOC
      order_userref: userref
    };
    console.log('[buildOrderParams] Market order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For limit orders
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
    console.log('[buildOrderParams] Limit order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For stop-loss orders - Kraken requires triggers.price and triggers.price_type
  if (orderType === 'stop-loss') {
    if (!stopPrice || parseFloat(stopPrice) <= 0) {
      throw new Error('Stop-loss orders require a valid stopPrice');
    }
    const params = {
      order_type: 'stop-loss',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',
        price: parseFloat(stopPrice),
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
  if (orderType === 'take-profit') {
    const tpPrice = triggerPrice || stopPrice;
    if (!tpPrice || parseFloat(tpPrice) <= 0) {
      throw new Error('Take-profit orders require a valid triggerPrice');
    }
    const params = {
      order_type: 'take-profit',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',
        price: parseFloat(tpPrice),
        price_type: 'static'
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
  if (orderType === 'trailing-stop') {
    // Trailing stop uses percentage or quote offset from peak
    let trailPrice = 5.0; // Default 5% trailing
    let trailPriceType = 'pct';
    
    if (trailingPercent && parseFloat(trailingPercent) > 0) {
      trailPrice = parseFloat(trailingPercent);
      trailPriceType = 'pct';
    } else if (trailingAmount && parseFloat(trailingAmount) > 0) {
      trailPrice = parseFloat(trailingAmount);
      trailPriceType = 'quote';
    }
    
    const params = {
      order_type: 'trailing-stop',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',
        price: trailPrice,
        price_type: trailPriceType
      }
    };
    console.log('[buildOrderParams] Trailing-stop order params:', JSON.stringify(params));
    return params;
  }

  // CRITICAL: For trailing-stop-limit orders
  if (orderType === 'trailing-stop-limit') {
    if (!limitPrice || parseFloat(limitPrice) <= 0) {
      throw new Error('Trailing-stop-limit orders require a valid limitPrice');
    }
    
    let trailPrice = 5.0;
    let trailPriceType = 'pct';
    
    if (trailingPercent && parseFloat(trailingPercent) > 0) {
      trailPrice = parseFloat(trailingPercent);
      trailPriceType = 'pct';
    } else if (trailingAmount && parseFloat(trailingAmount) > 0) {
      trailPrice = parseFloat(trailingAmount);
      trailPriceType = 'quote';
    }
    
    const params = {
      order_type: 'trailing-stop-limit',
      side: side.toLowerCase(),
      order_qty: parsedQty,
      symbol: formattedSymbol,
      limit_price: parseFloat(limitPrice),
      time_in_force: timeInForce,
      order_userref: userref,
      triggers: {
        reference: 'last',
        price: trailPrice,
        price_type: trailPriceType
      }
    };
    console.log('[buildOrderParams] Trailing-stop-limit order params:', JSON.stringify(params));
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
    time_in_force: 'ioc',
    order_userref: userref
  };
}

/**
 * Execute trade via Kraken WebSocket v2
 */
function executeKrakenTrade(token, orderParams) {
  return new Promise((resolve, reject) => {
    let ws;
    let isResolved = false;
    
    // Timeout handler
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        if (ws) {
          try { ws.close(); } catch (e) { console.log(e); }
        }
        reject(new Error('Trade execution timeout'));
      }
    }, WS_TIMEOUT);
    
    try {
      ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        console.log('[krakenTrade] WebSocket connected');
        
        // Send add_order message
        const message = {
          method: 'add_order',
          params: {
            token,
            ...orderParams
          },
          req_id: Date.now()
        };
        
        console.log('[krakenTrade] Sending order:', JSON.stringify(message, null, 2));
        ws.send(JSON.stringify(message));
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[krakenTrade] Received:', JSON.stringify(data, null, 2));
          
          // Check for successful order - Kraken v2 response format
          if (data.method === 'add_order') {
            clearTimeout(timeout);
            
            if (data.success === true) {
              if (!isResolved) {
                isResolved = true;
                ws.close();
                resolve({
                  success: true,
                  order_id: data.result?.order_id,
                  order_userref: data.result?.order_userref,
                  client_order_id: data.result?.cl_ord_id,
                  warnings: data.warnings || [],
                  result: data.result,
                  time_in: data.time_in,
                  time_out: data.time_out
                });
              }
            } else {
              // success === false means error
              if (!isResolved) {
                isResolved = true;
                ws.close();
                reject(new Error(data.error || 'Order failed'));
              }
            }
            return;
          }
          
          // Check for error response (different format)
          if (data.error && !data.method) {
            clearTimeout(timeout);
            if (!isResolved) {
              isResolved = true;
              ws.close();
              reject(new Error(data.error || 'Order failed'));
            }
          }
        } catch (parseError) {
          console.error('[krakenTrade] Parse error:', parseError);
        }
      };
      
      ws.onerror = (error) => {
        console.error('[krakenTrade] WebSocket error:', error?.message || error);
        console.error('[krakenTrade] Order params were:', JSON.stringify(orderParams));
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket connection error: ' + (error?.message || 'unknown')));
        }
      };
      
      ws.onclose = (event) => {
        console.log('[krakenTrade] WebSocket closed. Code:', event?.code, 'Reason:', event?.reason);
        console.log('[krakenTrade] Order params were:', JSON.stringify(orderParams));
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`WebSocket closed unexpectedly (code: ${event?.code}, reason: ${event?.reason || 'none'})`));
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

    // CRITICAL: Only admin/creator can execute real trades
    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    
    if (!isAdmin && !isCreator) {
      return Response.json({ 
        error: 'Access denied - Real trading requires admin access', 
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
    const connections = await Promise.race([
      base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]);

    if (!connections || connections.length === 0) {
      return Response.json({
        error: 'Kraken account not connected',
        success: false
      }, { status: 200 });
    }

    // Get WebSocket token
    console.log('[krakenTrade] Getting WebSocket token...');
    const tokenResponse = await Promise.race([
      base44.asServiceRole.functions.invoke('krakenApi', { action: 'getWebSocketUrl' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]);

    const tokenData = tokenResponse?.data || tokenResponse;
    const wsToken = tokenData?.token;

    if (!wsToken) {
      throw new Error('Failed to get WebSocket token');
    }

    console.log('[krakenTrade] ✅ Got WebSocket token');

    // ============================================
    // ACTION: PLACE ORDER
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
      // Source: https://support.kraken.com/hc/en-us/articles/205893708-Minimum-order-size-volume-
      const minOrderSizes = {
        'BTC': 0.0001,
        'XBT': 0.0001,
        'ETH': 0.005,      // Updated: was 0.004
        'SOL': 0.1,        // Updated: was 0.05
        'XRP': 10.0,
        'ADA': 10.0,
        'DOT': 0.5,
        'DOGE': 50.0,
        'XDG': 50.0,       // Kraken alias for DOGE
        'LINK': 0.5,
        'UNI': 0.5,
        'MATIC': 10.0,
        'POL': 10.0,       // New Polygon symbol
        'ATOM': 0.5,
        'AVAX': 0.1,
        'BCH': 0.002,
        'LTC': 0.04,
        'TRX': 50.0,
        'SHIB': 100000.0,
        'XLM': 20.0,
        'ALGO': 10.0,
        'FIL': 0.2,
        'NEAR': 1.0,
        'APT': 0.5,
        'ARB': 5.0,
        'OP': 3.0,
        'INJ': 0.3,
        'PEPE': 500000.0,
        'SUI': 3.0,
        'BABY': 100.0,     // Added BABY token min
        'FLOKI': 5000.0,   // Added FLOKI
        'WIF': 1.0,        // Added WIF
        'BONK': 100000.0,  // Added BONK
        'RENDER': 0.5,     // Added RENDER
        'FET': 5.0,        // Added FET
        'RNDR': 0.5,       // Added RNDR
        'GRT': 10.0,       // Added GRT
        'IMX': 2.0,        // Added IMX
        'SAND': 5.0,       // Added SAND
        'MANA': 5.0,       // Added MANA
        'AXS': 0.2,        // Added AXS
        'ENS': 0.1,        // Added ENS
        'LDO': 1.0,        // Added LDO
        'RPL': 0.1,        // Added RPL
        'CRV': 5.0,        // Added CRV
        'AAVE': 0.02,      // Added AAVE
        'MKR': 0.002,      // Added MKR
        'SNX': 2.0,        // Added SNX
        'COMP': 0.05,      // Added COMP
        'YFI': 0.0002,     // Added YFI
        'SUSHI': 5.0,      // Added SUSHI
        '1INCH': 5.0,      // Added 1INCH
        'BAL': 0.5,        // Added BAL
        'ZRX': 5.0,        // Added ZRX
        'ENJ': 5.0,        // Added ENJ
        'CHZ': 50.0,       // Added CHZ
        'GALA': 50.0,      // Added GALA
        'APE': 1.0,        // Added APE
        'BLUR': 10.0,      // Added BLUR
        'OP': 3.0,
        'ARB': 5.0,
        'SEI': 5.0,        // Added SEI
        'TIA': 0.5,        // Added TIA
        'JUP': 5.0,        // Added JUP
        'PYTH': 10.0,      // Added PYTH
        'WLD': 1.0,        // Added WLD
        'STRK': 2.0        // Added STRK
      };

      const minQty = minOrderSizes[symbol.toUpperCase()] || 0.00001;
      if (parsedQty < minQty) {
        return Response.json({
          error: `Order too small. Minimum for ${symbol}: ${minQty}`,
          success: false
        }, { status: 400 });
      }

      console.log('[krakenTrade] Place order:', { symbol, side, quantity, orderType });

      // Build order parameters
      const orderParams = buildOrderParams({
        orderType,
        side,
        quantity,
        symbol,
        limitPrice,
        stopPrice,
        triggerPrice,
        trailingAmount,
        trailingPercent,
        timeInForce,
        postOnly,
        reduceOnly,
        displayQty,
        conditionalCloseOrder
      });

      console.log('[krakenTrade] Order params:', JSON.stringify(orderParams, null, 2));

      // Execute trade via WebSocket
      const tradeResult = await executeKrakenTrade(wsToken, orderParams);

      console.log('[krakenTrade] ✅ Trade executed:', tradeResult);

      // Log successful trade
      await base44.asServiceRole.entities.KrakenLog.create({
        event_type: 'create_order',
        status: 'success',
        message: `${side} ${quantity} ${symbol} ${orderType} order executed`,
        details_json: JSON.stringify({ 
          order_id: tradeResult.order_id,
          symbol,
          side,
          quantity,
          orderType,
          result: tradeResult.result,
          warnings: tradeResult.warnings
        }),
        created_by: user.email
      });

      return Response.json({
        success: true,
        order_id: tradeResult.order_id,
        order_userref: tradeResult.order_userref,
        client_order_id: tradeResult.client_order_id,
        symbol: orderParams.symbol,
        side,
        quantity,
        orderType,
        warnings: tradeResult.warnings,
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