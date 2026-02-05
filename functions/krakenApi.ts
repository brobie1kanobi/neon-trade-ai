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
 * 6. Enhanced key type logging for WebSocket token requests
 */

const KRAKEN_API_URL = 'https://api.kraken.com';
const API_TIMEOUT = 15000; // 15s timeout as Kraken can be slow
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
    // CRITICAL: Kraken allows ~15 calls per 3 seconds (5/sec) for private endpoints
    // Using 4/sec capacity with 3/sec refill gives breathing room while preventing rate limits
    // Trade key is more conservative since WS token requests are rate-sensitive
    const cfg = type === 'trade' 
      ? { capacity: 8, refillPerSec: 2 }    // Trade: ~2 calls/sec sustained
      : { capacity: 15, refillPerSec: 3 };  // Balance: ~3 calls/sec sustained
    rateLimiters.set(key, new TokenBucket(cfg.capacity, cfg.refillPerSec));
  }
  return rateLimiters.get(key);
}
function endpointCost(endpoint) {
  // Higher costs = more tokens consumed = longer waits between calls
  // CRITICAL: Costs aligned with Kraken's actual rate limit tiers
  // Most private endpoints cost 1 token, heavier ones cost 2
  if (endpoint.includes('GetWebSocketsToken')) return 1;
  if (endpoint.includes('OpenOrders')) return 1;      // Reduced from 2
  if (endpoint.includes('TradesHistory')) return 2;   // Keep at 2 (heavier endpoint)
  if (endpoint.includes('BalanceEx')) return 1;       // Reduced from 2
  if (endpoint.includes('Balance')) return 1;
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
  // Sanitize possible whitespace/newlines from keys
  const cleanKey = typeof apiKey === 'string' ? apiKey.trim().replace(/\s+/g, '') : apiKey;
  const cleanSecret = typeof apiSecret === 'string' ? apiSecret.trim().replace(/\s+/g, '') : apiSecret;
  const nonce = generateNonce();
  const postData = new URLSearchParams({ nonce, ...data }).toString();
  
  const message = nonce + postData;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(cleanSecret), c => c.charCodeAt(0)),
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
        'API-Key': cleanKey,
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
      
      // Retry on rate-limit errors with more aggressive backoff (longer waits)
      if ((/rate limit/i.test(errorMsg) || /EAPI:Rate limit exceeded/i.test(errorMsg)) && retryCount < MAX_NONCE_RETRIES) {
        // Longer base delay for WS token endpoint which is rate-limit sensitive
        const isWsToken = endpoint.includes('GetWebSocketsToken');
        const baseDelay = isWsToken ? 3000 : 1500;
        const delay = baseDelay * Math.pow(2, retryCount) + Math.floor(Math.random() * 1000); // longer backoff + jitter
        console.warn(`[krakenApi] Rate limited on ${endpoint}, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_NONCE_RETRIES})...`);
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
    
    console.log('[krakenApi] User authenticated:', user.email, 'isAdmin:', isAdmin, 'isCreator:', isCreator);

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
      const sanitize = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, '') : s);
      const apiKey = sanitize(payload?.apiKey || payload?.api_key || payload?.balanceApiKey || payload?.balance_api_key);
      const apiSecret = sanitize(payload?.apiSecret || payload?.api_secret || payload?.balanceApiSecret || payload?.balance_api_secret);
      const tradeKey = sanitize(payload?.tradeApiKey || payload?.trade_api_key);
      const tradeSecret = sanitize(payload?.tradeApiSecret || payload?.trade_api_secret);

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
            error: `Trade key test failed: ${e.message}. Ensure permissions: Access WebSockets API, Create & Modify Orders.`,
            code: 'trade_key_permissions_missing'
          }, { status: 200 });
        }
      }

      // Normalize and store dedicated keys explicitly to avoid ambiguity
      const connectionData = {
        // Explicitly set balance keys; null clears any previous values to avoid ambiguity
        balance_api_key: apiKey || null,
        balance_api_secret_encrypted: apiSecret || null,
        // Explicitly set trade keys; null clears previous values so we never use stale keys
        trade_api_key: tradeKey || null,
        trade_api_secret_encrypted: tradeSecret || null,
        // Clear legacy fields to prevent accidental fallback
        api_key: null,
        api_secret_encrypted: null,
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
    const normalize = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, '') : s);
    const getCreds = (purpose) => {
      const tradeActions = new Set(['getWebSocketUrl', 'getWebSocketToken']);
      const useTrade = tradeActions.has(purpose);
      
      let apiKeyToUse, apiSecretToUse;

      if (useTrade) {
        // STRICT: Trading actions must use the dedicated Trade key only (no legacy fallback)
        if (!connection.trade_api_key || !connection.trade_api_secret_encrypted) {
          console.error(`[krakenApi] Missing trade API key/secret for purpose: ${purpose}`);
          throw new Error('Missing trade API key/secret. Add a Trade key with: Access WebSockets API, Create & Modify Orders, Query Open/Closed Orders.');
        }
        apiKeyToUse = normalize(connection.trade_api_key);
        apiSecretToUse = normalize(connection.trade_api_secret_encrypted);
        console.log(`[krakenApi] Using TRADE key (purpose: ${purpose}). Key: ${apiKeyToUse.slice(0, 4)}...${apiKeyToUse.slice(-4)}, Secret length: ${apiSecretToUse.length}`);
      } else {
        // For reads prefer dedicated balance key; fallback to legacy api_key as last resort
        if (connection.balance_api_key && connection.balance_api_secret_encrypted) {
          apiKeyToUse = normalize(connection.balance_api_key);
          apiSecretToUse = normalize(connection.balance_api_secret_encrypted);
          console.log(`[krakenApi] Using BALANCE key (purpose: ${purpose}). Key: ${apiKeyToUse.slice(0, 4)}...${apiKeyToUse.slice(-4)}, Secret length: ${apiSecretToUse.length}`);
        } else if (connection.api_key && connection.api_secret_encrypted) {
          console.warn('[krakenApi] Using LEGACY api_key for balance reads (fallback). Please update to split keys.');
          apiKeyToUse = normalize(connection.api_key);
          apiSecretToUse = normalize(connection.api_secret_encrypted);
          console.log(`[krakenApi] Using LEGACY key (purpose: ${purpose}). Key: ${apiKeyToUse.slice(0, 4)}...${apiKeyToUse.slice(-4)}, Secret length: ${apiSecretToUse.length}`);
        } else {
          console.error(`[krakenApi] Missing balance API key/secret for purpose: ${purpose}`);
          throw new Error('Missing balance API key/secret. Add a Read-only key with: Query Funds, Query Ledger Entries, Query Open/Closed Orders, Query Trades.');
        }
      }
      return { apiKeyToUse, apiSecretToUse };
    };
    
    if (action === 'getBalance') {
      const { apiKeyToUse, apiSecretToUse } = getCreds('getBalance');
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/Balance'));
      const result = await callKraken(apiKeyToUse, apiSecretToUse, '/0/private/Balance', {});
      if (result.error?.length > 0) {
        const msg = result.error.join(', ');
        if (/Permission denied/i.test(msg)) {
          return Response.json({ success: false, error: 'Permission denied fetching Balance. Ensure the BALANCE key has Query Funds and Query Ledger Entries.', code: 'balance_key_permissions_missing' }, { status: 200 });
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
          return Response.json({ success: false, error: 'Permission denied fetching BalanceEx. Ensure the BALANCE key has Query Funds and Query Ledger Entries.', code: 'balance_key_permissions_missing' }, { status: 200 });
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
      const { apiKeyToUse, apiSecretToUse } = getCreds('getTradesHistory'); // uses BALANCE key
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/TradesHistory'));
      const result = await callKraken(apiKeyToUse, apiSecretToUse, '/0/private/TradesHistory', { type: 'all' });
      if (result.error?.length > 0) {
        const msg = result.error.join(', ');
        if (/Permission denied/i.test(msg)) {
          throw new Error('Permission denied fetching TradesHistory. Ensure the BALANCE key has Query Trades and Query Ledger Entries.');
        }
        throw new Error(msg);
      }

      // CRITICAL: Return EXACT values from Kraken API
      // Kraken trade object fields:
      // - ordertxid: order transaction id
      // - pair: asset pair (e.g., "XXLMZUSD")
      // - time: Unix timestamp in SECONDS
      // - type: "buy" or "sell"
      // - ordertype: order type (market, limit, etc.)
      // - price: price per unit (EXACT)
      // - cost: total cost/proceeds in quote currency (EXACT USD amount)
      // - fee: fee paid (EXACT)
      // - vol: volume/quantity traded (EXACT)
      // - margin: margin used
      // - misc: miscellaneous info
      const trades = [];
      for (const [txid, trade] of Object.entries(result.result?.trades || {})) {
        trades.push({
          trade_id: txid,
          txid,
          ordertxid: trade.ordertxid,
          pair: trade.pair,
          time: trade.time,           // Unix timestamp in SECONDS
          type: trade.type,           // "buy" or "sell"
          ordertype: trade.ordertype,
          price: trade.price,         // EXACT price per unit as string
          cost: trade.cost,           // EXACT total USD cost/proceeds as string
          fee: trade.fee,             // EXACT fee as string
          vol: trade.vol,             // EXACT quantity as string
          margin: trade.margin,
          misc: trade.misc,
          ...trade
        });
      }

      console.log('[krakenApi] getTradesHistory returned', trades.length, 'trades');
      return Response.json({ success: true, trades, count: trades.length }, { status: 200 });
    }

    if (action === 'getWebSocketUrl' || action === 'getWebSocketToken') {
      try {
        // Decide key type (default to TRADE for placing orders)
        const keyType = (payload?.keyType === 'balance') ? 'balance' : 'trade';
        const now = Date.now();

        // Select credentials up-front so we can fingerprint the key actually used
        const { apiKeyToUse, apiSecretToUse } = keyType === 'balance' ? getCreds('getBalance') : getCreds('getWebSocketToken');
        const fingerprint = `${keyType}:${String(apiKeyToUse || '').trim().slice(0,6)}...${String(apiKeyToUse || '').trim().slice(-4)}`;

        console.log(`[krakenApi] getWebSocketToken - Requested keyType: ${keyType}, Fingerprint: ${fingerprint}`);

        // CRITICAL: Aggressively cache tokens for BOTH balance AND trade keys
        // Each key gets its own cached token stored with a fingerprint
        const cacheKey = keyType === 'balance' ? 'balance_ws_token' : 'ws_token';
        const cacheExpiresKey = keyType === 'balance' ? 'balance_ws_token_expires_at' : 'ws_token_expires_at';
        const cacheFingerprintKey = keyType === 'balance' ? 'balance_ws_token_fingerprint' : 'ws_token_fingerprint';
        
        const cachedToken = connection?.[cacheKey];
        const expiresAt = connection?.[cacheExpiresKey] ? new Date(connection[cacheExpiresKey]).getTime() : 0;
        const cachedFingerprint = connection?.[cacheFingerprintKey];
        
        const safeToReuse = (
          !payload?.forceRefresh &&
          cachedToken &&
          cachedFingerprint === fingerprint &&
          (expiresAt - now) > 60000  // 1 minute buffer
        );

        if (safeToReuse) {
          const remainingSeconds = Math.floor((expiresAt - now) / 1000);
          console.log(`[krakenApi] ✅ Reusing cached WS token for ${keyType} (expires in ${remainingSeconds}s)`);
          return Response.json({
            success: true,
            connected: true,
            wsUrl: 'wss://ws-auth.kraken.com/v2',
            publicWsUrl: 'wss://ws.kraken.com/v2',
            token: cachedToken,
            expires_in: remainingSeconds,
            used_key_type: keyType,
            fingerprint,
            cached: true
          }, { status: 200 });
        }
        
        console.log(`[krakenApi] Fetching fresh WS token for ${keyType} (cached expired or forceRefresh=${payload?.forceRefresh})`);

        // Request a fresh token from Kraken for the chosen key
        await getLimiter(user.email, keyType).remove(endpointCost('/0/private/GetWebSocketsToken'));
        const result = await callKraken(apiKeyToUse, apiSecretToUse, '/0/private/GetWebSocketsToken', {});
        if (result.error?.length > 0) {
          const msg = result.error.join(', ');
          console.error(`[krakenApi] GetWebSocketsToken error for keyType=${keyType}: ${msg}`);
          if (/permission denied/i.test(msg)) {
            return Response.json({
              success: false,
              connected: false,
              error: 'Permission denied: API key lacks required permissions. Enable Access WebSockets API.' + (keyType === 'trade' ? ' Also enable Create & Modify Orders and Query open/closed orders.' : ''),
              code: keyType === 'trade' ? 'trade_key_permissions_missing' : 'balance_key_permissions_missing'
            }, { status: 200 });
          }
          if (/unknown|invalid key/i.test(msg)) {
            try {
              // Clear the token for this specific key type
              const clearData = keyType === 'balance'
                ? { balance_ws_token: null, balance_ws_token_expires_at: null, balance_ws_token_fingerprint: null }
                : { ws_token: null, ws_token_expires_at: null, ws_token_fingerprint: null };
              await base44.asServiceRole.entities.KrakenConnection.update(connection.id, clearData);
            } catch (_) {}
            return Response.json({
              success: false,
              connected: false,
              error: `Unknown/invalid API key for ${keyType.toUpperCase()} operations. Please re-enter and save your ${keyType === 'trade' ? 'Trade' : 'Balance'} key in Settings.`,
              code: 'unknown_key'
            }, { status: 200 });
          }
          throw new Error(msg);
        }

        const token = result.result?.token;
        const expires = result.result?.expires || 900; // Default 15 minutes
        if (!token) {
          throw new Error('Failed to get WebSocket token from Kraken');
        }

        // CRITICAL: Cache tokens for BOTH trade and balance keys
        try {
          const updateData = keyType === 'balance' 
            ? {
                balance_ws_token: token,
                balance_ws_token_expires_at: new Date(now + expires * 1000).toISOString(),
                balance_ws_token_fingerprint: fingerprint
              }
            : {
                ws_token: token,
                ws_token_expires_at: new Date(now + expires * 1000).toISOString(),
                ws_token_fingerprint: fingerprint
              };
          await base44.asServiceRole.entities.KrakenConnection.update(connection.id, updateData);
          console.log(`[krakenApi] Cached ${keyType} WS token (expires in ${expires}s)`);
        } catch (cacheErr) {
          console.warn('[krakenApi] Failed to cache WS token:', cacheErr?.message || cacheErr);
        }

        console.log('[krakenApi] ✅ WebSocket token retrieved for', keyType.toUpperCase(), 'expires in', expires, 'seconds');
        return Response.json({
          success: true,
          connected: true,
          wsUrl: 'wss://ws-auth.kraken.com/v2',
          publicWsUrl: 'wss://ws.kraken.com/v2',
          token: token,
          expires_in: expires,
          used_key_type: keyType,
          fingerprint
        }, { status: 200 });
      } catch (e) {
        console.error(`[krakenApi] getWebSocketToken exception: ${e.message}`);
        return Response.json({
          success: false,
          connected: false,
          error: e.message
        }, { status: 200 });
      }
    }

    // ACTION: Get open orders
    if (action === 'getOpenOrders') {
      // CRITICAL: Include trades=true to get detailed info (reads via BALANCE key)
      try {
        const { apiKeyToUse, apiSecretToUse } = getCreds('getOpenOrders');
        await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/OpenOrders')); // balance bucket
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
      } catch (e) {
        return Response.json({ success: false, error: e.message }, { status: 200 });
      }
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