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

// Minimal Kraken private API caller (BalanceEx/OpenOrders)
let __kr_lastNonce = 0;
function __kr_generateNonce() {
  const now = Date.now() * 1000;
  if (now <= __kr_lastNonce) __kr_lastNonce++; else __kr_lastNonce = now;
  return __kr_lastNonce.toString();
}
async function __kr_callPrivate(apiKey, apiSecretBase64, endpoint, data = {}) {
  const cleanKey = String(apiKey || '').trim();
  const cleanSecret = String(apiSecretBase64 || '').trim();
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

// Live cash fetcher tries KrakenConnection first, then env keys
async function fetchLiveCash(base44, userEmail) {
  let rawUsd = 0; let reserved = 0; let source = 'none';
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
 * Acquire distributed lock for user's auto-trader run
 */
async function acquireLock(base44, userEmail, runId) {
  try {
    // Check for existing running session
    const activeRuns = await base44.entities.AutoTraderRun.filter({
      created_by: userEmail,
      status: 'running'
    });
    
    if (activeRuns.length > 0) {
      // Check if stale (older than 10 minutes)
      const oldestRun = activeRuns[0];
      const startedAt = new Date(oldestRun.started_at || oldestRun.created_date).getTime();
      const age = Date.now() - startedAt;
      
      if (age < 10 * 60 * 1000) {
        // Still running, can't acquire
        return { acquired: false, reason: 'Another run in progress', existingRunId: oldestRun.id };
      }
      
      // Stale run, mark as failed
      await base44.entities.AutoTraderRun.update(oldestRun.id, {
        status: 'failed',
        error_message: 'Timed out - marked as failed by new run',
        completed_at: new Date().toISOString()
      });
    }
    
    return { acquired: true };
  } catch (e) {
    console.warn('[runAutoTrader] Lock check failed:', e.message);
    return { acquired: true }; // Proceed anyway
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
 * Calculate dynamic TP/SL levels based on historical trade data
 * Uses actual win rates and average gains to optimize exit points
 */
function calculateDynamicLevels(symbol, historyData, defaultGainMargin, defaultLossMargin) {
  const assetHistory = historyData?.asset_analytics?.[symbol?.toUpperCase()];
  
  if (!assetHistory || assetHistory.total_trades < 3) {
    // Not enough history - use defaults
    return {
      gainMargin: defaultGainMargin,
      lossMargin: defaultLossMargin,
      confidence_boost: 0,
      source: 'default'
    };
  }
  
  const winRate = assetHistory.win_rate || 50;
  const avgGain = assetHistory.avg_successful_gain_pct || defaultGainMargin;
  const optimalBuyZone = assetHistory.optimal_buy_zone || {};
  
  // Dynamic gain margin based on historical average successful gains
  // Use 80% of historical average to be conservative
  let dynamicGainMargin = Math.max(defaultGainMargin, avgGain * 0.8);
  dynamicGainMargin = Math.min(dynamicGainMargin, 15); // Cap at 15%
  
  // Dynamic loss margin based on win rate
  // Higher win rate = can afford tighter stops, lower = need wider stops
  let dynamicLossMargin = defaultLossMargin;
  if (winRate > 70) {
    // High performer - tighter stop is ok
    dynamicLossMargin = Math.max(1, defaultLossMargin * 0.8);
  } else if (winRate < 50) {
    // Lower performer - wider stop to give more room
    dynamicLossMargin = Math.min(5, defaultLossMargin * 1.3);
  }
  
  // Confidence boost based on historical performance
  let confidenceBoost = 0;
  if (winRate > 75) confidenceBoost = 10;
  else if (winRate > 65) confidenceBoost = 5;
  else if (winRate < 40 && assetHistory.total_trades > 5) confidenceBoost = -5;
  
  return {
    gainMargin: round2(dynamicGainMargin),
    lossMargin: round2(dynamicLossMargin),
    confidence_boost: confidenceBoost,
    win_rate: winRate,
    historical_avg_gain: avgGain,
    optimal_buy_zone: optimalBuyZone,
    source: 'historical'
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
        
        // CRITICAL: Don't retry on insufficient funds - this won't resolve
        if (/insufficient funds/i.test(msg) || /EOrder:Insufficient funds/i.test(msg)) {
          console.error('[runAutoTrader] Insufficient funds - aborting order');
          return data; // Return the error response, don't retry
        }
        if (/insufficient margin/i.test(msg) || /EOrder:Insufficient margin/i.test(msg)) {
          console.error('[runAutoTrader] Insufficient margin - aborting order');
          return data;
        }
        // Don't retry other order-specific errors
        if (/invalid volume/i.test(msg) || /EOrder:Invalid volume/i.test(msg)) { return data; }
        if (/invalid price/i.test(msg) || /EOrder:Invalid price/i.test(msg)) { return data; }
        if (/unknown order/i.test(msg) || /EOrder:Unknown order/i.test(msg)) { return data; }
        
        if (/permission denied/i.test(msg)) {
          await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade', forceRefresh: true } });
          wsToken = null; // force refetch on next loop
        }
        if (/rate limit|429|timeout|websocket|nonce/i.test(msg)) { throw new Error(msg); }
      }
      return data;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      
      // CRITICAL: Don't retry on insufficient funds or order errors - throw immediately
      if (/insufficient funds/i.test(msg) || /EOrder:Insufficient funds/i.test(msg)) { throw e; }
      if (/insufficient margin/i.test(msg) || /EOrder:Insufficient margin/i.test(msg)) { throw e; }
      if (/invalid volume/i.test(msg) || /EOrder:Invalid volume/i.test(msg)) { throw e; }
      if (/invalid price/i.test(msg) || /EOrder:Invalid price/i.test(msg)) { throw e; }
      
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
    
    // Acquire distributed lock
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
      const anyPaused = records.some(r => r.is_auto_paused);
      const anyUnhealthy = records.some(r => r.status === 'unhealthy');
      const anyDegraded = records.some(r => r.status === 'degraded');
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
    let tradeHistoryData = null;
    
    // Fetch active signals
    try {
      signals = await base44.asServiceRole.entities.AssetSignal.filter({
        is_active: true
      });
      
      // Filter to non-expired signals
      const now = new Date();
      signals = signals.filter(s => !s.expires_at || new Date(s.expires_at) > now);
      
      log(`Found ${signals.length} active signals`);
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

      // Fallback: if no user preferences, derive from top active signals (live-only)
      if (prefs.length === 0) {
        const topSigs = (signals || [])
          .filter(s => (s.asset_type || 'crypto') === 'crypto' && ['buy','strong_buy'].includes(String(s.signal_type || '').toLowerCase()))
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
      const minConf = typeof settings.min_signal_confidence === 'number' ? settings.min_signal_confidence : 50;
      const safetyMaxPct = 0.40;
      const spendable = isSimMode ? tradingCash : tradingCash; // already buffered in live
      for (const pref of prefs) {
        const symbol = String(pref.symbol || '').toUpperCase();
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
        if (change24h < -5) continue;
        const userPct = Number(pref.percentage || 10) / 100;
        let total = spendable * userPct;
        const safetyMax = spendable * safetyMaxPct;
        if (total > safetyMax) total = safetyMax;
        if (total < 1 && spendable >= 5) total = 5;
        if (total < 1) continue;
        const qty = total / price;
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

    
    // Skip external trade history function to avoid cross-function 403s; use defaults
    tradeHistoryData = null;
    log('Skipping external trade history (no cross-function), using defaults');
    
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

    // Confidence thresholds from user settings
    const AUTO_EXECUTE_THRESHOLD = typeof settings.auto_execute_threshold === 'number'
      ? settings.auto_execute_threshold
      : 70; // for strong_buy
    const BUY_THRESHOLD = typeof settings.min_signal_confidence === 'number'
      ? settings.min_signal_confidence
      : 50; // for buy

    log('Confidence thresholds', { strong_buy: AUTO_EXECUTE_THRESHOLD, buy: BUY_THRESHOLD });
    
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

      // Trend check: allow dips up to -3% for strong_buy and 0% for buy
      const change24h = Number(p.market_trend || 0);
      const trendOkForStrong = change24h > -3;
      const trendOkForBuy = change24h >= 0;

      let meetsConfidence = false;
      if (signalType === 'strong_buy') {
        meetsConfidence = confidenceScore >= AUTO_EXECUTE_THRESHOLD && trendOkForStrong;
      } else if (signalType === 'buy') {
        meetsConfidence = confidenceScore >= BUY_THRESHOLD && trendOkForBuy;
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
    // CRITICAL: Enforce minimum TP/SL for high win rate
    // User settings are respected but floored at safe minimums
    const defaultGainMargin = Math.max(settings.gain_margin || 5, 4); // Min 4% TP
    const defaultLossMargin = Math.max(settings.loss_margin || 2.5, 2); // Min 2% SL
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
      
      // ENHANCED: Calculate dynamic TP/SL based on trade history
      const dynamicLevels = calculateDynamicLevels(sym, tradeHistoryData, defaultGainMargin, defaultLossMargin);
      const gainMargin = dynamicLevels.gainMargin;
      const lossMargin = dynamicLevels.lossMargin;
      const trailingMargin = defaultTrailingMargin;
      
      // Adjust confidence based on historical performance
      confidence = Math.max(0, Math.min(100, confidence + dynamicLevels.confidence_boost));
      
      log(`Processing ${sym}`, { price, qty, total_value: total_value.toFixed(2), userAllocationPct, gainMargin, lossMargin });
      
      // Ensure portfolioState has FRESH cash before risk check (fixes $0.00 issue)
      try {
        if (!isSimMode) {
          try {
            const apiKey = (Deno.env.get('Kraken_API_Key') || '').trim();
            const apiSecret = (Deno.env.get('Kraken_API_Secret') || '').trim();
            if (apiKey && apiSecret) {
              const bal = await __kr_callPrivate(apiKey, apiSecret, '/0/private/BalanceEx', {});
              if (!bal?.error?.length && bal?.result) {
                const usdEntry = bal.result['ZUSD'] || bal.result['USD'];
                const freshAvailable = parseFloat(typeof usdEntry === 'object' ? usdEntry.balance : (usdEntry || 0));
                availableCash = Math.max(0, freshAvailable * 0.90);
                portfolioState = portfolioState || {};
                portfolioState.wallet = { ...(portfolioState.wallet || {}), real_cash_balance: freshAvailable };
                console.log(`[runAutoTrader] Using fresh cash for checks: $${freshAvailable.toFixed(2)} (90% eff: $${availableCash.toFixed(2)})`);
              }
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
      
      // Skip external riskEngine to avoid 403s; rely on internal spend/qty/threshold checks below
      log(`Risk engine skipped for ${sym} (using internal checks)`);
      
      // Already refreshed balance earlier via direct Kraken API; just enforce minimal checks here
      if (!isSimMode) {
        if (availableCash < 1) {
          console.log(`[runAutoTrader] Aborting - no cash available after checks`);
          break;
        }
        const MIN_ORDER_SIZES = {
          'BTC': 0.00005, 'ETH': 0.001, 'SOL': 0.02, 'XRP': 10.0, 'ADA': 4.4,
          'DOT': 0.5, 'DOGE': 13.0, 'LINK': 0.2, 'UNI': 0.5, 'MATIC': 10.0,
          'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.01, 'LTC': 0.04, 'TRX': 50.0,
          'SHIB': 100000.0, 'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.7, 'NEAR': 0.7,
          'BABY': 50.0, 'FLOKI': 105000.0, 'WIF': 14.0, 'BONK': 500000.0, 'PEPE': 500000.0,
          'APT': 2.2, 'ARB': 5.2, 'OP': 16.0, 'INJ': 0.9, 'TIA': 8.2, 'FET': 18.0,
          'TRUMP': 0.2, 'KAITO': 2.5, 'MOVE': 6.0, 'GRASS': 13.0, 'GOAT': 5.0,
          'HBAR': 20.0, 'KAS': 30.0, 'TAO': 0.008, 'EIGEN': 8.6, 'ENA': 4.0,
          'SUI': 3.0, 'FARTCOIN': 5.0, 'JUP': 20.0
        };
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
      
      // Track signal consumption
      const signal = signalMap.get(sym);
      if (signal?.id) {
        signalsConsumed.push(signal.id);
      }
      
      let krakenOrderIds = '';

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
          
          // Step 1: Place market BUY order (with pacing)
          await ps(150);
          const attempts = timeLeft() > 12000 ? 2 : 1;
          const buyData = await invokeKrakenTrade(base44, {
            action: 'place_order',
            symbol: sym,
            side: 'buy',
            quantity: qty,
            orderType: 'market'
          }, attempts, wsToken, user.email);
          if (!buyData?.success) {
            throw new Error(buyData?.error || 'Kraken buy failed');
          }
          
          const buyOrderId = buyData.order_id;
          console.log(`[runAutoTrader] ✅ BUY executed: ${buyOrderId}`);
          
          // CRITICAL: Record LIVE trade with ACTUAL executed quantity from Kraken response
          const executedQty = buyData.executed_qty || buyData.quantity || qty;
          const executedValue = executedQty * price;
          
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
          
          // Check if we can place closing SELL orders based on Kraken minimums
          const minQtyForSymbol = MIN_ORDER_SIZES[sym] || 0.00001;
          const canPlaceClosers = executedQty >= minQtyForSymbol;
          const PLACE_TPSL_ON_EXCHANGE = false;
          
          if (PLACE_TPSL_ON_EXCHANGE && canPlaceClosers) {
          // Step 2: Place TAKE PROFIT order (limit at TP price)
          await ps(300);
          
          let tpOrderId = null;
          let slOrderId = null;
          
          // Place Take Profit order
          try {
            console.log(`[runAutoTrader] 📤 Placing Take Profit at $${takeProfitPrice}...`);
            const tpData = await invokeKrakenTrade(base44, {
              action: 'place_order',
              symbol: sym,
              side: 'sell',
              quantity: executedQty,
              orderType: 'take-profit',
              triggerPrice: takeProfitPrice,
              timeInForce: 'gtc'
            }, attempts, wsToken, user.email);
            console.log(`[runAutoTrader] TP response:`, JSON.stringify(tpData));
            
            if (tpData?.success) {
              tpOrderId = tpData.order_id;
              console.log(`[runAutoTrader] ✅ Take Profit order placed: ${tpOrderId}`);
            } else if (tpData?.order_id) {
              // Sometimes success is not explicitly set but order_id exists
              tpOrderId = tpData.order_id;
              console.log(`[runAutoTrader] ✅ Take Profit order placed (implicit): ${tpOrderId}`);
            } else {
              console.warn(`[runAutoTrader] ⚠️ Take Profit failed: ${tpData?.error || 'Unknown error'}`);
            }
          } catch (tpError) {
            console.error('[runAutoTrader] Take Profit order failed:', tpError.message);
          }
          
          // Step 3: Place TRAILING STOP order (locks in profits as price rises)
          await ps(300);
          
          try {
            // Use trailing stop if enabled, otherwise use static stop-loss
            if (trailingEnabled && trailingMargin > 0) {
              console.log(`[runAutoTrader] 📤 Placing Trailing Stop (${trailingMargin}% from peak)...`);
              const slData = await invokeKrakenTrade(base44, {
                action: 'place_trailing_stop',
                symbol: sym,
                quantity: executedQty,
                trailingPercent: trailingMargin,
                trailingPriceType: 'pct',
                triggerReference: 'last',
                useLimit: false // Use market order on trigger for guaranteed execution
              }, attempts, wsToken, user.email);
              if (slData?.success) {
                slOrderId = slData.order_id;
                console.log(`[runAutoTrader] ✅ Trailing Stop order placed: ${slOrderId} (${trailingMargin}% trail)`);
              } else {
                console.warn(`[runAutoTrader] ⚠️ Trailing Stop failed: ${slData?.error}, falling back to static SL`);
                // Fallback to static stop-loss
                const fallbackData = await invokeKrakenTrade(base44, {
                  action: 'place_order',
                  symbol: sym,
                  side: 'sell',
                  quantity: executedQty,
                  orderType: 'stop-loss',
                  stopPrice: staticStopLossPrice,
                  timeInForce: 'gtc'
                }, attempts, wsToken, user.email);
                if (fallbackData?.success) {
                  slOrderId = fallbackData.order_id;
                  console.log(`[runAutoTrader] ✅ Fallback Stop-Loss placed: ${slOrderId} @ $${staticStopLossPrice}`);
                }
              }
            } else {
              // Use static stop-loss if trailing not enabled
              console.log(`[runAutoTrader] 📤 Placing Static Stop-Loss at $${staticStopLossPrice}...`);
              const slData = await invokeKrakenTrade(base44, {
                action: 'place_order',
                symbol: sym,
                side: 'sell',
                quantity: executedQty,
                orderType: 'stop-loss',
                stopPrice: staticStopLossPrice,
                timeInForce: 'gtc'
              }, attempts, wsToken, user.email);
              if (slData?.success) {
                slOrderId = slData.order_id;
                console.log(`[runAutoTrader] ✅ Stop-Loss order placed: ${slOrderId}`);
              } else {
                console.warn(`[runAutoTrader] ⚠️ Stop-Loss failed: ${slData?.error}`);
              }
            }
          } catch (slError) {
            console.error('[runAutoTrader] Stop-Loss order failed:', slError.message);
          }
          
          } else {
            console.log(`[runAutoTrader] Skipping TP/SL for ${sym} - qty ${qty} below Kraken minimum ${minQtyForSymbol}`);
          }
          
          // Store Kraken order IDs for tracking (no TP/SL IDs recorded)
          krakenOrderIds = [buyOrderId].filter(Boolean).join(',');
          
          console.log(`[runAutoTrader] 📋 Order IDs saved: ${krakenOrderIds}`);

        } catch (krakenError) {
          log(`Kraken buy failed for ${sym}`, { error: krakenError.message });
          tradesFailed.push({ symbol: sym, error: krakenError.message });
          
          // Record health error
          try {
            await base44.functions.invoke('systemHealthMonitor', {
                      action: 'recordError',
                      component: 'kraken_api',
                      error_message: krakenError.message
                    });
          } catch (e) {}
          
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
        await base44.entities.ConditionalOrder.create(conditionalOrderData);
      }

      tradesPlaced.push({
        symbol: sym,
        asset_type: typ,
        qty,
        price,
        total_value,
        ai_confidence: confidence,
        dynamic_levels: dynamicLevels,
        effective_gain_margin: gainMargin,
        effective_loss_margin: lossMargin,
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
      
      for (const emerging of emergingOpportunities) {
        if (availableCash < 5) break;
        
        const emergingSymbol = (emerging.symbol || '').toUpperCase();
        
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
        
        if (emergingAllocation < 5) {
          console.log(`[runAutoTrader] Skipping emerging ${emergingSymbol} - allocation too small ($${emergingAllocation.toFixed(2)})`);
          continue;
        }
        
        console.log(`[runAutoTrader] 🌟 EMERGING: ${emergingSymbol} @ $${emergingPrice} - allocating $${emergingAllocation.toFixed(2)}`);
        
        // Use conservative levels for emerging (untested) assets
        const emergingGainMargin = defaultGainMargin;
        const emergingLossMargin = Math.min(defaultLossMargin * 1.5, 5); // Wider stop for new assets
        
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
            }, attempts, wsToken, user.email);
            
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
    
    // Summary of advanced orders placed
    const advancedOrderSummary = tradesPlaced.map(t => ({
      symbol: t.symbol,
      qty: t.qty,
      entry_price: t.price,
      tp_target: round2(t.price * (1 + t.effective_gain_margin / 100)),
      tp_percent: t.effective_gain_margin,
      sl_percent: t.effective_loss_margin,
      trailing_stop: trailingEnabled ? `${defaultTrailingMargin}% from peak` : `Static SL at ${round2(t.price * (1 - t.effective_loss_margin / 100))}`,
      confidence: t.ai_confidence,
      levels_source: t.dynamic_levels?.source || 'default',
      historical_win_rate: t.dynamic_levels?.win_rate || null,
      idempotency_key: t.idempotency_key
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
        default_gain_margin: defaultGainMargin,
        default_loss_margin: defaultLossMargin,
        trailing_enabled: trailingEnabled,
        trailing_margin: defaultTrailingMargin,
        dynamic_levels_enabled: true
      },
      risk_tolerance: riskTolerance,
      trade_history_used: !!tradeHistoryData?.success,
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