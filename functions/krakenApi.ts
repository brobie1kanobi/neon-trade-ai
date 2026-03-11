import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Kraken API Proxy - Secrets-based version (no DB-stored keys)
 *
 * Keys are read from application secrets:
 * - Balance (read-only) key: Kraken_API_Key + Kraken_API_Secret
 * - Trade key (order placement): Trade_Key + Trade_Secret
 *
 * Read-only actions use the Balance key; WebSocket token for trading uses the Trade key.
 */

const KRAKEN_API_URL = 'https://api.kraken.com';
const API_TIMEOUT = 15000;
const MAX_NONCE_RETRIES = 5;

// In-memory WS token cache per key type
const wsTokenCache = new Map(); // key: 'balance'|'trade' => { token, expiresAt, fingerprint }
// De-duplicate in-flight requests for WS token
const inFlight = new Map(); // keyType => Promise

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
  async remove(cost = 1, maxWaitMs = 2000) {
    const deadline = Date.now() + maxWaitMs;
    while (true) {
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const deficit = cost - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillPerSec) * 1000) + 50;
      const now = Date.now();
      if (now + waitMs > deadline) {
        const remaining = Math.max(0, deadline - now);
        if (remaining === 0) return; // give up without consuming to avoid bursts
        await new Promise(res => setTimeout(res, remaining));
      } else {
        await new Promise(res => setTimeout(res, waitMs));
      }
    }
  }
}
const rateLimiters = new Map();
function getLimiter(bucketKey, type = 'balance') {
  const key = `${bucketKey}:${type}`;
  if (!rateLimiters.has(key)) {
    // More conservative limits to avoid Kraken 429s
    const cfg = type === 'trade' ? { capacity: 4, refillPerSec: 1 } : { capacity: 6, refillPerSec: 1 };
    rateLimiters.set(key, new TokenBucket(cfg.capacity, cfg.refillPerSec));
  }
  return rateLimiters.get(key);
}
function endpointCost(endpoint) {
  if (endpoint.includes('GetWebSocketsToken')) return 1;
  if (endpoint.includes('OpenOrders')) return 1;
  if (endpoint.includes('TradesHistory')) return 2;
  if (endpoint.includes('BalanceEx')) return 1;
  if (endpoint.includes('Balance')) return 1;
  return 1;
}

let lastNonce = 0;
function generateNonce() { const now = Date.now() * 1000; if (now <= lastNonce) lastNonce++; else lastNonce = now; return lastNonce.toString(); }

