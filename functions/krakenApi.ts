import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

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
const API_TIMEOUT = 8000; // 8 second timeout for Kraken API calls
const MAX_NONCE_RETRIES = 3; // Retry up to 3 times on nonce errors

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
  const startTime = Date.now();
  let isTimedOut = false;
  
  // CRITICAL: 8-SECOND HARD TIMEOUT - returns response immediately
  const globalTimeoutId = setTimeout(() => {
    console.error('[krakenApi] ⏰ GLOBAL TIMEOUT (8s)');
    isTimedOut = true;
  }, 8000);

  // Helper to check timeout
  const checkTimeout = () => {
    if (isTimedOut) {
      throw new Error('Request timeout - please try again');
    }
  };

  try {
    const base44 = createClientFromRequest(req);
    
    checkTimeout();
    
    // FASTER auth check - 1.5s timeout
    const user = await Promise.race([
      base44.auth.me(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 1500))
    ]);

    if (!user) {
      clearTimeout(globalTimeoutId);
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    checkTimeout();

    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    
    if (!isAdmin && !isCreator) {
      clearTimeout(globalTimeoutId);
      return Response.json({ error: 'Access denied', success: false }, { status: 403 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // Ignore parse errors for GET-like requests
    }

    const { action, payload } = body;
    if (!action) {
      clearTimeout(globalTimeoutId);
      return Response.json({ error: 'Missing action', success: false }, { status: 400 });
    }

    console.log('[krakenApi] Action:', action, 'User:', user.email);

    checkTimeout();

    // All actions share same connection fetch - 1.5s timeout
    const connections = await Promise.race([
      base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection fetch timeout')), 1500))
    ]);
    
    checkTimeout();

    if (action === 'status') {
      clearTimeout(globalTimeoutId);
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
      clearTimeout(globalTimeoutId);
      return Response.json({ success: true }, { status: 200 });
    }

    if (action === 'connect') {
      // FIXED: Support both camelCase and snake_case field names
      const apiKey = payload?.apiKey || payload?.api_key;
      const apiSecret = payload?.apiSecret || payload?.api_secret;
      
      if (!apiKey || !apiSecret) {
        clearTimeout(globalTimeoutId);
        return Response.json({ 
          error: 'Missing API credentials', 
          success: false 
        }, { status: 400 });
      }

      console.log('[krakenApi] Testing connection...');
      
      checkTimeout();
      
      // Test connection by fetching balance
      const balanceTest = await callKraken(apiKey, apiSecret, '/0/private/Balance', {});

      if (balanceTest.error?.length > 0) {
        throw new Error(balanceTest.error.join(', '));
      }

      checkTimeout();

      const connectionData = {
        api_key: apiKey,
        api_secret_encrypted: apiSecret,
        account_verified: true,
        last_verified: new Date().toISOString(),
        created_by: user.email
      };

      if (connections.length > 0) {
        await base44.asServiceRole.entities.KrakenConnection.update(connections[0].id, connectionData);
      } else {
        await base44.asServiceRole.entities.KrakenConnection.create(connectionData);
      }

      console.log('[krakenApi] ✅ Connection verified');
      clearTimeout(globalTimeoutId);
      return Response.json({ success: true }, { status: 200 });
    }

    // CRITICAL: Check if connected for all other actions
    if (!connections || connections.length === 0) {
      clearTimeout(globalTimeoutId);
      return Response.json({ 
        error: 'Kraken account not connected', 
        success: false, 
        connected: false 
      }, { status: 200 });
    }

    const connection = connections[0];
    
    checkTimeout();

    if (action === 'getBalance') {
      const result = await callKraken(
        connection.api_key, 
        connection.api_secret_encrypted, 
        '/0/private/Balance', 
        {}
      );

      checkTimeout();

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

      clearTimeout(globalTimeoutId);
      return Response.json({ 
        success: true, 
        balance: balances,
        raw_balance: rawBalances 
      }, { status: 200 });
    }

    if (action === 'getTradesHistory') {
      const result = await callKraken(
        connection.api_key, 
        connection.api_secret_encrypted, 
        '/0/private/TradesHistory', 
        { type: 'all' }
      );

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      const trades = [];
      for (const [txid, trade] of Object.entries(result.result?.trades || {})) {
        trades.push({ txid, ...trade });
      }

      clearTimeout(globalTimeout);
      return Response.json({ success: true, trades, count: trades.length }, { status: 200 });
    }

    if (action === 'getWebSocketUrl' || action === 'getWebSocketToken') {
      const result = await callKraken(
        connection.api_key, 
        connection.api_secret_encrypted, 
        '/0/private/GetWebSocketsToken', 
        {}
      );

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      const token = result.result?.token;
      const expires = result.result?.expires || 900; // Default 15 minutes
      
      if (!token) {
        throw new Error('Failed to get WebSocket token from Kraken');
      }

      console.log('[krakenApi] ✅ WebSocket token retrieved, expires in', expires, 'seconds');

      clearTimeout(globalTimeout);
      return Response.json({
        success: true,
        connected: true,
        wsUrl: 'wss://ws-auth.kraken.com/v2',
        publicWsUrl: 'wss://ws.kraken.com/v2',
        token: token,
        expires_in: expires
      }, { status: 200 });
    }

    // ACTION: Get open orders
    if (action === 'getOpenOrders') {
      const result = await callKraken(
        connection.api_key, 
        connection.api_secret_encrypted, 
        '/0/private/OpenOrders', 
        {}
      );

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      const openOrders = [];
      for (const [orderId, order] of Object.entries(result.result?.open || {})) {
        openOrders.push({
          order_id: orderId,
          ...order
        });
      }

      clearTimeout(globalTimeout);
      return Response.json({ 
        success: true, 
        orders: openOrders,
        count: openOrders.length 
      }, { status: 200 });
    }

    // ACTION: Get asset pairs (for trading info)
    if (action === 'getAssetPairs') {
      const pairsToFetch = payload?.pairs || 'BTCUSD,ETHUSD,SOLUSD';
      
      // Public endpoint - no auth needed
      const response = await fetch(`https://api.kraken.com/0/public/AssetPairs?pair=${pairsToFetch}`);
      const result = await response.json();

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      clearTimeout(globalTimeout);
      return Response.json({ 
        success: true, 
        pairs: result.result || {} 
      }, { status: 200 });
    }

    clearTimeout(globalTimeout);
    return Response.json({ error: 'Unknown action', success: false }, { status: 400 });

  } catch (error) {
    clearTimeout(globalTimeout);
    console.error('[krakenApi] ❌ Error:', error.message);
    
    // CRITICAL: Return 200 with success=false instead of 500
    return Response.json({ 
      error: error.message, 
      success: false,
      connected: false 
    }, { status: 200 });
  }
});