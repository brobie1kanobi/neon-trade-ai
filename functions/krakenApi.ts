import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Kraken API Proxy - FIXED VERSION
 * 
 * CRITICAL FIXES:
 * 1. Fixed payload field names (apiKey/apiSecret vs api_key/api_secret)
 * 2. Better WebSocket URL handling (returns error if not connected)
 * 3. Microsecond nonce generation with counter (prevents duplicates)
 * 4. Automatic retry on nonce errors (3 attempts with delay)
 * 5. Detailed logging for debugging
 */

const KRAKEN_API_URL = 'https://api.kraken.com';
const API_TIMEOUT = 5000; // 5 second timeout for Kraken API calls
const MAX_NONCE_RETRIES = 4; // Retry up to 4 times on nonce/rate-limit errors

// CRITICAL: Nonce counter to prevent duplicate nonces in rapid calls
let lastNonce = 0;

function generateNonce() {
  // Use microseconds for high precision
  const now = Date.now() * 1000; // Convert to microseconds
  
  // Ensure nonce is always increasing (handle rapid calls)
  if (now <= lastNonce) {
    lastNonce++;
  } else {
    lastNonce = now;
  }
  
  return lastNonce.toString();
}

async function callKraken(apiKey, apiSecret, endpoint, data = {}, retryCount = 0) {
  const nonce = generateNonce();
  const postData = new URLSearchParams({ nonce, ...data }).toString();
  
  const message = nonce + postData;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(apiSecret), c => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  
  const pathBytes = new TextEncoder().encode(endpoint);
  const combined = new Uint8Array(pathBytes.length + hash.byteLength);
  combined.set(pathBytes);
  combined.set(new Uint8Array(hash), pathBytes.length);
  
  const signature = await crypto.subtle.sign('HMAC', hmacKey, combined);
  const apiSign = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  // CRITICAL: Add timeout to fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  
  try {
    const response = await fetch(`${KRAKEN_API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'API-Sign': apiSign,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NeonTrade-AI/1.0'
      },
      body: postData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    
    const result = await response.json();
    
    // CRITICAL: Check for errors
    if (result.error?.length > 0) {
      const errorMsg = result.error.join(', ');
      
      // Retry on rate-limit errors with gentle backoff
      if ((/rate limit/i.test(errorMsg) || /EAPI:Rate limit exceeded/i.test(errorMsg)) && retryCount < MAX_NONCE_RETRIES) {
        const delay = 1200 * Math.pow(2, retryCount) + Math.floor(Math.random() * 400); // backoff + jitter
        console.warn(`[krakenApi] Rate limited, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return callKraken(apiKey, apiSecret, endpoint, data, retryCount + 1);
      }
      
      // CRITICAL: Retry on nonce errors
      if (/nonce/i.test(errorMsg) && retryCount < MAX_NONCE_RETRIES) {
        console.warn(`[krakenApi] Nonce error on attempt ${retryCount + 1}/${MAX_NONCE_RETRIES}, retrying...`);
        
        // Wait before retry (exponential backoff: 500ms, 1000ms, 2000ms)
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retryCount)));
        
        return callKraken(apiKey, apiSecret, endpoint, data, retryCount + 1);
      }
      
      // CRITICAL: Better error messages for common issues
      if (/signature/i.test(errorMsg)) {
        throw new Error('Invalid signature - Please check your API credentials or create a new API key.');
      }
      
      if (/nonce/i.test(errorMsg)) {
        throw new Error('Invalid nonce - Enable "Custom nonce window" in your Kraken API settings and set it to 10000 milliseconds (10 seconds).');
      }
      
      throw new Error(errorMsg);
    }
    
    return result;
  } catch (fetchError) {
    clearTimeout(timeoutId);
    
    if (fetchError.name === 'AbortError') {
      throw new Error('Kraken API timeout');
    }
    
    // Re-throw other errors
    throw fetchError;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    // Allow any authenticated user to access their own Kraken data
    // Security note: RLS on KrakenConnection ensures only the creator's records are accessed
    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;

    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // Ignore parse errors for GET-like requests
    }

    const { action, payload } = body;
    if (!action) {
      return Response.json({ error: 'Missing action', success: false }, { status: 400 });
    }

    console.log('[krakenApi] Action:', action, 'User:', user.email);

    const connections = await base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }, '-updated_date', 1);
    
    if (action === 'status') {
      return Response.json({
        connected: connections?.length > 0,
        success: true,
        account_verified: connections?.[0]?.account_verified || false
      }, { status: 200 });
    }

    if (action === 'disconnect') {
      if (connections.length > 0) {
        await base44.asServiceRole.entities.KrakenConnection.delete(connections[0].id);
      }
      
      return Response.json({ success: true }, { status: 200 });
    }

    if (action === 'connect') {
      // Accept separate read-only (balance) and trade keys
      const apiKey = payload?.apiKey || payload?.api_key || payload?.balanceApiKey || payload?.balance_api_key;
      const apiSecret = payload?.apiSecret || payload?.api_secret || payload?.balanceApiSecret || payload?.balance_api_secret;
      const tradeKey = payload?.tradeApiKey || payload?.trade_api_key;
      const tradeSecret = payload?.tradeApiSecret || payload?.trade_api_secret;

      if (!apiKey || !apiSecret) {
        return Response.json({ 
          error: 'Missing API credentials: provide balance (read-only) apiKey/apiSecret', 
          success: false 
        }, { status: 400 });
      }

      console.log('[krakenApi] Testing balance key...');
      const balanceTest = await callKraken(apiKey, apiSecret, '/0/private/Balance', {});
      if (balanceTest.error?.length > 0) {
        throw new Error(balanceTest.error.join(', '));
      }

      // Optionally verify trade key and WebSocket permission
      let tradeVerified = false;
      if (tradeKey && tradeSecret) {
        try {
          console.log('[krakenApi] Testing trade key (WebSocket token)...');
          const wsTest = await callKraken(tradeKey, tradeSecret, '/0/private/GetWebSocketsToken', {});
          if (wsTest.error?.length > 0) {
            const msg = wsTest.error.join(', ');
            throw new Error(msg);
          }
          tradeVerified = true;
        } catch (e) {
          return Response.json({
            success: false,
            error: `Trade key test failed: ${e.message}. Ensure permissions: Access WebSockets API, Create & Modify Orders.`
          }, { status: 200 });
        }
      }

      const connectionData = {
        api_key: apiKey,
        api_secret_encrypted: apiSecret,
        // Save dedicated keys when provided
        ...(tradeKey && tradeSecret ? {
          trade_api_key: tradeKey,
          trade_api_secret_encrypted: tradeSecret
        } : {}),
        // Optional separate balance key fields if explicitly supplied
        ...(payload?.balanceApiKey || payload?.balance_api_key ? {
          balance_api_key: payload?.balanceApiKey || payload?.balance_api_key,
          balance_api_secret_encrypted: payload?.balanceApiSecret || payload?.balance_api_secret
        } : {}),
        account_verified: true,
        last_verified: new Date().toISOString(),
        created_by: user.email
      };

      if (connections.length > 0) {
        await base44.asServiceRole.entities.KrakenConnection.update(connections[0].id, connectionData);
      } else {
        await base44.asServiceRole.entities.KrakenConnection.create(connectionData);
      }

      console.log('[krakenApi] ✅ Keys saved. Balance OK. Trade key:', tradeVerified ? 'verified' : 'not provided');
      
      return Response.json({ success: true, trade_key_verified: tradeVerified }, { status: 200 });
    }

    // CRITICAL: Check if connected for all other actions
    if (!connections || connections.length === 0) {
      
      return Response.json({ 
        error: 'Kraken account not connected', 
        success: false, 
        connected: false 
      }, { status: 200 });
    }

    const connection = connections[0];
    
    // Helper to select correct API key pair per action (split keys)
    const getCreds = (purpose) => {
      const tradeActions = new Set(['getWebSocketUrl', 'getWebSocketToken', 'getOpenOrders', 'place_order']);
      const useTrade = tradeActions.has(purpose);
      if (useTrade) {
        if (!connection.trade_api_key || !connection.trade_api_secret_encrypted) {
          throw new Error('Missing trade API key/secret. Please add a Trade key with permissions: "Create and modify orders", "Access WebSockets API".');
        }
        return { apiKeyToUse: connection.trade_api_key, apiSecretToUse: connection.trade_api_secret_encrypted };
      }
      // Read-only/balance operations
      if (connection.balance_api_key && connection.balance_api_secret_encrypted) {
        return { apiKeyToUse: connection.balance_api_key, apiSecretToUse: connection.balance_api_secret_encrypted };
      }
      // Fallback to legacy single key
      return { apiKeyToUse: connection.api_key, apiSecretToUse: connection.api_secret_encrypted };
    };
    
    if (action === 'getBalance') {
      const { apiKeyToUse, apiSecretToUse } = getCreds('getBalance');
      const result = await callKraken(
        apiKeyToUse,
        apiSecretToUse,
        '/0/private/Balance',
        {}
      );

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      // Parse balances and return in standardized format
      const rawBalances = result.result || {};
      const balances = {};
      
      for (const [asset, amount] of Object.entries(rawBalances)) {
        // Normalize Kraken asset codes (XXBT -> BTC, ZUSD -> USD)
        let normalizedAsset = asset;
        if (asset.startsWith('X') && asset.length === 4) {
          normalizedAsset = asset.substring(1);
        }
        if (asset.startsWith('Z') && asset.length === 4) {
          normalizedAsset = asset.substring(1);
        }
        if (normalizedAsset === 'XBT') normalizedAsset = 'BTC';
        
        balances[normalizedAsset] = parseFloat(amount) || 0;
      }

      return Response.json({ 
        success: true, 
        balance: balances,
        raw_balance: rawBalances 
      }, { status: 200 });
    }

    // ACTION: Get extended balance (includes locked/hold amounts)
    // CRITICAL: This returns the TOTAL balance including amounts locked in orders
    if (action === 'getExtendedBalance') {
      const { apiKeyToUse, apiSecretToUse } = getCreds('getExtendedBalance');
      const result = await callKraken(
        apiKeyToUse,
        apiSecretToUse,
        '/0/private/BalanceEx',
        {}
      );

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      // Parse extended balances - format: { asset: { balance, hold_trade, credit, credit_used } }
      const rawBalances = result.result || {};
      const balances = {};
      
      for (const [asset, balanceInfo] of Object.entries(rawBalances)) {
        // Normalize Kraken asset codes
        let normalizedAsset = asset;
        if (asset.startsWith('X') && asset.length === 4) {
          normalizedAsset = asset.substring(1);
        }
        if (asset.startsWith('Z') && asset.length === 4) {
          normalizedAsset = asset.substring(1);
        }
        if (normalizedAsset === 'XBT') normalizedAsset = 'BTC';
        
        const available = parseFloat(balanceInfo?.balance) || 0;
        const holdTrade = parseFloat(balanceInfo?.hold_trade) || 0;
        const total = available + holdTrade;  // CRITICAL: Total = available + locked
        
        balances[normalizedAsset] = {
          balance: available,
          hold_trade: holdTrade,
          total: total,  // This is what Kraken shows as "Total value"
          credit: parseFloat(balanceInfo?.credit) || 0,
          credit_used: parseFloat(balanceInfo?.credit_used) || 0
        };
      }

      return Response.json({ 
        success: true, 
        balance: balances,
        raw_balance: rawBalances 
      }, { status: 200 });
    }

    if (action === 'getTradesHistory') {
      const { apiKeyToUse, apiSecretToUse } = getCreds('getTradesHistory');
      const result = await callKraken(
        apiKeyToUse,
        apiSecretToUse,
        '/0/private/TradesHistory',
        { type: 'all' }
      );

      

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      const trades = [];
      for (const [txid, trade] of Object.entries(result.result?.trades || {})) {
        trades.push({ txid, ...trade });
      }

      
      return Response.json({ success: true, trades, count: trades.length }, { status: 200 });
    }

    if (action === 'getWebSocketUrl' || action === 'getWebSocketToken') {
      try {
        // Use cached token if still valid (60s buffer)
        const now = Date.now();
        const expiresAt = connection?.ws_token_expires_at ? new Date(connection.ws_token_expires_at).getTime() : 0;
        if (connection?.ws_token && (expiresAt - now) > 60000) {
          return Response.json({
            success: true,
            connected: true,
            wsUrl: 'wss://ws-auth.kraken.com/v2',
            publicWsUrl: 'wss://ws.kraken.com/v2',
            token: connection.ws_token,
            expires_in: Math.floor((expiresAt - now) / 1000)
          }, { status: 200 });
        }

        const { apiKeyToUse, apiSecretToUse } = getCreds('getWebSocketUrl');
        const result = await callKraken(
          apiKeyToUse,
          apiSecretToUse,
          '/0/private/GetWebSocketsToken',
          {}
        );

        if (result.error?.length > 0) {
          const msg = result.error.join(', ');
          if (/permission denied/i.test(msg)) {
            return Response.json({
              success: false,
              connected: false,
              error: 'Permission denied: Trade API key lacks required permissions. Enable "Access WebSockets API" and "Create and modify orders".'
            }, { status: 200 });
          }
          throw new Error(msg);
        }

        const token = result.result?.token;
        const expires = result.result?.expires || 900; // Default 15 minutes
        if (!token) {
          throw new Error('Failed to get WebSocket token from Kraken');
        }

        // Cache token on the connection
        try {
          await base44.asServiceRole.entities.KrakenConnection.update(connection.id, {
            ws_token: token,
            ws_token_expires_at: new Date(now + expires * 1000).toISOString()
          });
        } catch (cacheErr) {
          console.warn('[krakenApi] Failed to cache WS token:', cacheErr?.message || cacheErr);
        }

        console.log('[krakenApi] ✅ WebSocket token retrieved, expires in', expires, 'seconds');
        return Response.json({
          success: true,
          connected: true,
          wsUrl: 'wss://ws-auth.kraken.com/v2',
          publicWsUrl: 'wss://ws.kraken.com/v2',
          token: token,
          expires_in: expires
        }, { status: 200 });
      } catch (e) {
        return Response.json({
          success: false,
          connected: false,
          error: e.message
        }, { status: 200 });
      }
    }

    // ACTION: Get open orders
    if (action === 'getOpenOrders') {
      // CRITICAL: Include trades=true to get detailed info
      try {
        const { apiKeyToUse, apiSecretToUse } = getCreds('getOpenOrders');
        const result = await callKraken(
          apiKeyToUse,
          apiSecretToUse,
          '/0/private/OpenOrders',
          { trades: true }
        );
        if (result.error?.length > 0) throw new Error(result.error.join(', '));

      const openOrders = [];
      for (const [orderId, order] of Object.entries(result.result?.open || {})) {
        openOrders.push({
          order_id: orderId,
          ...order
        });
      }

      
      return Response.json({ 
        success: true, 
        orders: openOrders,
        count: openOrders.length 
      }, { status: 200 });
    }

    // ACTION: Get asset pairs (for trading info)
    if (action === 'getAssetPairs') {
      const pairsToFetch = payload?.pairs || 'BTCUSD,ETHUSD,SOLUSD';
      
      // Public endpoint - no auth needed, 2s timeout
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 2000);
      
      try {
        const response = await fetch(`https://api.kraken.com/0/public/AssetPairs?pair=${pairsToFetch}`, {
          signal: controller.signal
        });
        clearTimeout(fetchTimeout);
        const result = await response.json();

        if (result.error?.length > 0) throw new Error(result.error.join(', '));

        
        return Response.json({ 
          success: true, 
          pairs: result.result || {} 
        }, { status: 200 });
      } catch (fetchErr) {
        clearTimeout(fetchTimeout);
        throw fetchErr;
      }
    }

    return Response.json({ error: 'Unknown action', success: false }, { status: 400 });

  } catch (error) {
    console.error('[krakenApi] ❌ Error:', error.message);
    
    // CRITICAL: Return 200 with success=false instead of 500
    return Response.json({ 
      error: error.message, 
      success: false,
      connected: false 
    }, { status: 200 });
  }
});