async function callKraken(apiKey, apiSecret, endpoint, data = {}, retryCount = 0) {
  const cleanKey = String(apiKey || '').trim().replace(/\s+/g, '');
  const cleanSecret = String(apiSecret || '').trim().replace(/\s+/g, '');
  const nonce = generateNonce();
  const postData = new URLSearchParams({ nonce, ...data }).toString();

  const message = nonce + postData;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  const hmacKey = await crypto.subtle.importKey('raw', Uint8Array.from(atob(cleanSecret), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const pathBytes = new TextEncoder().encode(endpoint);
  const combined = new Uint8Array(pathBytes.length + hash.byteLength);
  combined.set(pathBytes); combined.set(new Uint8Array(hash), pathBytes.length);
  const signature = await crypto.subtle.sign('HMAC', hmacKey, combined);
  const apiSign = btoa(String.fromCharCode(...new Uint8Array(signature)));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const response = await fetch(`${KRAKEN_API_URL}${endpoint}` , { method: 'POST', headers: { 'API-Key': cleanKey, 'API-Sign': apiSign, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NeonTrade-AI/1.0' }, body: postData, signal: controller.signal });
    clearTimeout(timeoutId);
    const result = await response.json();
    if (result.error?.length > 0) {
      const errorMsg = result.error.join(', ');
      if ((/rate limit/i.test(errorMsg) || /EAPI:Rate limit exceeded/i.test(errorMsg)) && retryCount < MAX_NONCE_RETRIES) {
        const isWs = endpoint.includes('GetWebSocketsToken'); const baseDelay = isWs ? 3000 : 1500; const delay = baseDelay * Math.pow(2, retryCount) + Math.floor(Math.random() * 1000); await new Promise(r => setTimeout(r, delay)); return callKraken(apiKey, apiSecret, endpoint, data, retryCount + 1);
      }
      if (/nonce/i.test(errorMsg) && retryCount < MAX_NONCE_RETRIES) { await new Promise(r => setTimeout(r, 500 * Math.pow(2, retryCount))); return callKraken(apiKey, apiSecret, endpoint, data, retryCount + 1); }
      if (/signature/i.test(errorMsg)) throw new Error('Invalid signature - check API credentials.');
      if (/nonce/i.test(errorMsg)) throw new Error('Invalid nonce - enable Custom nonce window in Kraken API settings.');
      throw new Error(errorMsg);
    }
    return result;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('Kraken API timeout');
    throw e;
  }
}

function getSecrets(purpose) {
  const balKey = Deno.env.get('Kraken_API_Key');
  const balSecret = Deno.env.get('Kraken_API_Secret');
  const tradeKey = Deno.env.get('Trade_Key');
  const tradeSecret = Deno.env.get('Trade_Secret');
  if (purpose === 'trade') {
    if (!tradeKey || !tradeSecret) throw new Error('Missing Trade_Key/Trade_Secret in application secrets');
    return { apiKey: tradeKey.trim(), apiSecret: tradeSecret.trim() };
  }
  if (!balKey || !balSecret) throw new Error('Missing Kraken_API_Key/Kraken_API_Secret in application secrets');
  return { apiKey: balKey.trim(), apiSecret: balSecret.trim() };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const { action, payload } = body;
    if (!action) return Response.json({ error: 'Missing action', success: false }, { status: 400 });

    // Status uses presence of secrets
    if (action === 'status') {
      const hasBal = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
      const hasTrade = !!(Deno.env.get('Trade_Key') && Deno.env.get('Trade_Secret'));
      return Response.json({ success: true, connected: hasBal, trade_key_present: hasTrade }, { status: 200 });
    }

    if (action === 'connect' || action === 'disconnect') {
      return Response.json({ success: false, error: 'Connection is managed via Application Secrets. Set keys in Settings > Secrets.' }, { status: 200 });
    }

    // Helpers to choose creds
    const credsFor = (purpose) => {
      const useTrade = new Set(['getWebSocketUrl','getWebSocketToken']).has(purpose);
      const { apiKey, apiSecret } = getSecrets(useTrade ? 'trade' : 'balance');
      return { apiKey, apiSecret, keyType: useTrade ? 'trade' : 'balance' };
    };

    if (action === 'getBalance') {
      const { apiKey, apiSecret } = credsFor('getBalance');
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/Balance'));
      const result = await callKraken(apiKey, apiSecret, '/0/private/Balance', {});
      const raw = result.result || {};
      const balances = {};
      for (const [asset, amount] of Object.entries(raw)) {
        let a = asset; if (a.startsWith('X') && a.length === 4) a = a.substring(1); if (a.startsWith('Z') && a.length === 4) a = a.substring(1); if (a === 'XBT') a = 'BTC';
        balances[a] = parseFloat(amount) || 0;
      }
      return Response.json({ success: true, balance: balances, raw_balance: raw }, { status: 200 });
    }

    if (action === 'getExtendedBalance') {
      const { apiKey, apiSecret } = credsFor('getExtendedBalance');
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/BalanceEx'));
      const result = await callKraken(apiKey, apiSecret, '/0/private/BalanceEx', {});
      const raw = result.result || {};
      const balances = {};
      for (const [asset, info] of Object.entries(raw)) {
        let a = asset; if (a.startsWith('X') && a.length === 4) a = a.substring(1); if (a.startsWith('Z') && a.length === 4) a = a.substring(1); if (a === 'XBT') a = 'BTC';
        const available = parseFloat(info?.balance) || 0; const hold = parseFloat(info?.hold_trade) || 0; balances[a] = { balance: available, hold_trade: hold, total: available + hold, credit: parseFloat(info?.credit) || 0, credit_used: parseFloat(info?.credit_used) || 0 };
      }
      return Response.json({ success: true, balance: balances, raw_balance: raw }, { status: 200 });
    }

    if (action === 'getTradesHistory') {
      const { apiKey, apiSecret } = credsFor('getTradesHistory');
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/TradesHistory'));
      const result = await callKraken(apiKey, apiSecret, '/0/private/TradesHistory', { type: 'all' });
      const trades = [];
      for (const [txid, trade] of Object.entries(result.result?.trades || {})) {
        trades.push({ trade_id: txid, txid, ordertxid: trade.ordertxid, pair: trade.pair, time: trade.time, type: trade.type, ordertype: trade.ordertype, price: trade.price, cost: trade.cost, fee: trade.fee, vol: trade.vol, margin: trade.margin, misc: trade.misc, ...trade });
      }
      return Response.json({ success: true, trades, count: trades.length }, { status: 200 });
    }

    if (action === 'getOpenOrders') {
      const { apiKey, apiSecret } = credsFor('getOpenOrders');
      await getLimiter(user.email, 'balance').remove(endpointCost('/0/private/OpenOrders'));
      const result = await callKraken(apiKey, apiSecret, '/0/private/OpenOrders', { trades: true });
      const openOrders = [];
      for (const [orderId, order] of Object.entries(result.result?.open || {})) { openOrders.push({ order_id: orderId, ...order }); }
      return Response.json({ success: true, orders: openOrders, count: openOrders.length }, { status: 200 });
    }

    if (action === 'getWebSocketUrl' || action === 'getWebSocketToken') {
      try {
        const forceRefresh = !!payload?.forceRefresh;
        const keyType = (payload?.keyType === 'balance') ? 'balance' : 'trade';
        const { apiKey, apiSecret } = getSecrets(keyType === 'trade' ? 'trade' : 'balance');
        const fingerprint = `${keyType}:${String(apiKey).slice(0,6)}...${String(apiKey).slice(-4)}`;

        const cached = wsTokenCache.get(keyType);
        const now = Date.now();
        if (!forceRefresh && cached && cached.fingerprint === fingerprint && cached.expiresAt - now > 60000) {
          const remaining = Math.floor((cached.expiresAt - now) / 1000);
          return Response.json({ success: true, connected: true, wsUrl: 'wss://ws-auth.kraken.com/v2', publicWsUrl: 'wss://ws.kraken.com/v2', token: cached.token, expires_in: remaining, used_key_type: keyType, fingerprint, cached: true }, { status: 200 });
        }

        await getLimiter(user.email, keyType).remove(endpointCost('/0/private/GetWebSocketsToken'));
        let p = inFlight.get(keyType);
        if (!p || forceRefresh) {
          p = callKraken(apiKey, apiSecret, '/0/private/GetWebSocketsToken', {});
          inFlight.set(keyType, p);
        }
        const result = await p.finally(() => { inFlight.delete(keyType); });
        const token = result.result?.token; const expires = result.result?.expires || 900;
        if (!token) throw new Error('Failed to get WebSocket token from Kraken');
        wsTokenCache.set(keyType, { token, expiresAt: now + expires * 1000, fingerprint });
        return Response.json({ success: true, connected: true, wsUrl: 'wss://ws-auth.kraken.com/v2', publicWsUrl: 'wss://ws.kraken.com/v2', token, expires_in: expires, used_key_type: keyType, fingerprint }, { status: 200 });
      } catch (e) {
        return Response.json({ success: false, connected: false, error: e.message }, { status: 200 });
      }
    }

    if (action === 'getAssetPairs') {
      const pairsToFetch = payload?.pairs || 'BTCUSD,ETHUSD,SOLUSD';
      const controller = new AbortController(); const t = setTimeout(() => controller.abort(), 2000);
      try { const res = await fetch(`https://api.kraken.com/0/public/AssetPairs?pair=${pairsToFetch}`, { signal: controller.signal }); clearTimeout(t); const data = await res.json(); if (data.error?.length > 0) throw new Error(data.error.join(', ')); return Response.json({ success: true, pairs: data.result || {} }, { status: 200 }); } catch (err) { clearTimeout(t); throw err; }
    }

    return Response.json({ error: 'Unknown action', success: false }, { status: 400 });
  } catch (error) {
    console.error('[krakenApi] Error:', error.message);
    return Response.json({ error: error.message, success: false, connected: false }, { status: 200 });
  }
});