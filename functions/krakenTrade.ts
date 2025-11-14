
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
const WS_TIMEOUT = 20000; // 20 second timeout for complex orders

/**
 * Format symbol for Kraken (e.g., "BTC" -> "BTC/USD")
 */
function formatKrakenSymbol(symbol) {
  const symbolMap = {
    'BTC': 'BTC/USD',
    'ETH': 'ETH/USD',
    'XRP': 'XRP/USD',
    'LTC': 'LTC/USD',
    'SOL': 'SOL/USD',
    'ADA': 'ADA/USD',
    'DOT': 'DOT/USD',
    'DOGE': 'DOGE/USD',
    'LINK': 'LINK/USD',
    'UNI': 'UNI/USD',
    'MATIC': 'MATIC/USD',
    'ATOM': 'ATOM/USD',
    'AVAX': 'AVAX/USD',
    'BCH': 'BCH/USD',
    'TRX': 'TRX/USD',
    'SHIB': 'SHIB/USD',
    'XLM': 'XLM/USD'
  };
  
  return symbolMap[symbol.toUpperCase()] || `${symbol.toUpperCase()}/USD`;
}

/**
 * Build order parameters based on order type
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

  const params = {
    order_type: orderType,
    side: side.toLowerCase(),
    order_qty: parseFloat(quantity),
    symbol: formatKrakenSymbol(symbol),
    time_in_force: timeInForce,
    order_userref: userref
  };

  // Add limit price for limit orders
  if (limitPrice && ['limit', 'stop-loss-limit', 'take-profit-limit', 'trailing-stop-limit'].includes(orderType)) {
    params.limit_price = parseFloat(limitPrice);
  }

  // Add triggers for stop-loss, take-profit, trailing-stop orders
  if (['stop-loss', 'stop-loss-limit', 'take-profit', 'take-profit-limit', 'trailing-stop', 'trailing-stop-limit'].includes(orderType)) {
    params.triggers = {
      reference: 'last', // 'last' or 'index'
    };

    // Stop-loss and take-profit with static price
    if (stopPrice && ['stop-loss', 'stop-loss-limit'].includes(orderType)) {
      params.triggers.price = parseFloat(stopPrice);
      params.triggers.price_type = 'static';
    } else if (triggerPrice && ['take-profit', 'take-profit-limit'].includes(orderType)) {
      params.triggers.price = parseFloat(triggerPrice);
      params.triggers.price_type = 'static';
    }

    // Trailing stop with percentage or quote offset
    if (['trailing-stop', 'trailing-stop-limit'].includes(orderType)) {
      if (trailingPercent) {
        params.triggers.price = parseFloat(trailingPercent);
        params.triggers.price_type = 'pct'; // Percentage offset
      } else if (trailingAmount) {
        params.triggers.price = parseFloat(trailingAmount);
        params.triggers.price_type = 'quote'; // USD offset
      } else {
        // Default to 1% trailing
        params.triggers.price = 1.0;
        params.triggers.price_type = 'pct';
      }
    }
  }

  // Add iceberg display quantity
  if (orderType === 'iceberg' && displayQty) {
    params.display_qty = parseFloat(displayQty);
    if (limitPrice) {
      params.limit_price = parseFloat(limitPrice);
    }
  }

  // Post-only flag (only for limit orders)
  if (postOnly && limitPrice) {
    params.post_only = true;
  }

  // Reduce-only flag (close positions only)
  if (reduceOnly) {
    params.reduce_only = true;
  }

  // Conditional close order (OTO - One-Triggers-Other)
  if (conditionalCloseOrder) {
    params.conditional = {
      order_type: conditionalCloseOrder.orderType || 'limit',
      limit_price: parseFloat(conditionalCloseOrder.limitPrice || 0)
    };

    if (conditionalCloseOrder.stopPrice) {
      params.conditional.trigger_price = parseFloat(conditionalCloseOrder.stopPrice);
      params.conditional.trigger_price_type = 'static';
    }
  }

  return params;
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
          
          // Check for successful order
          if (data.method === 'add_order' && data.success) {
            clearTimeout(timeout);
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
          }
          
          // Check for error
          if (data.error) {
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
        console.error('[krakenTrade] WebSocket error:', error);
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket connection error'));
        }
      };
      
      ws.onclose = () => {
        console.log('[krakenTrade] WebSocket closed');
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket closed unexpectedly'));
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
        console.error('[krakenTrade] WebSocket error:', error);
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket connection error'));
        }
      };
      
      ws.onclose = () => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WebSocket closed unexpectedly'));
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

      // CRITICAL: Minimum order validation (Kraken minimums)
      const minOrderSizes = {
        'BTC': 0.0001,
        'ETH': 0.001,
        'SOL': 0.01,
        'XRP': 1.0,
        'ADA': 1.0,
        'DOT': 0.1,
        'DOGE': 10.0,
        'LINK': 0.1
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
