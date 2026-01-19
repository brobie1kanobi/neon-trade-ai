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
const API_TIMEOUT = 8000; // 8s timeout as Kraken can be slow
const MAX_NONCE_RETRIES = 5; // Slightly higher to smooth occasional spikes

// Per-key token bucket rate limiter (separate buckets for balance vs trade keys)
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
  }
  async remove(cost = 1, maxWaitMs = 3000) {
    this.refill();
    if (this.tokens >= cost) { this.tokens -= cost; return; }
    const deficit = cost - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillPerSec) * 1000) + 50;
    const capped = Math.min(waitMs, maxWaitMs);
    await new Promise(res => setTimeout(res, capped));
    this.refill();
    if (this.tokens >= cost) { this.tokens -= cost; return; }
    // If still not enough, consume and serialize
    this.tokens = Math.max(0, this.tokens - cost);
  }
}
const rateLimiters = new Map();
// Short-term per-user cache for extended balance to reduce burst calls (2s TTL)
const extBalCache = new Map();
function getLimiter(bucketKey, type = 'balance') {
  const key = `${bucketKey}:${type}`;
  if (!rateLimiters.has(key)) {
    // Conservative defaults: trade is stricter
    const cfg = type === 'trade' ? { capacity: 3, refillPerSec: 0.35 } : { capacity: 10, refillPerSec: 1.0 };
    rateLimiters.set(key, new TokenBucket(cfg.capacity, cfg.refillPerSec));
  }
  return rateLimiters.get(key);
}
function endpointCost(endpoint) {
  if (endpoint.includes('GetWebSocketsToken')) return 4;
  if (endpoint.includes('OpenOrders')) return 3;
  if (endpoint.includes('TradesHistory')) return 2;
  if (endpoint.includes('BalanceEx')) return 2;
  return 1;
}

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
      
      // Retry on rate-limit errors with more conservative backoff
      if ((/rate limit/i.test(errorMsg) || /EAPI:Rate limit exceeded/i.test(errorMsg)) && retryCount < MAX_NONCE_RETRIES) {
        const delay = 1500 * Math.pow(2, retryCount) + Math.floor(Math.random() * 600); // backoff + jitter
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
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/Balance'));
      const balanceTest = await callKraken(apiKey, apiSecret, '/0/private/Balance', {});
      if (balanceTest.error?.length > 0) {
        throw new Error(balanceTest.error.join(', '));
      }

      // Optionally verify trade key and WebSocket permission
      let tradeVerified = false;
      if (tradeKey && tradeSecret) {
        try {
          console.log('[krakenApi] Testing trade key (WebSocket token)...');
          await getLimiter(user.email, 'trade').remove(endpointCost('/0/private/GetWebSocketsToken'));
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
      // Treat all trading-related ops as TRADE (ws token, open orders, placing orders, trades history)
      const tradeActions = new Set(['getWebSocketUrl', 'getWebSocketToken', 'getOpenOrders', 'place_order', 'getTradesHistory']);
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
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/Balance'));
      const result = await callKraken(apiKeyToUse, apiSecretToUse, '/0/private/Balance', {});
      if (result.error?.length > 0) {
        const msg = result.error.join(', ');
        if (/Permission denied/i.test(msg)) {
          throw new Error('Permission denied fetching Balance. Ensure the BALANCE key has Query Funds and Query Ledger Entries.');
        }
        throw new Error(msg);
      }

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
      // Short-term per-user cache (2s) to coalesce bursts and avoid rate limits
      const __cacheKey = `${user.email}:${apiKeyToUse}:extbal`;
      const __cached = extBalCache.get(__cacheKey);
      if (__cached && (Date.now() - __cached.ts) < 2000 && __cached.data) {
        return Response.json(__cached.data, { status: 200 });
      }
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/BalanceEx'));
      const result = await callKraken(apiKeyToUse, apiSecretToUse, '/0/private/BalanceEx', {});
      if (result.error?.length > 0) {
        const msg = result.error.join(', ');
        if (/Permission denied/i.test(msg)) {
          throw new Error('Permission denied fetching BalanceEx. Ensure the BALANCE key has Query Funds and Query Ledger Entries.');
        }
        throw new Error(msg);
      }

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

      const __response = { 
        success: true, 
        balance: balances,
        raw_balance: rawBalances 
      };
      extBalCache.set(__cacheKey, { ts: Date.now(), data: __response });
      return Response.json(__response, { status: 200 });
      }

      if (action === 'getTradesHistory') {
      const { apiKeyToUse, apiSecretToUse } = getCreds('getTradesHistory'); // uses TRADE key
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/TradesHistory'));
      const result = await callKraken(apiKeyToUse, apiSecretToUse, '/0/private/TradesHistory', { type: 'all' });
      if (result.error?.length > 0) {
        const msg = result.error.join(', ');
        if (/Permission denied/i.test(msg)) {
          throw new Error('Permission denied fetching TradesHistory. Ensure the BALANCE key has Query Trades and Query Ledger Entries.');
        }
        throw new Error(msg);
      }

      const trades = [];
      for (const [txid, trade] of Object.entries(result.result?.trades || {})) {
        trades.push({ txid, ...trade });
      }

      
      return Response.json({ success: true, trades, count: trades.length }, { status: 200 });
    }

    if (action === 'getWebSocketUrl' || action === 'getWebSocketToken') {
      try {
        // Decide key type (default to TRADE for placing orders)
        const keyType = (payload?.keyType === 'balance') ? 'balance' : 'trade';
        const now = Date.now();

        // Select credentials up-front so we can fingerprint the key actually used
        const { apiKeyToUse, apiSecretToUse } = keyType === 'balance' ? getCreds('getBalance') : getCreds('getWebSocketToken');
        const fingerprint = `${keyType}:${String(apiKeyToUse || '').slice(0,6)}...${String(apiKeyToUse || '').slice(-4)}`;

        // Reuse cached token ONLY if:
        // - it's for TRADE key
        // - fingerprint matches the stored one (prevents using a BALANCE token for trading)
        // - not expiring within 60s
        const expiresAt = connection?.ws_token_expires_at ? new Date(connection.ws_token_expires_at).getTime() : 0;
        const safeToReuse = (
          keyType === 'trade' &&
          !payload?.forceRefresh &&
          connection?.ws_token &&
          connection?.ws_token_fingerprint === fingerprint &&
          (expiresAt - now) > 60000
        );

        if (safeToReuse) {
          return Response.json({
            success: true,
            connected: true,
            wsUrl: 'wss://ws-auth.kraken.com/v2',
            publicWsUrl: 'wss://ws.kraken.com/v2',
            token: connection.ws_token,
            expires_in: Math.floor((expiresAt - now) / 1000)
          }, { status: 200 });
        }

        // Request a fresh token from Kraken for the chosen key
        await getLimiter(user.email, keyType).remove(endpointCost('/0/private/GetWebSocketsToken'));
        const result = await callKraken(apiKeyToUse, apiSecretToUse, '/0/private/GetWebSocketsToken', {});
        if (result.error?.length > 0) {
          const msg = result.error.join(', ');
          if (/permission denied/i.test(msg)) {
            return Response.json({
              success: false,
              connected: false,
              error: 'Permission denied: API key lacks required permissions. Enable Access WebSockets API.' + (keyType === 'trade' ? ' Also enable Create & Modify Orders and Query open/closed orders.' : '')
            }, { status: 200 });
          }
          throw new Error(msg);
        }

        const token = result.result?.token;
        const expires = result.result?.expires || 900; // Default 15 minutes
        if (!token) {
          throw new Error('Failed to get WebSocket token from Kraken');
        }

        // Cache token ONLY for TRADE key and bind it to the key fingerprint
        if (keyType !== 'balance') {
          try {
            await base44.asServiceRole.entities.KrakenConnection.update(connection.id, {
              ws_token: token,
              ws_token_expires_at: new Date(now + expires * 1000).toISOString(),
              ws_token_fingerprint: fingerprint
            });
          } catch (cacheErr) {
            console.warn('[krakenApi] Failed to cache WS token:', cacheErr?.message || cacheErr);
          }
        }

        console.log('[krakenApi] ✅ WebSocket token retrieved for', keyType.toUpperCase(), 'expires in', expires, 'seconds');
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
        await getLimiter(user.email, 'trade').remove(endpointCost('/0/private/OpenOrders'));
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