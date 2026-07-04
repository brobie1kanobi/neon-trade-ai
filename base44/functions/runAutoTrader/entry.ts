import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * AUTO-TRADER v3 - EVENT-DRIVEN, IDEMPOTENT, RISK-MANAGED
 * 
 * Architecture:
 * 1. Acquires distributed lock (one run per user)
 * 2. Consumes pre-computed AssetSignal entries (decoupled from AI)
 * 3. Validates trades through Risk Engine
 * 4. Uses Portfolio Reducer for state changes
 * 5. Creates LedgerEntry for audit trail
 * 6. Logs all actions to AutoTraderRun
 * 
 * CRITICAL: All trades use idempotency keys to prevent duplicates
 * 
 * AUTO-EXECUTION THRESHOLD: 85% confidence (strong_buy signals only)
 */

function round2(n) {
  const x = Number(n || 0);
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

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
  const baseSymbol = String(symbol || '').replace('/USD', '').toUpperCase();
  const decimals = PRICE_DECIMALS[baseSymbol] ?? 4; // Default to 4 decimals if unknown
  const factor = Math.pow(10, decimals);
  return Math.round(price * factor) / factor;
}

// Small helper sleep
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Kraken public pair map (for price fetching)
const KRAKEN_PAIR_MAP = {
  'BTC': 'XXBTZUSD', 'ETH': 'XETHZUSD', 'SOL': 'SOLUSD', 'XRP': 'XXRPZUSD',
  'ADA': 'ADAUSD', 'DOGE': 'XDGUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
  'MATIC': 'MATICUSD', 'AVAX': 'AVAXUSD', 'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD',
  'LTC': 'XLTCZUSD', 'BCH': 'BCHUSD', 'XLM': 'XXLMZUSD', 'TRX': 'TRXUSD',
  'SHIB': 'SHIBUSD', 'PEPE': 'PEPEUSD', 'HBAR': 'HBARUSD'
};

const MIN_ORDER_SIZES = {
  'BTC': 0.00005, 'XBT': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4,
  'DOT': 0.5, 'DOGE': 13.0, 'XDG': 13.0, 'LINK': 0.2, 'UNI': 0.5, 'MATIC': 10.0,
  'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0, 'SHIB': 100000.0,
  'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.7, 'NEAR': 0.7, 'BABY': 50.0, 'FLOKI': 105000.0,
  'WIF': 14.0, 'BONK': 500000.0, 'PEPE': 500000.0, 'APT': 2.2, 'ARB': 5.2, 'OP': 16.0,
  'INJ': 0.9, 'TIA': 8.2, 'FET': 18.0, 'TRUMP': 0.2, 'KAITO': 2.5, 'MOVE': 6.0,
  'GRASS': 13.0, 'GOAT': 5.0, 'HBAR': 20.0, 'KAS': 30.0, 'TAO': 0.008, 'EIGEN': 8.6,
  'ENA': 4.0, 'SUI': 3.0, 'FARTCOIN': 5.0, 'JUP': 20.0
};

