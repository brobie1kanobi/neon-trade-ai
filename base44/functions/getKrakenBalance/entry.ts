import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Get Kraken Balance — Secrets-backed, direct Kraken call (no cross-function dependency)
 * - Uses Kraken_API_Key / Kraken_API_Secret from App Secrets (read-only key)
 * - Computes USD totals and per-asset values with public prices
 * - Always returns a graceful response (success=false with empty data on errors)
 */

const KRAKEN_PUBLIC_API = 'https://api.kraken.com/0/public/Ticker';
const KRAKEN_API_URL = 'https://api.kraken.com';
const API_TIMEOUT = 15000;

function parseKrakenAsset(krakenCode) {
  const code = String(krakenCode || '').toUpperCase();
  
  // Strip staking suffixes (e.g., DOT.S, ETH2.S)
  const cleaned = code.replace(/\.\w+$/, '');
  
  const map = {
    'XXBT': 'BTC', 'XBT': 'BTC',
    'XETH': 'ETH', 'ETH': 'ETH', 'ETH2': 'ETH',
    'XXRP': 'XRP', 'XRP': 'XRP',
    'XXLM': 'XLM', 'XLM': 'XLM',
    'XLTC': 'LTC', 'LTC': 'LTC',
    'XDG': 'DOGE', 'XXDG': 'DOGE', 'DOGE': 'DOGE',
    'ZUSD': 'USD', 'USD': 'USD',
    'SOL': 'SOL', 'ADA': 'ADA', 'DOT': 'DOT',
    'LINK': 'LINK', 'AVAX': 'AVAX', 'ATOM': 'ATOM',
    'UNI': 'UNI', 'MATIC': 'MATIC', 'BCH': 'BCH',
    'TRX': 'TRX', 'PEPE': 'PEPE', 'SHIB': 'SHIB',
    'NEAR': 'NEAR', 'ALGO': 'ALGO', 'ICP': 'ICP',
    'SUI': 'SUI', 'HBAR': 'HBAR', 'TRUMP': 'TRUMP',
    'BONK': 'BONK', 'FLOKI': 'FLOKI', 'BABY': 'BABY',
  };
  if (map[cleaned]) return map[cleaned];

  let symbol = cleaned;
  if (symbol.startsWith('Z') && symbol.length >= 4) symbol = symbol.substring(1);
  if (symbol.startsWith('X') && symbol.length >= 4) symbol = symbol.substring(1);
  if (map[symbol]) return map[symbol];
  return symbol;
}

function knownPair(symbol) {
  const map = {
    BTC: 'XXBTZUSD', ETH: 'XETHZUSD', XRP: 'XXRPZUSD', LTC: 'XLTCZUSD', SOL: 'SOLUSD', ADA: 'ADAUSD',
    DOT: 'DOTUSD', DOGE: 'XDGUSD', LINK: 'LINKUSD', UNI: 'UNIUSD', MATIC: 'MATICUSD', ATOM: 'ATOMUSD',
    AVAX: 'AVAXUSD', BCH: 'BCHUSD', TRX: 'TRXUSD', PEPE: 'PEPEUSD', XLM: 'XXLMZUSD',
    SHIB: 'SHIBUSD', NEAR: 'NEARUSD', ALGO: 'ALGOUSD', ICP: 'ICPUSD', FIL: 'FILUSD',
    SAND: 'SANDUSD', MANA: 'MANAUSD', APE: 'APEUSD', OP: 'OPUSD', ARB: 'ARBUSD',
    INJ: 'INJUSD', SUI: 'SUIUSD', TAO: 'TAOUSD', WIF: 'WIFUSD', FLOKI: 'FLOKIUSD',
    BONK: 'BONKUSD', BABY: 'BABYUSD', HBAR: 'HBARUSD', TRUMP: 'TRUMPUSD',
  };
  // Fallback: try generic pair format
  return map[symbol] || `${symbol}USD`;
}

let lastNonce = 0;
function generateNonce() {
  const now = Date.now() * 1000;
  if (now <= lastNonce) lastNonce++;
  else lastNonce = now;
  return lastNonce.toString();
}

