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
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth check with timeout
    let user;
    try {
      user = await Promise.race([
        base44.auth.me(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 3000))
      ]);
    } catch (authErr) {
      return Response.json({ error: 'Auth failed: ' + authErr.message, success: false }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    
    if (!isAdmin && !isCreator) {
      return Response.json({ error: 'Access denied', success: false }, { status: 403 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // Ignore parse errors
    }

    const { action, payload } = body;
    if (!action) {
      return Response.json({ error: 'Missing action', success: false }, { status: 400 });
    }

    console.log('[krakenApi] Action:', action, 'User:', user.email);

    // Fetch connection with timeout
    let connections;
    try {
      connections = await Promise.race([
        base44.asServiceRole.entities.KrakenConnection.filter({ created_by: user.email }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 3000))
      ]);
    } catch (dbErr) {
      return Response.json({ error: 'Database error: ' + dbErr.message, success: false }, { status: 200 });
    }

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
      // FIXED: Support both camelCase and snake_case field names
      const apiKey = payload?.apiKey || payload?.api_key;
      const apiSecret = payload?.apiSecret || payload?.api_secret;
      
      if (!apiKey || !apiSecret) {
        clearTimeout(globalTimeout);
        return Response.json({ 
          error: 'Missing API credentials', 
          success: false 
        }, { status: 400 });
      }

      console.log('[krakenApi] Testing connection...');
      
      // Test connection by fetching balance
      const balanceTest = await callKraken(apiKey, apiSecret, '/0/private/Balance', {});

      if (balanceTest.error?.length > 0) {
        throw new Error(balanceTest.error.join(', '));
      }

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
      return Response.json({ success: true }, { status: 200 });
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

    if (action === 'getBalance') {
      const result = await callKraken(
        connection.api_key, 
        connection.api_secret_encrypted, 
        '/0/private/Balance', 
        {}
      );

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      return Response.json({ success: true, balance: result.result || {} }, { status: 200 });
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

      return Response.json({ success: true, trades, count: trades.length }, { status: 200 });
    }

    if (action === 'getWebSocketUrl') {
      const result = await callKraken(
        connection.api_key, 
        connection.api_secret_encrypted, 
        '/0/private/GetWebSocketsToken', 
        {}
      );

      if (result.error?.length > 0) throw new Error(result.error.join(', '));

      const token = result.result?.token;
      
      if (!token) {
        throw new Error('Failed to get WebSocket token from Kraken');
      }

      return Response.json({
        success: true,
        wsUrl: 'wss://ws-auth.kraken.com/v2',
        token: token,
        expires_in: 900
      }, { status: 200 });
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