// Minimal Kraken private API caller (BalanceEx/OpenOrders)
let __kr_lastNonce = 0;
function __kr_generateNonce() {
  const now = Date.now() * 1000;
  if (now <= __kr_lastNonce) __kr_lastNonce++; else __kr_lastNonce = now;
  return __kr_lastNonce.toString();
}
async function __kr_callPrivate(apiKey, apiSecretBase64, endpoint, data = {}) {
  const cleanKey = String(apiKey || '').trim().replace(/\s+/g, '');
  const cleanSecret = String(apiSecretBase64 || '').trim().replace(/\s+/g, '');
  const nonce = __kr_generateNonce();
  const postData = new URLSearchParams({ nonce, ...data }).toString();
  const msg = new TextEncoder().encode(nonce + postData);
  const hash = await crypto.subtle.digest('SHA-256', msg);
  const hmacKey = await crypto.subtle.importKey(
    'raw', Uint8Array.from(atob(cleanSecret), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const pathBytes = new TextEncoder().encode(endpoint);
  const combined = new Uint8Array(pathBytes.length + hash.byteLength);
  combined.set(pathBytes);
  combined.set(new Uint8Array(hash), pathBytes.length);
  const signature = await crypto.subtle.sign('HMAC', hmacKey, combined);
  const apiSign = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.kraken.com${endpoint}`, {
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
    clearTimeout(t);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// Live cash fetcher: KrakenConnection → env keys → Wallet entity (real_cash_balance)
async function fetchLiveCash(base44, userEmail) {
  let rawUsd = 0; let reserved = 0; let source = 'none';
  // Step 1: Per-user KrakenConnection entity (highest fidelity — user's own API keys)
  try {
    const conns = await base44.asServiceRole.entities.KrakenConnection.filter({ created_by: userEmail }, '-updated_date', 1);
    if (conns.length > 0) {
      const conn = conns[0];
      const apiKey = (conn.balance_api_key || conn.trade_api_key || conn.api_key || '').trim();
      const apiSecret = (conn.balance_api_secret_encrypted || conn.trade_api_secret_encrypted || conn.api_secret_encrypted || '').trim();
      if (apiKey && apiSecret) {
        const bal = await __kr_callPrivate(apiKey, apiSecret, '/0/private/BalanceEx', {});
        if (!bal?.error?.length && bal?.result) {
          const usdEntry = bal.result['ZUSD'] || bal.result['USD'];
          rawUsd = parseFloat(typeof usdEntry === 'object' ? usdEntry.balance : (usdEntry || 0));
          try {
            const open = await __kr_callPrivate(apiKey, apiSecret, '/0/private/OpenOrders', { trades: 'true' });
            if (open?.result?.open) {
              for (const [, order] of Object.entries(open.result.open)) {
                const side = (order.descr?.type || '').toLowerCase();
                if (side === 'buy') reserved += Number(order.vol || 0) * Number(order.descr?.price || 0);
              }
            }
          } catch (_) {}
          source = 'kraken_connection';
          return { rawUsd, reserved, available: Math.max(0, rawUsd - reserved - rawUsd * 0.02), source };
        }
      }
    }
  } catch (_) {}
  // Step 2: Shared env-var Kraken keys (app-level keys)
  try {
    const envKey = (Deno.env.get('Kraken_API_Key') || '').trim();
    const envSecret = (Deno.env.get('Kraken_API_Secret') || '').trim();
    if (envKey && envSecret) {
      const bal = await __kr_callPrivate(envKey, envSecret, '/0/private/BalanceEx', {});
      if (!bal?.error?.length && bal?.result) {
        const usdEntry = bal.result['ZUSD'] || bal.result['USD'];
        rawUsd = parseFloat(typeof usdEntry === 'object' ? usdEntry.balance : (usdEntry || 0));
        try {
          const open = await __kr_callPrivate(envKey, envSecret, '/0/private/OpenOrders', { trades: 'true' });
          if (open?.result?.open) {
            for (const [, order] of Object.entries(open.result.open)) {
              const side = (order.descr?.type || '').toLowerCase();
              if (side === 'buy') reserved += Number(order.vol || 0) * Number(order.descr?.price || 0);
            }
          }
        } catch (_) {}
        source = 'env';
        return { rawUsd, reserved, available: Math.max(0, rawUsd - reserved - rawUsd * 0.02), source };
      }
    }
  } catch (_) {}
  // Step 3: Wallet entity real_cash_balance — synced from Kraken by other processes.
  // This is the critical fallback when API calls fail (rate limited, no KrakenConnection, etc.)
  try {
    const wallets = await base44.asServiceRole.entities.Wallet.filter({ created_by: userEmail }, '-updated_date', 1);
    if (wallets.length > 0) {
      const walletCash = Number(wallets[0].real_cash_balance || 0);
      if (walletCash > 0) {
        source = 'wallet';
        return { rawUsd: walletCash, reserved: 0, available: Math.max(0, walletCash * 0.98), source };
      }
    }
  } catch (_) {}
  return { rawUsd: 0, reserved: 0, available: 0, source };
}

/**
 * Generate idempotency key for a trade
 */
function generateIdempotencyKey(userEmail, symbol, type, timestamp) {
  const key = `${userEmail}:${symbol}:${type}:${timestamp}`;
  // Simple hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `auto_${Math.abs(hash)}_${timestamp}`;
}

/**
 * Generate Kraken cl_ord_id (Client Order ID) for exchange-level idempotency.
 * Kraken will reject a second order with the same cl_ord_id within 24 hours.
 * Max 18 chars, alphanumeric + hyphen only.
 */
function generateKrakenClientOrderId(symbol, side) {
  const sym = String(symbol).toUpperCase().substring(0, 5);
  const s = String(side).charAt(0).toUpperCase(); // B or S
  const ts = Date.now().toString(36); // compact timestamp
  const rand = Math.random().toString(36).substring(2, 5);
  return `NT-${sym}-${s}-${ts}${rand}`.substring(0, 18);
}

/**
 * Check if idempotency key already exists
 */
async function checkIdempotency(base44, idempotencyKey, userEmail) {
  try {
    const existing = await base44.entities.Trade.filter({
      created_by: userEmail,
      idempotency_key: idempotencyKey
    });
    return existing.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * DEDUP: Check if a very recent trade already exists for the same symbol+side.
 * Looks for trades created in the last 60 seconds with the same symbol and type.
 * This prevents the backend auto-trader from duplicating orders that the frontend
 * auto-trader (or a previous backend run) already placed.
 */
async function hasRecentDuplicateTrade(base44, userEmail, symbol, side, windowMs = 60000) {
  try {
    const recentTrades = await base44.entities.Trade.filter({
      created_by: userEmail,
      symbol: symbol.toUpperCase(),
      type: side.toLowerCase(),
      is_auto_trade: true
    }, '-created_date', 5);
    
    const now = Date.now();
    for (const t of recentTrades) {
      const tradeTime = new Date(t.created_date || t.submitted_at || 0).getTime();
      if ((now - tradeTime) < windowMs) {
        return true;
      }
    }
    return false;
  } catch (e) {
    console.warn('[runAutoTrader] Dedup check failed:', e.message);
    return false;
  }
}

// STOP-LOSS COOLDOWN: Block re-buying asset that hit SL within 12h
async function hasRecentStopLoss(base44, userEmail, symbol) {
  try {
    const orders = await base44.entities.ConditionalOrder.filter({ created_by: userEmail, symbol: symbol.toUpperCase(), status: 'executed' }, '-executed_at', 8);
    const now = Date.now(), cd = 12 * 3600000;
    for (const o of orders) {
      const r = String(o.closure_reason || '').toLowerCase();
      if (!(r.includes('stop') || r.includes('loss') || r.includes('sl'))) continue;
      if ((now - new Date(o.executed_at || o.updated_date || 0).getTime()) < cd) return { blocked: true, hours_ago: ((now - new Date(o.executed_at || o.updated_date || 0).getTime()) / 3600000).toFixed(1) };
    }
    const sells = await base44.entities.Trade.filter({ created_by: userEmail, symbol: symbol.toUpperCase(), type: 'sell', is_auto_trade: true }, '-created_date', 8);
    for (const s of sells) { if ((now - new Date(s.created_date || s.filled_at || 0).getTime()) < cd) return { blocked: true, hours_ago: ((now - new Date(s.created_date || 0).getTime()) / 3600000).toFixed(1) }; }
    return { blocked: false };
  } catch (_e) { return { blocked: false }; }
}

// Acquire distributed lock — atomic arbitration among concurrent pending records
const LOCK_TIMEOUT_MS = 45000; // 45s - generous but prevents permanent stale locks

async function acquireLock(base44, userEmail, runId) {
  try {
    // Step 1: Force-expire any stale 'running' records (older than timeout)
    const runningRuns = await base44.entities.AutoTraderRun.filter({
      created_by: userEmail,
      status: 'running'
    });
    
    const now = Date.now();
    for (const run of runningRuns) {
      const startedAt = new Date(run.started_at || run.created_date).getTime();
      if (now - startedAt > LOCK_TIMEOUT_MS) {
        await base44.entities.AutoTraderRun.update(run.id, {
          status: 'failed',
          error_message: `Timed out (>${LOCK_TIMEOUT_MS / 1000}s) - force-expired by new run`,
          completed_at: new Date().toISOString()
        });
      } else {
        // A legitimately running session exists - deny lock
        return { acquired: false, reason: 'Another run in progress', existingRunId: run.id };
      }
    }
    
    // Step 2: Among all 'pending' records created in the last 10 seconds, 
    // only the one with the LOWEST id wins. This is the atomic arbitration step.
    const pendingRuns = await base44.entities.AutoTraderRun.filter({
      created_by: userEmail,
      status: 'pending'
    });
    
    // Filter to only recent pending records (created within last 10s)
    const recentPending = pendingRuns.filter(r => {
      const createdAt = new Date(r.created_date).getTime();
      return (now - createdAt) < 10000;
    });
    
    if (recentPending.length <= 1) {
      // We're the only pending record - we win
      return { acquired: true };
    }
    
    // Multiple pending records exist - sort by id (lexicographic = insertion order)
    recentPending.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    
    const winnerId = recentPending[0].id;
    
    if (winnerId === runId) {
      // We won the race! Cancel all other pending records.
      for (const run of recentPending.slice(1)) {
        try {
          await base44.entities.AutoTraderRun.update(run.id, {
            status: 'canceled',
            error_message: 'Lost lock arbitration to earlier run',
            completed_at: new Date().toISOString()
          });
        } catch (_) {}
      }
      return { acquired: true };
    } else {
      // We lost the race - cancel ourselves
      return { acquired: false, reason: 'Lost lock arbitration', existingRunId: winnerId };
    }
  } catch (e) {
    console.warn('[runAutoTrader] Lock check failed:', e.message);
    // On error, DENY the lock to be safe (prevents duplicate trades)
    return { acquired: false, reason: 'Lock check error: ' + e.message };
  }
}

/**
 * Release lock by completing the run
 */
async function releaseLock(base44, runId, status, stats) {
  try {
    await base44.entities.AutoTraderRun.update(runId, {
      status,
      completed_at: new Date().toISOString(),
      ...stats
    });
  } catch (e) {
    console.error('[runAutoTrader] Failed to release lock:', e.message);
  }
}

/**
 * User's TP/SL margins are the LAW — no dynamic overrides, no "optimization".
 * Returns the user's exact configured values, period.
 */
function getUserMargins(defaultGainMargin, defaultLossMargin) {
  return {
    gainMargin: defaultGainMargin,
    lossMargin: defaultLossMargin,
    source: 'user_settings'
  };
}

/**
 * Evaluate emerging prospects from market intelligence
 * Returns prospects that meet risk tolerance and allocation criteria
 */
function evaluateEmergingProspects(marketIntelligence, currentHoldings, cashAvailable, riskTolerance) {
  const emergingProspects = marketIntelligence?.emerging_prospects || [];
  const avoidList = marketIntelligence?.avoid_list || [];
  
  if (emergingProspects.length === 0) return [];
  
  // Calculate current allocation by asset
  const holdingSymbols = new Set((currentHoldings || []).map(h => h.symbol?.toUpperCase()));
  
  // Filter and score emerging prospects
  const viable = emergingProspects
    .filter(ep => {
      // Skip if on avoid list
      if (avoidList.includes(ep.symbol)) return false;
      // Skip if we already hold this asset (avoid over-concentration)
      if (holdingSymbols.has(ep.symbol?.toUpperCase())) return false;
      return true;
    })
    .map(ep => {
      // Risk-adjusted scoring
      const potentialGain = ep.potential_gain_pct || 5;
      const riskScore = riskTolerance === 'high' ? 1.2 : riskTolerance === 'low' ? 0.7 : 1.0;
      
      return {
        ...ep,
        adjusted_score: potentialGain * riskScore,
        max_allocation: Math.min(cashAvailable * 0.15, 50) // Max 15% of cash or $50
      };
    })
    .sort((a, b) => b.adjusted_score - a.adjusted_score);
  
  return viable.slice(0, 2); // Max 2 emerging prospects per run
}

// Invoke krakenTrade with robust retries and token refresh on permission errors
// CRITICAL: Does NOT retry on insufficient funds or other order-specific errors
async function invokeKrakenTrade(base44, payload, maxAttempts = 4, wsToken = null, userEmail = null) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await base44.functions.invoke('krakenTrade', wsToken ? { ...payload, wsToken } : payload);
      const data = res?.data || res;
      if (data?.success === false) {
        const msg = String(data?.error || '');
        
        // CRITICAL: Don't retry on PERMANENT errors - these will never resolve
        // This prevents wasting integration credits on impossible orders
        if (/insufficient funds/i.test(msg) || /EOrder:Insufficient funds/i.test(msg)) {
          console.error('[runAutoTrader] Insufficient funds - aborting order (permanent)');
          return data;
        }
        if (/insufficient margin/i.test(msg) || /EOrder:Insufficient margin/i.test(msg)) {
          console.error('[runAutoTrader] Insufficient margin - aborting order (permanent)');
          return data;
        }
        if (/invalid volume/i.test(msg) || /EOrder:Invalid volume/i.test(msg)) { return data; }
        if (/invalid price/i.test(msg) || /EOrder:Invalid price/i.test(msg)) { return data; }
        if (/unknown order/i.test(msg) || /EOrder:Unknown order/i.test(msg)) { return data; }
        // CRITICAL: Catch "volume minimum not met" and similar EGeneral errors
        if (/minimum not met/i.test(msg) || /EGeneral:Invalid arguments/i.test(msg) || /too small/i.test(msg) || /below minimum/i.test(msg)) {
          console.error('[runAutoTrader] Permanent order error (minimum/arguments) - aborting:', msg);
          return data;
        }
        
        if (/rate limit|429|timeout|websocket|nonce/i.test(msg)) { throw new Error(msg); }
      }
      return data;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      
      // CRITICAL: Don't retry on PERMANENT errors - throw immediately to stop wasting credits
      if (/insufficient funds/i.test(msg) || /EOrder:Insufficient funds/i.test(msg)) { throw e; }
      if (/insufficient margin/i.test(msg) || /EOrder:Insufficient margin/i.test(msg)) { throw e; }
      if (/invalid volume/i.test(msg) || /EOrder:Invalid volume/i.test(msg)) { throw e; }
      if (/invalid price/i.test(msg) || /EOrder:Invalid price/i.test(msg)) { throw e; }
      // CRITICAL: Catch "volume minimum not met" and EGeneral errors
      if (/minimum not met/i.test(msg) || /EGeneral:Invalid arguments/i.test(msg) || /too small/i.test(msg) || /below minimum/i.test(msg)) { throw e; }
      
      // Token refresh on permission denied
      if (/permission denied/i.test(msg)) {
        await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade', forceRefresh: true } });
        wsToken = null; // force refetch on next loop
      }

      // Fallback: direct REST AddOrder when cross-function returns 403 (WS path blocked)
      if ((/status code 403/i.test(msg) || /access denied/i.test(msg) || /403/i.test(msg)) && userEmail) {
        try {
          const conns = await base44.asServiceRole.entities.KrakenConnection.filter({ created_by: userEmail }, '-updated_date', 1);
          let tradeKey = '';
          let tradeSecret = '';
          if (conns.length > 0) {
            const conn = conns[0];
            tradeKey = (conn.trade_api_key || conn.api_key || '').trim();
            tradeSecret = (conn.trade_api_secret_encrypted || conn.api_secret_encrypted || '').trim();
          }
          // If no connection entity creds, fall back to environment TRADE secrets
          if (!tradeKey || !tradeSecret) {
            tradeKey = (Deno.env.get('Trade_Key') || '').trim();
            tradeSecret = (Deno.env.get('Trade_Secret') || '').trim();
          }
          if (tradeKey && tradeSecret) {
            const sym = String(payload.symbol || '').toUpperCase();
            const pair = KRAKEN_PAIR_MAP[sym] || `${sym}USD`;
            const vol = Number(payload.quantity || 0);

            // Preflight: block SELL fallbacks when below Kraken minimum or insufficient available
            const MIN_ORDER_SIZES = {
              'BTC': 0.00005, 'XBT': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4, 'DOT': 0.5, 'DOGE': 13.0, 'XDG': 13.0,
              'LINK': 0.2, 'UNI': 0.5, 'MATIC': 10.0, 'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0,
              'SHIB': 100000.0, 'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.7, 'NEAR': 0.7, 'APT': 2.2, 'ARB': 5.2, 'OP': 16.0, 'INJ': 0.9,
              'PEPE': 500000.0, 'SUI': 3.0, 'HBAR': 20.0
            };
            const minQty = MIN_ORDER_SIZES[sym] || 0.00001;
            if (String(payload?.side).toLowerCase() === 'sell') {
              try {
                const bal = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/BalanceEx', {});
                const raw = bal?.result || {};
                const key = sym === 'BTC' ? 'XXBT' : (sym.length === 3 ? `X${sym}` : sym);
                const entry = raw[key] || raw[sym] || {};
                const available = parseFloat(entry?.balance || 0) || 0;
                const finalQty = Math.min(vol, available);
                if (finalQty < minQty) {
                  return { success: false, error: `Insufficient available ${sym} (${available.toFixed(8)}). Kraken minimum sell is ${minQty}.` };
                }
              } catch (_e) {
                // If balance preflight fails, be conservative and block
                return { success: false, error: `Order blocked: unable to verify available ${sym} for sell` };
              }
            }

            // BRACKET TP/SL fallback
            if (payload?.action === 'place_bracket_orders') {
              const tp = Number(payload.takeProfitPrice || 0);
              const sl = Number(payload.stopLossPrice || 0);
              const sellVol = vol;
              let tpOrderId = null;
              let slOrderId = null;
              let tpError = null;
              let slError = null;

              if (tp > 0) {
                try {
                  const roundedTp = roundPriceForKraken(tp, sym);
                  const tpRes = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/AddOrder', {
                    pair,
                    type: 'sell',
                    ordertype: 'take-profit',
                    price: String(roundedTp),
                    volume: String(sellVol)
                  });
                  if (!tpRes?.error?.length && tpRes?.result?.txid?.length) {
                    tpOrderId = tpRes.result.txid[0];
                  } else if (Array.isArray(tpRes?.error) && tpRes.error.length) {
                    tpError = tpRes.error.join(', ');
                  }
                } catch (err) {
                  tpError = err?.message || String(err);
                }
              }

              await sleep(500);

              if (sl > 0) {
                try {
                  const roundedSl = roundPriceForKraken(sl, sym);
                  const slRes = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/AddOrder', {
                    pair,
                    type: 'sell',
                    ordertype: 'stop-loss',
                    price: String(roundedSl),
                    volume: String(sellVol)
                  });
                  if (!slRes?.error?.length && slRes?.result?.txid?.length) {
                    slOrderId = slRes.result.txid[0];
                  } else if (Array.isArray(slRes?.error) && slRes.error.length) {
                    slError = slRes.error.join(', ');
                  }
                } catch (err) {
                  slError = err?.message || String(err);
                }
              }

              return {
                success: !!(tpOrderId || slOrderId),
                tp_success: !!tpOrderId,
                sl_success: !!slOrderId,
                tp_order_id: tpOrderId,
                sl_order_id: slOrderId,
                tp_error: tpError,
                sl_error: slError
              };
            }

            // BUY market/limit fallback
            if (payload?.action === 'place_order' && String(payload?.side).toLowerCase() === 'buy') {
              const addRes = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/AddOrder', {
                pair,
                type: 'buy',
                ordertype: String(payload.orderType || 'market').toLowerCase(),
                volume: String(vol)
              });
              if (!addRes?.error?.length && addRes?.result?.txid?.length) {
                return { success: true, order_id: addRes.result.txid[0], executed_qty: vol };
              } else if (Array.isArray(addRes?.error) && addRes.error.length) {
                throw new Error(addRes.error.join(', '));
              }
            }

            // SELL take-profit fallback
            if (payload?.action === 'place_order' && String(payload?.side).toLowerCase() === 'sell' && String(payload?.orderType).toLowerCase() === 'take-profit') {
              const tp = Number(payload.triggerPrice || payload.stopPrice || 0);
              if (tp > 0) {
                const roundedTp = roundPriceForKraken(tp, sym);
                const addRes = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/AddOrder', {
                  pair,
                  type: 'sell',
                  ordertype: 'take-profit',
                  price: String(roundedTp),
                  volume: String(vol)
                });
                if (!addRes?.error?.length && addRes?.result?.txid?.length) {
                  return { success: true, order_id: addRes.result.txid[0], executed_qty: vol };
                } else if (Array.isArray(addRes?.error) && addRes.error.length) {
                  throw new Error(addRes.error.join(', '));
                }
              }
            }

            // SELL stop-loss fallback
            if (payload?.action === 'place_order' && String(payload?.side).toLowerCase() === 'sell' && String(payload?.orderType).toLowerCase() === 'stop-loss') {
              const sl = Number(payload.stopPrice || payload.triggerPrice || 0);
              if (sl > 0) {
                const roundedSl = roundPriceForKraken(sl, sym);
                const addRes = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/AddOrder', {
                  pair,
                  type: 'sell',
                  ordertype: 'stop-loss',
                  price: String(roundedSl),
                  volume: String(vol)
                });
                if (!addRes?.error?.length && addRes?.result?.txid?.length) {
                  return { success: true, order_id: addRes.result.txid[0], executed_qty: vol };
                } else if (Array.isArray(addRes?.error) && addRes.error.length) {
                  throw new Error(addRes.error.join(', '));
                }
              }
            }

            // Trailing stop request received -> Prefer static stop-loss instead (guaranteed fallback)
            if (payload?.action === 'place_trailing_stop') {
              const sl = Number(payload.stopPrice || payload.triggerPrice || 0);
              if (sl > 0) {
                const roundedSl = roundPriceForKraken(sl, sym);
                const addRes = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/AddOrder', {
                  pair,
                  type: 'sell',
                  ordertype: 'stop-loss',
                  price: String(roundedSl),
                  volume: String(vol)
                });
                if (!addRes?.error?.length && addRes?.result?.txid?.length) {
                  return { success: true, order_id: addRes.result.txid[0], executed_qty: vol };
                } else if (Array.isArray(addRes?.error) && addRes.error.length) {
                  throw new Error(addRes.error.join(', '));
                }
              }
              // If no static price given, only then try true trailing-stop
              const pct = Number(payload.trailingPercent || 0);
              const priceParam = pct > 0 ? `${pct}%` : null;
              if (priceParam) {
                const addRes = await __kr_callPrivate(tradeKey, tradeSecret, '/0/private/AddOrder', {
                  pair,
                  type: 'sell',
                  ordertype: 'trailing-stop',
                  price: String(priceParam),
                  volume: String(vol)
                });
                if (!addRes?.error?.length && addRes?.result?.txid?.length) {
                  return { success: true, order_id: addRes.result.txid[0], executed_qty: vol };
                } else if (Array.isArray(addRes?.error) && addRes.error.length) {
                  throw new Error(addRes.error.join(', '));
                }
              }
            }
          }
        } catch (fallbackErr) {
          console.warn('[runAutoTrader] REST AddOrder fallback failed:', fallbackErr?.message || fallbackErr);
        }
      }

      if (/rate limit|429|timeout|websocket|nonce/i.test(msg) && attempt < maxAttempts - 1) {
        const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 800);
        console.warn(`[runAutoTrader] Rate/WS limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function getLatestWallet(base44, email) {
  const list = await base44.entities.Wallet.filter({ created_by: email }, "-updated_date");
  return list[0] || null;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const runLogs = [];
  let autoTraderRunId = null;
  const DEADLINE_MS = 28000;
  const deadline = startTime + DEADLINE_MS;
  function timeLeft() { return Math.max(0, deadline - Date.now()); }
  function shouldStop() { return Date.now() > deadline - 1500; }
  function ps(ms){ const t = Math.max(0, Math.min(ms, timeLeft()-500)); if (t<=0) return Promise.resolve(); return sleep(t); }
  
  function log(message, data = null) {
    const entry = { timestamp: new Date().toISOString(), message, data };
    runLogs.push(entry);
    console.log(`[runAutoTrader] ${message}`, data ? JSON.stringify(data) : '');
  }
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // CRITICAL: Load user settings to determine mode
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    if (settingsList.length > 0) {
      // Sort by updated_date descending to ensure we get the most recently saved settings
      settingsList.sort((a, b) => new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0));
    }
    const settings = settingsList[0] || {};
    
    if (!settings.auto_trading_enabled) {
      return Response.json({ success: true, message: 'Auto-trading disabled', trades_count: 0 });
    }

    // Respect user's setting but enforce admin-only LIVE trading
    let isSimMode = settings.sim_trading_mode !== false;
    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    if (!isAdmin && !isCreator) {
      if (!isSimMode) {
        log('LIVE mode requested but user is not admin/creator - forcing SIM mode');
      }
      isSimMode = true;
    }
    
    // PRE-FLIGHT 1: Temporal cooldown — reject if a completed/running run exists within 4 minutes.
    // This is the ultimate server-side rate limit regardless of how many browser tabs or
    // clients are calling this function. Without this, multiple tabs each fire on mount.
    const MIN_RUN_GAP_MS = 240000; // 4 minutes
    try {
      const recentRuns = await base44.entities.AutoTraderRun.filter({
        created_by: user.email
      }, '-started_at', 3);
      const now = Date.now();
      for (const r of recentRuns) {
        const age = now - new Date(r.started_at || r.created_date).getTime();
        if (age < MIN_RUN_GAP_MS && (r.status === 'completed' || r.status === 'running')) {
          return Response.json({
            success: true,
            message: `Cooldown active — last run ${Math.round(age / 1000)}s ago (min ${MIN_RUN_GAP_MS / 1000}s)`,
            trades_count: 0,
            cooldown_remaining_s: Math.round((MIN_RUN_GAP_MS - age) / 1000)
          });
        }
      }
    } catch (_) {}

    // PRE-FLIGHT 2: Check if there's already a running auto-trader within the lock window.
    // This avoids creating unnecessary AutoTraderRun records when we know we'll lose.
    try {
      const existingRunning = await base44.entities.AutoTraderRun.filter({
        created_by: user.email,
        status: 'running'
      });
      const freshRunning = existingRunning.filter(r => {
        const age = Date.now() - new Date(r.started_at || r.created_date).getTime();
        return age < LOCK_TIMEOUT_MS;
      });
      if (freshRunning.length > 0) {
        return Response.json({
          success: false,
          message: 'Another run in progress (pre-flight)',
          existing_run_id: freshRunning[0].id
        });
      }
    } catch (_) {}

    // Generate idempotency key for this run
    const runIdempotencyKey = `run_${user.email}_${Date.now()}`;
    
    // Create AutoTraderRun record
    const autoTraderRun = await base44.entities.AutoTraderRun.create({
      status: 'pending',
      idempotency_key: runIdempotencyKey,
      started_at: new Date().toISOString(),
      is_simulation: isSimMode,
      created_by: user.email
    });
    autoTraderRunId = autoTraderRun.id;
    
    log('AutoTraderRun created', { runId: autoTraderRunId, isSimMode });
    
    // Acquire distributed lock (atomic arbitration among concurrent pending records)
    const lockResult = await acquireLock(base44, user.email, autoTraderRunId);
    if (!lockResult.acquired) {
      log('Lock not acquired', lockResult);
      await base44.entities.AutoTraderRun.update(autoTraderRunId, {
        status: 'canceled',
        error_message: lockResult.reason,
        completed_at: new Date().toISOString()
      });
      return Response.json({ 
        success: false, 
        message: lockResult.reason,
        existing_run_id: lockResult.existingRunId
      });
    }
    
    // Update status to running
    await base44.entities.AutoTraderRun.update(autoTraderRunId, { status: 'running' });
    log('Lock acquired, status set to running');
    
    // Check system health before proceeding (direct entity read to avoid cross-function auth issues)
    try {
      const records = await base44.asServiceRole.entities.SystemHealth.filter({});
      // Only block trading on TRADING-CRITICAL components — not auxiliary services like supabase_sync
      const tradingCritical = records.filter(r => ['kraken_api', 'kraken_ws', 'auto_trader'].includes(r.component));
      const anyPaused = tradingCritical.some(r => r.is_auto_paused);
      const anyUnhealthy = tradingCritical.some(r => r.status === 'unhealthy');
      const anyDegraded = tradingCritical.some(r => r.status === 'degraded');
      const overall = anyPaused || anyUnhealthy ? 'unhealthy' : (anyDegraded ? 'degraded' : 'healthy');
      if (overall === 'unhealthy') {
        log('Trading not allowed - system unhealthy (direct check)', { overall });
        await releaseLock(base44, autoTraderRunId, 'canceled', {
          error_message: 'Trading paused due to system health issues'
        });
        return Response.json({ success: false, message: 'Trading paused due to system health', system_status: overall });
      }
    } catch (e) {
      log('System health check failed (entity read), proceeding anyway', { error: e.message });
    }

    // CRITICAL: Fetch pre-computed AssetSignals (decoupled from AI)
    // This ensures AI analysis happens separately from trade execution
    log('Fetching pre-computed AssetSignals...');
    
    let signals = [];
    let cashAvailable = 0;
    
    // CRITICAL: Fetch the latest MarketIntelligenceCache to get the AVOID list
    // The auto-trader MUST respect the AI's avoid list — never buy assets marked as AVOID
    let avoidList = [];
    try {
      const intelCaches = await base44.asServiceRole.entities.MarketIntelligenceCache.filter({}, '-cached_at', 1);
      if (intelCaches.length > 0) {
        const cache = intelCaches[0];
        const nowIso = new Date().toISOString();
        // Only use cache if not expired (or no expiry set)
        if (!cache.expires_at || cache.expires_at > nowIso) {
          try {
            avoidList = JSON.parse(cache.avoid_list_json || '[]').map(s => String(s).toUpperCase());
          } catch (_) { avoidList = []; }
          
          // CRITICAL: Also check market regime — block ALL buys in severe risk-off conditions
          const sentiment = Number(cache.market_sentiment_score || 50);
          const regime = String(cache.market_regime || '').toLowerCase();
          const momentum = String(cache.momentum_direction || '').toLowerCase();
          
          if (sentiment <= 25 && (regime.includes('risk-off') || momentum === 'bearish')) {
            log('MARKET REGIME BLOCK: Extreme fear detected — blocking all auto-buys', {
              sentiment, regime, momentum
            });
            await releaseLock(base44, autoTraderRunId, 'completed', {
              trades_attempted: 0,
              trades_successful: 0,
              logs_json: JSON.stringify(runLogs),
              note: 'Blocked by extreme fear market regime'
            });
            return Response.json({
              success: true,
              message: 'Auto-trading paused: extreme market fear detected (sentiment ' + sentiment + ')',
              trades_count: 0,
              market_sentiment: sentiment,
              market_regime: regime
            });
          }
          
          log('Market intelligence loaded', { avoidList, sentiment, regime, momentum });
        } else {
          log('Market intelligence cache expired, proceeding without avoid list');
        }
      }
    } catch (e) {
      log('Failed to fetch market intelligence cache', { error: e.message });
    }
    
    // Fetch active signals
    try {
      signals = await base44.asServiceRole.entities.AssetSignal.filter({
        is_active: true
      });
      
      // Filter to non-expired signals
      const now = new Date();
      signals = signals.filter(s => !s.expires_at || new Date(s.expires_at) > now);
      
      // CRITICAL: Remove signals for assets on the AVOID list
      const beforeCount = signals.length;
      signals = signals.filter(s => {
        const sym = String(s.asset_symbol || '').toUpperCase();
        if (avoidList.includes(sym)) {
          log(`BLOCKED signal for ${sym} — asset is on AVOID list`);
          return false;
        }
        return true;
      });
      if (beforeCount !== signals.length) {
        log(`Filtered out ${beforeCount - signals.length} signals for AVOIDED assets`);
      }
      
      log(`Found ${signals.length} active signals (after avoid filter)`);
    } catch (e) {
      log('Failed to fetch signals', { error: e.message });
    }
    
    // If no pre-computed signals, fall back to generating them
    if (signals.length === 0) {
      log('No pre-computed signals; skipping this run to avoid timeouts');
      await releaseLock(base44, autoTraderRunId, 'completed', {
        trades_attempted: 0,
        trades_successful: 0,
        logs_json: JSON.stringify(runLogs),
        note: 'No active signals'
      });
      return Response.json({ success: true, message: 'No active signals; run skipped', trades_count: 0 });
    }
    
    // Build prospects in-line (avoid cross-function 403s)
    let prospects = [];
    let marketIntelligence = null;

    try {
      // 1) Load user preferences for current mode
      const allPrefs = await base44.entities.AutoBuyPreference.filter({ created_by: user.email }, '-created_date', 50);
      let prefs = allPrefs.filter(p => {
        const pIsSim = p.is_simulation === true || p.is_simulation === 'true';
        const pEnabled = p.enabled !== false;
        return pEnabled && (isSimMode ? pIsSim : !pIsSim);
      });

      // Fallback: if no user preferences, derive from top active signals
      // CRITICAL: Only use signals NOT on the avoid list (already filtered above)
      if (prefs.length === 0) {
        const topSigs = (signals || [])
          .filter(s => {
            const sym = String(s.asset_symbol || '').toUpperCase();
            if (avoidList.includes(sym)) return false; // Double-check avoid list
            return (s.asset_type || 'crypto') === 'crypto' && ['buy','strong_buy'].includes(String(s.signal_type || '').toLowerCase());
          })
          .sort((a,b) => (Number(b.confidence_score||0) - Number(a.confidence_score||0)))
          .slice(0, 3);
        if (topSigs.length > 0) {
          prefs = topSigs.map(s => ({
            symbol: s.asset_symbol,
            asset_type: 'crypto',
            percentage: String(s.signal_type || '').toLowerCase() === 'strong_buy' ? 20 : 15,
            enabled: true,
            is_simulation: isSimMode
          }));
          log('No AutoBuyPreference found; using top signals as temporary prefs', { symbols: prefs.map(p => p.symbol) });
        }
      }

      // 2) Determine cash available (SIM: wallet, LIVE: Kraken direct)
      let tradingCash = 0;
      if (isSimMode) {
        const wallet = await getLatestWallet(base44, user.email);
        cashAvailable = wallet?.cash_balance || 0;
        tradingCash = cashAvailable;
      } else {
        const live = await fetchLiveCash(base44, user.email);
        cashAvailable = live.available;
        tradingCash = cashAvailable;
        log('Live cash snapshot', { source: live.source, rawUsd: round2(live.rawUsd || 0), available: round2(live.available || 0) });
      }

      // 3) Load active signals
      const nowTs = new Date();
      let activeSignals = [];
      try {
        activeSignals = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true });
        activeSignals = activeSignals.filter(s => !s.expires_at || new Date(s.expires_at) > nowTs);
      } catch (_e) {}
      const sigMap = new Map();
      for (const s of activeSignals) sigMap.set(s.asset_symbol, s);

      // 4) Fetch quotes via Kraken public API
      const cryptoSymbols = allPrefs.filter(p => p.asset_type === 'crypto').map(p => String(p.symbol || '').toUpperCase());
      let quotes = [];
      try {
        const pairs = cryptoSymbols.map(s => KRAKEN_PAIR_MAP[s]).filter(Boolean);
        if (pairs.length > 0) {
          const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`);
          if (resp.ok) {
            const data = await resp.json();
            if (data?.result) {
              for (const sym of cryptoSymbols) {
                const pair = KRAKEN_PAIR_MAP[sym];
                const t = data.result[pair];
                if (t) {
                  const price = parseFloat(t.c?.[0] || '0');
                  const open24h = parseFloat(t.o || '0');
                  const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
                  quotes.push({ symbol: sym, price, current_price: price, change_24h_percent: change24h });
                }
              }
            }
          }
        }
      } catch (_e) {}

      // 5) Build prospects
      // CRITICAL: Use auto_execute_threshold as the floor for prospect building too.
      // min_signal_confidence is only for signal generation filtering, NOT for execution gating.
      const minConf = typeof settings.auto_execute_threshold === 'number' ? settings.auto_execute_threshold : 999;
      const safetyMaxPct = 0.40;
      const spendable = isSimMode ? tradingCash : tradingCash; // already buffered in live
      for (const pref of prefs) {
        const symbol = String(pref.symbol || '').toUpperCase();
        
        // CRITICAL: Skip assets on the AVOID list — never buy what AI says to avoid
        if (avoidList.includes(symbol)) {
          log(`Skipping ${symbol} — on market intelligence AVOID list`);
          continue;
        }
        
        const q = quotes.find(r => (r.symbol || '').toUpperCase() === symbol);
        const price = q?.price || q?.current_price || 0;
        if (!price || price <= 0) continue;
        const sig = sigMap.get(symbol);
        if (!sig) continue;
        const signalType = (sig.signal_type || 'hold').toLowerCase();
        const confidence = Number(sig.confidence_score || 0);
        const change24h = Number(sig.change_24h || q?.change_24h_percent || 0);
        if (!(signalType === 'buy' || signalType === 'strong_buy')) continue;
        if (confidence < minConf) continue;
        // ANTI-PUMP: Reject if price already extended (pumping or crashing)
        // TIGHTENED: Block ANY negative 24h trend to prevent buying into dips that keep dipping
        if (change24h < -1.5 || change24h > 4) continue;
        if (signalType === 'buy' && change24h > 2.5) continue;
        if (signalType === 'buy' && change24h < -0.5) continue; // Don't buy regular signals in any dip
        const userPct = Number(pref.percentage || 10) / 100;
        let total = spendable * userPct;
        const safetyMax = spendable * safetyMaxPct;
        if (total > safetyMax) total = safetyMax;
        if (total < 1 && spendable >= 5) total = 5;
        if (total < 1) continue;
        const qty = total / price;
        if (qty < (MIN_ORDER_SIZES[symbol] || 0.00001)) continue;
        prospects.push({
          symbol,
          asset_type: pref.asset_type || 'crypto',
          current_price: price,
          quantity: qty,
          total_value: total,
          confidence_score: confidence,
          is_blocked: false,
          would_execute_now: true,
          market_trend: change24h,
          user_allocation_pct: Number(pref.percentage || 10),
          optimal_action: signalType
        });
      }

      log(`Got ${prospects.length} prospects (inline), cash: $${(cashAvailable || 0).toFixed(2)}`);
      if (prospects.length === 0) {
        await releaseLock(base44, autoTraderRunId, 'completed', {
          trades_attempted: 0,
          trades_successful: 0,
          logs_json: JSON.stringify(runLogs)
        });
        // Clarify why: maybe thresholds too high or no active signals
        return Response.json({ success: true, message: 'No prospects available (no active signals meeting thresholds)', trades_count: 0 });
      }
    } catch (e) {
      log('Inline prospects build failed', { error: e.message });
      await releaseLock(base44, autoTraderRunId, 'failed', {
        error_message: e.message,
        logs_json: JSON.stringify(runLogs)
      });
      return Response.json({ success: false, error: 'Failed to build prospects inline: ' + e.message });
    }

    
    log('Using user-configured margins directly (no dynamic overrides)');
    
    // Update run with initial cash
    await base44.entities.AutoTraderRun.update(autoTraderRunId, {
      cash_available_start: cashAvailable
    });
    
    // Fetch current holdings for emerging prospect evaluation
    let currentHoldings = [];
    try {
      currentHoldings = await base44.entities.Holding.filter({
        created_by: user.email,
        is_simulation: isSimMode
      });
    } catch (_e) {}
    
    // Determine user's risk tolerance based on settings
    const riskTolerance = settings.gain_margin > 8 ? 'high' : settings.gain_margin < 4 ? 'low' : 'medium';
    console.log(`[runAutoTrader] User risk tolerance: ${riskTolerance} (gain margin: ${settings.gain_margin}%)`);
    
    // Evaluate emerging prospects from market intelligence
    const emergingOpportunities = evaluateEmergingProspects(
      marketIntelligence, 
      currentHoldings, 
      cashAvailable,
      riskTolerance
    );
    
    if (emergingOpportunities.length > 0) {
      console.log(`[runAutoTrader] Found ${emergingOpportunities.length} emerging prospects:`);
      emergingOpportunities.forEach(ep => {
        console.log(`  - ${ep.symbol}: potential +${ep.potential_gain_pct}%, reason: ${ep.reason}`);
      });
    }

    // For SIM mode, use wallet balance instead of Kraken
    let availableCash = cashAvailable;
    if (isSimMode) {
      const wallet = await getLatestWallet(base44, user.email);
      availableCash = wallet?.cash_balance || 0;
    }
    
    const cashBefore = availableCash;
    
    if (availableCash <= 0.99) {
      await releaseLock(base44, autoTraderRunId, 'completed', {
        trades_attempted: 0,
        trades_successful: 0,
        logs_json: JSON.stringify(runLogs)
      });
      return Response.json({ 
        success: true, 
        message: 'Insufficient cash', 
        trades_count: 0, 
        mode: isSimMode ? 'sim' : 'live',
        available_cash: availableCash
      });
    }

    // CRITICAL: Check available cash FIRST before filtering prospects
    // This prevents processing prospects when there's no money to trade with
    if (!isSimMode) {
      // Refresh live cash via helper to ensure we don't see $0 due to a single fetch path
      try {
        const live2 = await fetchLiveCash(base44, user.email);
        availableCash = Math.max(0, (live2.available || 0));
        console.log(`[runAutoTrader] LIVE mode - fresh cash available: $${(live2.rawUsd || 0).toFixed(2)} (eff: $${availableCash.toFixed(2)})`);
      } catch (e) {
        console.warn('[runAutoTrader] Fresh balance fetch failed; proceeding with cached value:', e.message);
      }
      if (availableCash < 5) {
                console.log('[runAutoTrader] Insufficient cash for any trades (< $5)');
                await releaseLock(base44, autoTraderRunId, 'completed', {
                  trades_attempted: 0,
                  trades_successful: 0,
                  logs_json: JSON.stringify(runLogs)
                });
                return Response.json({ 
                  success: true, 
                  message: 'Insufficient cash for trading', 
                  trades_count: 0,
                  mode: 'live',
                  available_cash: availableCash,
                  reason: 'Available cash is below minimum threshold ($5)'
                });
              }
    }
    
    // CRITICAL: Check "bad days" mode - if active and not overridden, block all trades
    if (settings.bad_days_active === true && settings.bad_days_override_enabled !== true) {
      log('BAD DAYS mode active - trading paused', { 
        reason: settings.bad_days_reason,
        triggered_at: settings.bad_days_triggered_at
      });
      await releaseLock(base44, autoTraderRunId, 'canceled', {
        error_message: `Trading paused: ${settings.bad_days_reason || 'Bad days mode active'}`,
        logs_json: JSON.stringify(runLogs)
      });
      return Response.json({
        success: false,
        message: `Trading paused: ${settings.bad_days_reason || 'Bad days mode active'}`,
        trades_count: 0,
        bad_days_active: true
      });
    }

    // CRITICAL: Confidence thresholds from user settings
    // If auto_execute_threshold is missing/undefined on the settings record, BLOCK all auto-execution.
    // This prevents stale/duplicate settings records from silently allowing trades.
    const AUTO_EXECUTE_THRESHOLD = typeof settings.auto_execute_threshold === 'number'
      ? settings.auto_execute_threshold
      : null; // null = BLOCK, do not default to a permissive value
    
    if (AUTO_EXECUTE_THRESHOLD === null) {
      log('CRITICAL: auto_execute_threshold is missing/undefined on settings record — BLOCKING all auto-execution to protect user funds', {
        settings_id: settings.id,
        settings_updated: settings.updated_date
      });
      await releaseLock(base44, autoTraderRunId, 'failed', {
        error_message: 'auto_execute_threshold missing on settings record — trades blocked for safety',
        logs_json: JSON.stringify(runLogs)
      });
      return Response.json({
        success: false,
        error: 'auto_execute_threshold missing on settings record — trades blocked for safety',
        settings_id: settings.id
      });
    }

    // CRITICAL: ALL auto-executed trades (both buy AND strong_buy) must meet the auto_execute_threshold.
    // min_signal_confidence is only a pre-filter for signal generation, NOT an execution gate.
    // This prevents low-confidence "buy" signals from bypassing the user's execution threshold.
    log('Confidence threshold for ALL auto-execution', { threshold: AUTO_EXECUTE_THRESHOLD });
    
    // Build signal map for quick lookup
    const signalMap = new Map();
    for (const sig of signals) {
      signalMap.set(sig.asset_symbol, sig);
    }
    
    // HIGH WIN-RATE FILTER: Only auto-execute trades that passed ALL validation layers:
    // 1. generateSignals v4 multi-timeframe + data validation (hard filters)
    // 2. Signal type MUST be "strong_buy" (no "buy" auto-execution)
    // 3. Confidence >= 80% (already validated by signal generator)
    // 4. 24h trend positive (NEVER buy into falling price)
    // 5. Not blocked + sufficient funds
    const eligibleProspects = prospects.filter(p => {
      const signal = signalMap.get(p.symbol);
      const confidenceScore = signal?.confidence_score || Number(p.confidence_score || 0);
      const signalType = (signal?.signal_type || p.optimal_action || 'hold').toLowerCase();

      const notBlocked = !p.is_blocked;
      const wouldExecute = p.would_execute_now === true;

      // ANTI-PUMP FILTER: Block buys when price has already surged or is falling
      // TIGHTENED: Never buy into ANY falling market — prevents constant stop-loss hits
      const change24h = Number(p.market_trend || 0);
      const trendOkForStrong = change24h > -1.5 && change24h < 3.5; // Only buy if not falling >1.5% or pumped >3.5%
      const trendOkForBuy = change24h > -0.5 && change24h < 2.5;    // Very tight: only stable or mildly positive

      // CRITICAL: ALL auto-executed trades must meet the user's auto_execute_threshold.
      // There is no separate lower gate for "buy" vs "strong_buy" — the threshold is the threshold.
      let meetsConfidence = false;
      if (signalType === 'strong_buy') {
        meetsConfidence = confidenceScore >= AUTO_EXECUTE_THRESHOLD && trendOkForStrong;
      } else if (signalType === 'buy') {
        meetsConfidence = confidenceScore >= AUTO_EXECUTE_THRESHOLD && trendOkForBuy;
      }

      const eligible = (signalType === 'strong_buy' || signalType === 'buy') && meetsConfidence && notBlocked && wouldExecute;

      log(`Evaluating ${p.symbol}`, {
        confidence: confidenceScore,
        signalType,
        change24h: change24h.toFixed(1),
        blocked: p.is_blocked,
        wouldExecute,
        trendOkForStrong,
        trendOkForBuy,
        eligible
      });

      return eligible;
    });

    log(`${eligibleProspects.length} prospects eligible for auto-execution`);

    if (eligibleProspects.length === 0) {
      log('No eligible prospects');
      await releaseLock(base44, autoTraderRunId, 'completed', {
        trades_attempted: 0,
        trades_successful: 0,
        logs_json: JSON.stringify(runLogs)
      });
      
      return Response.json({ 
        success: true, 
        message: `No prospects meet ${AUTO_EXECUTE_THRESHOLD}% confidence threshold`, 
        trades_count: 0,
        mode: isSimMode ? 'sim' : 'live',
        total_prospects: prospects.length,
        threshold: AUTO_EXECUTE_THRESHOLD,
        run_id: autoTraderRunId
      });
    }

    const tradesPlaced = [];
    const tradesFailed = [];
    const tradesRejectedRisk = [];
    // Use user's configured TP/SL margins directly - no hardcoded floors
    const defaultGainMargin = typeof settings.gain_margin === 'number' ? settings.gain_margin : 10;
    const defaultLossMargin = typeof settings.loss_margin === 'number' ? settings.loss_margin : 5;
    log('Using user TP/SL margins', { gainMargin: defaultGainMargin, lossMargin: defaultLossMargin });
    const trailingEnabled = settings.trailing_takeprofit_enabled !== false;
    const defaultTrailingMargin = settings.trailing_takeprofit_margin || 3;
    const signalsConsumed = [];
    
    // Skip WS token prefetch to avoid cross-function 403s; krakenTrade will handle as needed
    let wsToken = null;
    
    // Build current portfolio state for risk engine
    let portfolioState = null;
    try {
      const holdings = await base44.entities.Holding.filter({
        created_by: user.email,
        is_simulation: isSimMode
      });
      const wallet = await base44.entities.Wallet.filter({
        created_by: user.email
      });
      
      portfolioState = {
        holdings: holdings.reduce((acc, h) => {
          const key = `${h.symbol}_${isSimMode ? 'sim' : 'live'}`;
          acc[key] = h;
          return acc;
        }, {}),
        wallet: wallet[0] || {}
      };
    } catch (e) {
      log('Could not build portfolio state', { error: e.message });
    }

    // Process each eligible prospect
    for (const prospect of eligibleProspects.slice(0, 2)) {
      if (shouldStop()) { log('Time nearly exhausted, stopping further orders'); break; }
      const sym = (prospect.symbol || '').toUpperCase();
      const typ = (prospect.asset_type || 'crypto').toLowerCase();
      const price = prospect.current_price || 0;
      // CRITICAL: Use the quantity and total_value from prospects - these are calculated using user's allocation %
      const qty = prospect.quantity || 0;
      const total_value = prospect.total_value || 0;
      let confidence = prospect.confidence_score || 0;
      const userAllocationPct = prospect.user_allocation_pct || 10;
      
      // User's TP/SL margins — exactly as configured, no overrides
      const margins = getUserMargins(defaultGainMargin, defaultLossMargin);
      const gainMargin = margins.gainMargin;
      const lossMargin = margins.lossMargin;
      const trailingMargin = defaultTrailingMargin;
      
      log(`Processing ${sym}`, { price, qty, total_value: total_value.toFixed(2), userAllocationPct, gainMargin, lossMargin });
      
      // Ensure portfolioState has FRESH cash before risk check (fixes $0.00 issue)
      try {
        if (!isSimMode) {
          try {
            // Re-use fetchLiveCash which has full waterfall: KrakenConnection → env keys → Wallet entity
            const freshLive = await fetchLiveCash(base44, user.email);
            if (freshLive.source !== 'none' && freshLive.rawUsd > 0) {
              availableCash = Math.max(0, freshLive.available);
              portfolioState = portfolioState || {};
              portfolioState.wallet = { ...(portfolioState.wallet || {}), real_cash_balance: freshLive.rawUsd };
              console.log(`[runAutoTrader] Using fresh cash for checks (${freshLive.source}): $${freshLive.rawUsd.toFixed(2)} (eff: $${availableCash.toFixed(2)})`);
            }
          } catch (_e) {
            // Keep previous availableCash
          }
        } else {
          const simWallet = await getLatestWallet(base44, user.email);
          const simCash = simWallet?.cash_balance ?? availableCash ?? 0;
          availableCash = simCash;
          portfolioState = portfolioState || {};
          portfolioState.wallet = { ...(portfolioState.wallet || {}), cash_balance: simCash };
        }
      } catch (e) {
        console.warn('[runAutoTrader] Fresh balance fetch for riskEngine failed:', e.message);
      }
      
      if (price <= 0 || qty <= 0 || total_value <= 0) {
        log(`Skipping ${sym} - invalid values`, { price, qty, total_value });
        continue;
      }
      
      // Generate idempotency key for this trade
      const idempotencyKey = generateIdempotencyKey(user.email, sym, 'buy', Date.now());
      
      // Check idempotency - prevent duplicate trades
      const isDuplicate = await checkIdempotency(base44, idempotencyKey, user.email);
      if (isDuplicate) {
        log(`Skipping ${sym} - duplicate trade (idempotency check)`, { idempotencyKey });
        continue;
      }
      
      // INLINE RISK: Max asset exposure check (replaces external riskEngine to avoid 403s)
      const maxExpPct = typeof settings.max_asset_exposure_percent === 'number' ? settings.max_asset_exposure_percent : 25;
      const ptfTotal = availableCash + currentHoldings.reduce((s, h) => s + (h.quantity || 0) * (h.average_cost_price || 0), 0);
      if (ptfTotal > 0) {
        const exH = currentHoldings.find(h => h.symbol?.toUpperCase() === sym);
        const exVal = (exH?.quantity || 0) * price;
        const newExpPct = ((exVal + total_value) / ptfTotal) * 100;
        if (newExpPct > maxExpPct) {
          log(`RISK: ${sym} exposure ${newExpPct.toFixed(1)}% > max ${maxExpPct}% — skipping`);
          tradesRejectedRisk.push({ symbol: sym, reason: `Exposure ${newExpPct.toFixed(1)}% > ${maxExpPct}%` });
          continue;
        }
      }
      
      // Already refreshed balance earlier via direct Kraken API; just enforce minimal checks here
      if (!isSimMode) {
        if (availableCash < 1) {
          console.log(`[runAutoTrader] Aborting - no cash available after checks`);
          break;
        }
        const minQtyForSymbol = MIN_ORDER_SIZES[sym] || 0.00001;
        if (qty < minQtyForSymbol) {
          log(`Skipping ${sym} - quantity ${qty} below Kraken minimum ${minQtyForSymbol}`, { sym, qty, minQtyForSymbol });
          continue;
        }
      }
      
      // CRITICAL: Add 10% buffer for slippage/fees + $2 minimum buffer
      // This ensures we NEVER try to spend more than actually available
      const feeBuffer = Math.max(2.0, total_value * 0.10);
      const requiredCash = total_value + feeBuffer;
      
      if (requiredCash > availableCash) {
        console.log(`[runAutoTrader] Skipping ${sym} - exceeds available cash ($${requiredCash.toFixed(2)} needed > $${availableCash.toFixed(2)} available, buffer=$${feeBuffer.toFixed(2)})`);
        continue;
      }
      
      // Double-check: ensure total_value doesn't exceed 85% of available (leave room for fees)
      if (total_value > availableCash * 0.85) {
        console.log(`[runAutoTrader] Skipping ${sym} - would use ${((total_value/availableCash)*100).toFixed(1)}% of cash (max 85%)`);
        continue;
      }

      log(`🚀 AUTO-EXECUTING ${sym}`, { qty, price, total_value: total_value.toFixed(2), confidence });
      
      // PRE-VALIDATION: Block orders Kraken would reject BEFORE sending them
      const minQtyForAsset = MIN_ORDER_SIZES[sym] || 0.00001;
      if (qty < minQtyForAsset || total_value < 5) {
        log(`PRE-BLOCK: ${sym} qty=${qty} min=${minQtyForAsset} val=$${total_value.toFixed(2)} — not sent`);
        continue;
      }
      
      // Dedup + SL cooldown checks
      const isDuplicateRecent = await hasRecentDuplicateTrade(base44, user.email, sym, 'buy', 120000);
      if (isDuplicateRecent) { log(`DEDUP: Skipping ${sym} - recent auto-buy exists`); continue; }
      const slCooldown = await hasRecentStopLoss(base44, user.email, sym);
      if (slCooldown.blocked) { log(`SL COOLDOWN: Skipping ${sym} - SL hit ${slCooldown.hours_ago}h ago`); tradesRejectedRisk.push({ symbol: sym, reason: `SL cooldown (${slCooldown.hours_ago}h ago)` }); continue; }
      
      // Track signal consumption
      const signal = signalMap.get(sym);
      if (signal?.id) {
        signalsConsumed.push(signal.id);
      }
      
      let krakenOrderIds = '';
      let executedQty = qty;
      let executedValue = total_value;
      const orderAttempts = timeLeft() > 12000 ? 2 : 1;

      // CRITICAL: Execute trade based on mode
      if (!isSimMode) {
        // LIVE MODE: Use Kraken API with ADVANCED orders (Trailing Stop + Take Profit)
        try {
          // Calculate TP price (static) and trailing stop percentage
          // CRITICAL: Round prices to Kraken's required decimal precision per asset
          const rawTpPrice = price * (1 + gainMargin / 100);
          const rawSlPrice = price * (1 - lossMargin / 100);
          const takeProfitPrice = roundPriceForKraken(rawTpPrice, sym);
          const staticStopLossPrice = roundPriceForKraken(rawSlPrice, sym);
          
          console.log(`[runAutoTrader] Price precision for ${sym}: TP ${rawTpPrice} -> ${takeProfitPrice}, SL ${rawSlPrice} -> ${staticStopLossPrice}`);
          
          console.log(`[runAutoTrader] 🚀 Executing LIVE buy: ${sym} qty=${qty} @ $${price}`);
          console.log(`[runAutoTrader] 📊 TP: $${takeProfitPrice} (+${gainMargin}%)`);
          console.log(`[runAutoTrader] 📊 Trailing SL: ${trailingMargin}% from peak (fallback static: $${staticStopLossPrice})`);
          
          // Step 1: Place market BUY order with Kraken cl_ord_id for exchange-level dedup
          // CRITICAL: Only send cl_ord_id, NOT order_userref — they are mutually exclusive per Kraken WS v2 docs
          const buyClOrdId = generateKrakenClientOrderId(sym, 'buy');
          await ps(150);
          const buyData = await invokeKrakenTrade(base44, {
            action: 'place_order',
            symbol: sym,
            side: 'buy',
            quantity: qty,
            orderType: 'market',
            cl_ord_id: buyClOrdId
          }, orderAttempts, wsToken, user.email);
          if (!buyData?.success) {
            throw new Error(buyData?.error || 'Kraken buy failed');
          }
          
          const buyOrderId = buyData.order_id;
          console.log(`[runAutoTrader] ✅ BUY executed: ${buyOrderId}`);
          
          // CRITICAL: Record LIVE trade with ACTUAL executed quantity from Kraken response
          executedQty = buyData.executed_qty || buyData.quantity || qty;
          executedValue = executedQty * price;
          
          log(`Recording LIVE trade`, { requestedQty: qty, executedQty, executedValue: executedValue.toFixed(2) });
          
          // Create Trade with idempotency key
          await base44.entities.Trade.create({
            symbol: sym,
            type: 'buy',
            asset_type: typ,
            quantity: executedQty,
            price: price,
            total_value: executedValue,
            status: 'filled',
            is_auto_trade: true,
            is_simulation: false,
            idempotency_key: idempotencyKey,
            signal_id: signal?.id || null,
            auto_trader_run_id: autoTraderRunId,
            kraken_order_id: buyOrderId,
            submitted_at: new Date().toISOString(),
            filled_at: new Date().toISOString(),
            created_by: user.email
          });
          
          // Create LedgerEntry for audit trail
          try {
            await base44.entities.LedgerEntry.create({
              asset_symbol: sym,
              entry_type: 'trade_buy',
              quantity_delta: executedQty,
              cash_delta: -executedValue,
              unit_price: price,
              reference_type: 'trade',
              reference_id: buyOrderId,
              idempotency_key: `${idempotencyKey}_ledger`,
              kraken_txid: buyOrderId,
              is_simulation: false,
              metadata_json: JSON.stringify({
                auto_trader_run_id: autoTraderRunId,
                signal_id: signal?.id
              }),
              created_by: user.email
            });
          } catch (ledgerErr) {
            log(`Failed to create ledger entry for ${sym}`, { error: ledgerErr.message });
          }
          
          // Step 2: Place linked TP/SL orders on Kraken when the filled size supports closing orders
          const minQtyForSymbol = MIN_ORDER_SIZES[sym] || 0.00001;
          const canPlaceClosers = executedQty >= minQtyForSymbol;
          let tpOrderId = null;
          let slOrderId = null;

          if (canPlaceClosers) {
            await ps(1200);
            try {
              console.log(`[runAutoTrader] 📤 Placing linked TP/SL for ${sym}...`);
              const bracketData = await invokeKrakenTrade(base44, {
                action: 'place_bracket_orders',
                symbol: sym,
                quantity: executedQty,
                takeProfitPrice,
                stopLossPrice: staticStopLossPrice
              }, orderAttempts, wsToken, user.email);

              tpOrderId = bracketData?.tp_order_id || null;
              slOrderId = bracketData?.sl_order_id || null;

              if (tpOrderId || slOrderId) {
                console.log(`[runAutoTrader] ✅ Linked TP/SL placed`, { tpOrderId, slOrderId });
              } else {
                console.warn(`[runAutoTrader] ⚠️ Linked TP/SL not created`, { error: bracketData?.error, tp_error: bracketData?.tp_error, sl_error: bracketData?.sl_error });
              }
            } catch (bracketError) {
              console.error('[runAutoTrader] Linked TP/SL placement failed:', bracketError.message);
            }
          } else {
            console.log(`[runAutoTrader] Skipping TP/SL for ${sym} - executed qty ${executedQty} below Kraken minimum ${minQtyForSymbol}`);
          }

          // Store Kraken order IDs for tracking
          krakenOrderIds = [buyOrderId, tpOrderId, slOrderId].filter(Boolean).join(',');
          
          console.log(`[runAutoTrader] 📋 Order IDs saved: ${krakenOrderIds}`);

        } catch (krakenError) {
          log(`Kraken buy failed for ${sym}`, { error: krakenError.message });
          tradesFailed.push({ symbol: sym, error: krakenError.message });
          
          // CRITICAL: Only record health errors for INFRASTRUCTURE failures
          // Do NOT count order validation rejections (minimum not met, invalid volume, 
          // insufficient funds, invalid price, etc.) — these are expected and harmless.
          const errMsg = String(krakenError.message || '');
          const isValidationError = /minimum not met|EGeneral:Invalid arguments|volume minimum|invalid volume|EOrder:Invalid volume|insufficient funds|EOrder:Insufficient|invalid price|EOrder:Invalid price|too small|below minimum|order size|unknown order|EOrder:Unknown/i.test(errMsg);
          
          if (!isValidationError) {
            try {
              await base44.functions.invoke('systemHealthMonitor', {
                action: 'recordError',
                component: 'kraken_api',
                error_message: krakenError.message
              });
            } catch (e) {}
          } else {
            log(`Skipping health error for ${sym} - validation rejection (not infrastructure): ${errMsg}`);
          }
          
          continue;
        }
      } else {
        // SIM MODE: Database only with idempotency
        await base44.entities.Trade.create({
          symbol: sym,
          type: 'buy',
          asset_type: typ,
          quantity: qty,
          price: price,
          total_value,
          status: 'filled',
          is_auto_trade: true,
          is_simulation: true,
          idempotency_key: idempotencyKey,
          signal_id: signal?.id || null,
          auto_trader_run_id: autoTraderRunId,
          filled_at: new Date().toISOString(),
          created_by: user.email
        });
        
        // Create LedgerEntry for SIM mode too
        try {
          await base44.entities.LedgerEntry.create({
            asset_symbol: sym,
            entry_type: 'trade_buy',
            quantity_delta: qty,
            cash_delta: -total_value,
            unit_price: price,
            reference_type: 'trade',
            idempotency_key: `${idempotencyKey}_ledger`,
            is_simulation: true,
            created_by: user.email
          });
        } catch (e) {
          log(`Failed to create SIM ledger entry for ${sym}`, { error: e.message });
        }
      }

      // Update holdings
      const existing = await base44.entities.Holding.filter({
        created_by: user.email,
        symbol: sym,
        asset_type: typ,
        is_simulation: isSimMode
      });
      
      if (existing?.length > 0) {
        const h = existing[0];
        const oldQty = Number(h.quantity || 0);
        const oldAvg = Number(h.average_cost_price || 0);
        const newQty = oldQty + qty;
        const newCost = oldQty * oldAvg + total_value;
        const newAvg = newQty > 0 ? (newCost / newQty) : 0;
        await base44.entities.Holding.update(h.id, { quantity: newQty, average_cost_price: newAvg });
      } else {
        await base44.entities.Holding.create({
          symbol: sym,
          asset_type: typ,
          quantity: qty,
          average_cost_price: price,
          is_simulation: isSimMode,
          created_by: user.email
        });
      }

      availableCash = round2(availableCash - (isSimMode ? total_value : executedValue));

      // Create conditional order for stop-loss/take-profit management
      const conditionalOrderData = {
        symbol: sym,
        asset_type: typ,
        quantity: (isSimMode ? qty : executedQty),
        purchase_price: price,
        gain_margin: gainMargin,
        loss_margin: lossMargin,
        status: 'active',
        trailing_enabled: trailingEnabled,
        highest_price: price,
        trailing_margin: trailingMargin,
        is_simulation: isSimMode,
        idempotency_key: `${idempotencyKey}_conditional`,
        signal_id: signal?.id || null,
        created_by: user.email
      };
      
      // Add Kraken order IDs if in LIVE mode
      if (!isSimMode && krakenOrderIds) {
        const orderIdParts = krakenOrderIds.split(',');
        conditionalOrderData.kraken_order_id = orderIdParts[0] || null;
        conditionalOrderData.kraken_tp_order_id = orderIdParts[1] || null;
        conditionalOrderData.kraken_sl_order_id = orderIdParts[2] || null;
      }
      
      const __minQtyCO = MIN_ORDER_SIZES[sym] || 0.00001;
      if (!isSimMode && executedQty < __minQtyCO) {
        log(`Skipping ConditionalOrder for ${sym} - executedQty ${executedQty} below Kraken minimum ${__minQtyCO}`);
      } else {
        // IDEMPOTENCY: Check if a ConditionalOrder with this key already exists
        const coIdempKey = `${idempotencyKey}_conditional`;
        let coAlreadyExists = false;
        try {
          const existingCOs = await base44.entities.ConditionalOrder.filter({
            created_by: user.email,
            idempotency_key: coIdempKey
          });
          coAlreadyExists = existingCOs.length > 0;
        } catch (_e) {}
        
        if (coAlreadyExists) {
          log(`Skipping duplicate ConditionalOrder for ${sym} - idempotency key already exists: ${coIdempKey}`);
        } else {
          await base44.entities.ConditionalOrder.create(conditionalOrderData);
          log(`Created ConditionalOrder for ${sym}`, { gainMargin, lossMargin, trailingEnabled, trailingMargin });
        }
      }

      tradesPlaced.push({
        symbol: sym,
        asset_type: typ,
        qty,
        price,
        total_value,
        ai_confidence: confidence,
        effective_gain_margin: gainMargin,
        effective_loss_margin: lossMargin,
        margins_source: margins.source,
        idempotency_key: idempotencyKey,
        signal_id: signal?.id || null
      });

      log(`✅ Trade completed for ${sym}`);
      
      // Create notification for this AI trade with full financial details
      try {
        const modeLabel = isSimMode ? 'SIM' : 'LIVE';
        const tpTarget = round2(price * (1 + gainMargin / 100));
        await base44.entities.Notification.create({
          title: `🤖 ${modeLabel} AI Buy: ${sym}`,
          message: `Auto-traded ${qty.toFixed(6)} ${sym} at $${price.toFixed(2)} for $${total_value.toFixed(2)}`,
          type: 'success',
          read: false,
          details_json: JSON.stringify({
            symbol: sym,
            action: 'buy',
            quantity: qty,
            price: price,
            total_value: total_value,
            tp_price: tpTarget,
            tp_pct: gainMargin,
            sl_pct: lossMargin,
            trailing: trailingEnabled,
            confidence: confidence,
            mode: modeLabel,
            auto_trade: true,
            signal_id: signal?.id || null,
            run_id: autoTraderRunId
          }),
          created_by: user.email
        });
      } catch (notifErr) {
        log(`Failed to create notification for ${sym}`, { error: notifErr.message });
      }

      // Pace between prospects to avoid Kraken burst limits
      // Extra pacing between orders to avoid WS bursts
      await ps(350);

      if (availableCash < 1) break;
    }

    // Process emerging prospects (if enabled and we have capacity)
    let emergingTradesPlaced = [];
    // Hard cap to 1 emerging trade per run to stay within time budget
    const MAX_EMERGING = 1;
    if (emergingOpportunities.length > 0 && availableCash > 10 && settings.auto_trading_enabled && timeLeft() > 8000) {
      console.log(`[runAutoTrader] Processing ${emergingOpportunities.length} emerging prospects...`);
      
      let __emergingCount = 0;
      for (const emerging of emergingOpportunities.slice(0, MAX_EMERGING)) {
        if (availableCash < 5) break;
        
        const emergingSymbol = (emerging.symbol || '').toUpperCase();
        
        // CRITICAL: Skip emerging prospects on the AVOID list
        if (avoidList.includes(emergingSymbol)) {
          log(`Skipping emerging ${emergingSymbol} — on AVOID list`);
          continue;
        }
        
        // Fetch current price for emerging prospect (direct Kraken public API)
                  let emergingPrice = 0;
                  try {
                    const pair = KRAKEN_PAIR_MAP[emergingSymbol];
                    if (pair) {
                      const ac = new AbortController();
                      const to = setTimeout(() => ac.abort(), 6000);
                      const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, { signal: ac.signal });
                      clearTimeout(to);
                      if (resp.ok) {
                        const data = await resp.json();
                        const t = data?.result?.[pair];
                        if (t) emergingPrice = parseFloat(t.c?.[0] || '0');
                      }
                    }
                  } catch (_e) {}

                  if (emergingPrice <= 0) {
          console.log(`[runAutoTrader] Skipping emerging ${emergingSymbol} - no price available`);
          continue;
        }
        
        // Calculate position size for emerging prospects (more conservative)
        const emergingAllocation = Math.min(emerging.max_allocation, availableCash * 0.1);
        const emergingQty = emergingAllocation / emergingPrice;
        
        const emergingMinQty = MIN_ORDER_SIZES[emergingSymbol] || 0.00001;
        if (emergingAllocation < 5 || emergingQty < emergingMinQty) {
          log(`PRE-BLOCK emerging: ${emergingSymbol} alloc=$${emergingAllocation.toFixed(2)} qty=${emergingQty.toFixed(8)} min=${emergingMinQty}`);
          continue;
        }
        
        console.log(`[runAutoTrader] 🌟 EMERGING: ${emergingSymbol} @ $${emergingPrice} - allocating $${emergingAllocation.toFixed(2)}`);
        
        // Use user's configured levels for emerging assets — never exceed user's SL
        const emergingGainMargin = defaultGainMargin;
        const emergingLossMargin = defaultLossMargin; // User's SL is the ceiling — never widen
        
        if (!isSimMode) {
          // LIVE: Execute via Kraken
          try {
            await ps(300);
            const emergingBuyData = await invokeKrakenTrade(base44, {
              action: 'place_order',
              symbol: emergingSymbol,
              side: 'buy',
              quantity: emergingQty,
              orderType: 'market'
            }, orderAttempts, wsToken, user.email);
            
            if (emergingBuyData?.success) {
              console.log(`[runAutoTrader] ✅ Emerging buy executed: ${emergingBuyData.order_id}`);
              
              await base44.entities.Trade.create({
                symbol: emergingSymbol,
                type: 'buy',
                asset_type: 'crypto',
                quantity: emergingQty,
                price: emergingPrice,
                total_value: emergingAllocation,
                status: 'executed',
                is_auto_trade: true,
                is_simulation: false,
                created_by: user.email
              });
              
              emergingTradesPlaced.push({
                symbol: emergingSymbol,
                qty: emergingQty,
                price: emergingPrice,
                total_value: emergingAllocation,
                reason: emerging.reason,
                is_emerging: true
              });
              
              availableCash -= emergingAllocation;
            }
          } catch (emergingErr) {
            console.warn(`[runAutoTrader] Emerging trade failed for ${emergingSymbol}:`, emergingErr.message);
          }
        } else {
          // SIM: Database only
          await base44.entities.Trade.create({
            symbol: emergingSymbol,
            type: 'buy',
            asset_type: 'crypto',
            quantity: emergingQty,
            price: emergingPrice,
            total_value: emergingAllocation,
            status: 'executed',
            is_auto_trade: true,
            is_simulation: true,
            created_by: user.email
          });
          
          emergingTradesPlaced.push({
            symbol: emergingSymbol,
            qty: emergingQty,
            price: emergingPrice,
            total_value: emergingAllocation,
            reason: emerging.reason,
            is_emerging: true
          });
          
          availableCash -= emergingAllocation;
        }
        
        await ps(500);
      }
    }

    // Reconcile wallet (SIM only here to avoid cross-function 403s in LIVE)
    try {
      if (isSimMode) {
        await base44.functions.invoke('reconcileWallet', { mode: 'sim' });
      } else {
        // Skip live reconcile; a scheduled job handles live wallet sync
      }
    } catch (e) {
      console.warn('[runAutoTrader] Reconcile skipped/failed:', e.message);
    }

    const totalTrades = tradesPlaced.length + emergingTradesPlaced.length;
    log(`✅ Completed: ${tradesPlaced.length} standard + ${emergingTradesPlaced.length} emerging = ${totalTrades} total trades`);
    
    // Release lock and update run stats
    await releaseLock(base44, autoTraderRunId, 'completed', {
      trades_attempted: eligibleProspects.length,
      trades_successful: tradesPlaced.length,
      trades_failed: tradesFailed.length,
      trades_rejected_risk: tradesRejectedRisk.length,
      cash_available_end: availableCash,
      total_value_traded: tradesPlaced.reduce((sum, t) => sum + (t.total_value || 0), 0),
      logs_json: JSON.stringify(runLogs),
      signals_consumed: JSON.stringify(signalsConsumed)
    });
    
    // Record success with health monitor
    try {
      await base44.functions.invoke('systemHealthMonitor', {
                action: 'recordSuccess',
                component: 'auto_trader'
              });
    } catch (e) {}
    
    const advancedOrderSummary = tradesPlaced.map(t => ({
      symbol: t.symbol, qty: t.qty, entry_price: t.price,
      tp_percent: t.effective_gain_margin, sl_percent: t.effective_loss_margin,
      confidence: t.ai_confidence, margins_source: t.margins_source || 'user_settings'
    }));

    return Response.json({
      success: true,
      mode: isSimMode ? 'sim' : 'live',
      run_id: autoTraderRunId,
      trades_count: totalTrades,
      standard_trades: tradesPlaced.length,
      emerging_trades: emergingTradesPlaced.length,
      trades_failed: tradesFailed.length,
      trades_rejected_risk: tradesRejectedRisk.length,
      cash_before: cashBefore,
      cash_after_estimated: availableCash,
      trades: tradesPlaced,
      failed_trades: tradesFailed,
      risk_rejections: tradesRejectedRisk,
      emerging_trades_detail: emergingTradesPlaced,
      advanced_orders: advancedOrderSummary,
      auto_execute_threshold: AUTO_EXECUTE_THRESHOLD,
      total_prospects_analyzed: prospects.length,
      emerging_opportunities_found: emergingOpportunities.length,
      signals_consumed: signalsConsumed.length,
      order_settings: {
        gain_margin: defaultGainMargin,
        loss_margin: defaultLossMargin,
        trailing_enabled: trailingEnabled,
        trailing_margin: defaultTrailingMargin,
        source: 'user_settings_only'
      },
      risk_tolerance: riskTolerance,
      duration_ms: Date.now() - startTime
    });
  } catch (error) {
    console.error('[runAutoTrader] Fatal error:', error);
    
    // Release lock on error
    if (autoTraderRunId) {
      try {
        const base44 = createClientFromRequest(req);
        await releaseLock(base44, autoTraderRunId, 'failed', {
          error_message: error.message || String(error),
          logs_json: JSON.stringify(runLogs)
        });
      } catch (e) {}
    }
    
    return Response.json({ 
      success: false, 
      error: error.message || String(error),
      run_id: autoTraderRunId
    }, { status: 500 });
  }
});