async function callKraken(apiKey, apiSecret, endpoint, data = {}) {
  const cleanKey = String(apiKey || '').trim();
  const cleanSecret = String(apiSecret || '').trim();
  const nonce = generateNonce();
  const postData = new URLSearchParams({ nonce, ...data }).toString();

  const message = nonce + postData;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  const hmacKey = await crypto.subtle.importKey(
    'raw', Uint8Array.from(atob(cleanSecret), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const pathBytes = new TextEncoder().encode(endpoint);
  const combined = new Uint8Array(pathBytes.length + hash.byteLength);
  combined.set(pathBytes); combined.set(new Uint8Array(hash), pathBytes.length);
  const signature = await crypto.subtle.sign('HMAC', hmacKey, combined);
  const apiSign = btoa(String.fromCharCode(...new Uint8Array(signature)));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const res = await fetch(`${KRAKEN_API_URL}${endpoint}`, {
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
    const json = await res.json();
    if (json.error?.length) throw new Error(json.error.join(', '));
    return json.result || {};
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

Deno.serve(async (req) => {
  const start = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });

    const balKey = Deno.env.get('Kraken_API_Key');
    const balSecret = Deno.env.get('Kraken_API_Secret');
    if (!balKey || !balSecret) {
      return Response.json({
        success: false,
        connected: false,
        error: 'Not connected',
        usd_balance: 0,
        total_usd_balance: 0,
        available_usd_balance: 0,
        holdings: [],
        total_assets: 0,
        total_crypto_value_usd: 0,
        total_portfolio_value_usd: 0
      }, { status: 200 });
    }

    // 1) Fetch extended balance directly from Kraken (includes held amounts)
    let extended;
    try {
      extended = await callKraken(balKey, balSecret, '/0/private/BalanceEx', {});
    } catch (e) {
      // Signature/nonce errors should surface clearly
      return Response.json({
        success: false,
        connected: false,
        error: e.message || 'Kraken BalanceEx failed'
      }, { status: 200 });
    }

    // 2) Derive balances
    const ext = extended || {};
    const balanceMap = {};
    for (const [asset, info] of Object.entries(ext)) {
      const qty = typeof info === 'object' && info !== null
        ? parseFloat(info.balance ?? info.total ?? 0)
        : parseFloat(info || 0);
      balanceMap[asset] = isNaN(qty) ? 0 : qty;
    }

    // USD balances
    const availableUsd = parseFloat((ext?.USD?.balance ?? ext?.ZUSD?.balance ?? balanceMap.USD ?? balanceMap.ZUSD ?? 0));
    const totalUsd = parseFloat((ext?.USD?.total ?? ext?.ZUSD?.total ?? ((ext?.USD?.balance ?? ext?.ZUSD?.balance ?? 0) + (ext?.USD?.hold_trade ?? ext?.ZUSD?.hold_trade ?? 0)) ?? balanceMap.USD ?? balanceMap.ZUSD ?? 0));

    // 3) Build holdings and fetch prices
    const rawHoldings = [];
    const symbols = [];
    for (const [asset, qty] of Object.entries(balanceMap)) {
      if (asset === 'USD' || asset === 'ZUSD') continue;
      const n = Number(qty) || 0;
      if (n <= 0.00001) continue;
      const sym = parseKrakenAsset(asset);
      rawHoldings.push({ symbol: sym, quantity: n });
      symbols.push(sym);
    }

    let prices = {};
    const pairs = symbols.map(s => knownPair(s)).filter(Boolean);
    if (pairs.length > 0) {
      try {
        const resp = await Promise.race([
          fetch(`${KRAKEN_PUBLIC_API}?pair=${pairs.join(',')}`, { headers: { 'User-Agent': 'NeonTrade-AI/1.0' } }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
        ]);
        if (resp.ok) {
          const data = await resp.json();
          for (const [pair, ticker] of Object.entries(data?.result || {})) {
            let sym = pair.replace(/ZUSD$|USD$/g, '');
            if (sym.startsWith('X') && sym.length === 4) sym = sym.substring(1);
            if (sym === 'XBT') sym = 'BTC';
            if (sym === 'XDG') sym = 'DOGE';
            const price = parseFloat(ticker.c?.[0]) || 0;
            if (price > 0) prices[sym] = price;
          }
        }
      } catch (_e) {
        // Non-critical
      }
    }

    // Fetch cost basis from DB holdings (user-scoped)
    let costBasisMap = {};
    try {
      const dbHoldings = await base44.entities.Holding.filter({
        is_simulation: false
      });
      for (const h of (dbHoldings || [])) {
        if (h.symbol && h.average_cost_price > 0) {
          costBasisMap[h.symbol] = h.average_cost_price;
        }
      }
    } catch (_e) {
      console.warn('[getKrakenBalance] Could not fetch cost basis from DB');
    }

    const holdings = [];
    let totalCryptoValue = 0;
    const qtyBySymbol = rawHoldings.reduce((acc, h) => { acc[h.symbol] = (acc[h.symbol] || 0) + h.quantity; return acc; }, {});
    for (const [sym, qty] of Object.entries(qtyBySymbol)) {
      const p = prices[sym] || 0;
      const val = qty * p;
      const avgCost = costBasisMap[sym] || 0;
      totalCryptoValue += val;
      holdings.push({
        symbol: sym,
        quantity: qty,
        current_price: p,
        current_price_usd: p,
        total_value_usd: val,
        avg_cost: avgCost,
        cost_basis_total: avgCost > 0 ? avgCost * qty : 0,
        asset_type: 'crypto',
        is_simulation: false,
        price_available: p > 0
      });
    }

    const total = totalUsd + totalCryptoValue;

    return Response.json({
      success: true,
      connected: true,
      usd_balance: totalUsd,
      total_usd_balance: totalUsd,
      available_usd_balance: availableUsd,
      holdings,
      total_assets: holdings.length,
      total_crypto_value_usd: totalCryptoValue,
      total_portfolio_value_usd: total,
      prices_available: Object.keys(prices).length > 0,
      duration_ms: Date.now() - start
    }, { status: 200 });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
      connected: false,
      usd_balance: 0,
      total_usd_balance: 0,
      available_usd_balance: 0,
      holdings: [],
      total_assets: 0,
      total_crypto_value_usd: 0,
      total_portfolio_value_usd: 0,
      duration_ms: Date.now() - start
    }, { status: 200 });
  }
});