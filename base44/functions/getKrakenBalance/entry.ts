import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { parseKrakenAsset, knownPair, isStakingAsset, extractBaseAsset } from '../../shared/krakenAssets.ts';

/**
 * Get Kraken Balance — Routes through krakenApi to respect rate limits.
 * No direct Kraken calls — everything goes via krakenApi proxy.
 * Asset symbol normalization lives in shared/krakenAssets.ts.
 */

const KRAKEN_PUBLIC_API = 'https://api.kraken.com/0/public/Ticker';

// Module-level fallback cache: last known-good price per symbol. If the public
// Ticker call fails or is rate-limited (easily triggered by a refresh firing
// several simultaneous balance calls), we reuse the last good price instead of
// falling back to 0 - a $0 price was zeroing out real crypto holdings and
// making them appear to "disappear" even though cash (price-independent)
// still loaded fine.
const lastKnownPrices = new Map(); // symbol -> price

const STABLES = new Set(['USD', 'ZUSD', 'USDT', 'USDC', 'DAI']);

// Net USD deposited (deposits − withdrawals) from Kraken's ledger. Returns null
// if the ledger can't be read, so callers never show a made-up lifetime figure.
let lastNetDeposits = null;
async function getNetDepositsUsd(base44, prices) {
  let net = 0;
  for (const type of ['deposit', 'withdrawal']) {
    for (let ofs = 0; ofs < 500; ofs += 50) {
      const res = await base44.functions.invoke('krakenApi', { action: 'getLedgers', payload: ofs ? { type, ofs } : { type } }).catch(() => null);
      const d = res?.data || res;
      if (!d?.success) return lastNetDeposits;
      for (const e of d.entries || []) {
        const asset = parseKrakenAsset(e.asset);
        const amt = Math.abs(parseFloat(e.amount) || 0);
        const usd = STABLES.has(asset) ? amt : amt * (prices[asset] || 0);
        net += type === 'deposit' ? usd : -usd;
      }
      if ((d.entries || []).length < 50 || ofs + 50 >= (d.count || 0)) break;
    }
  }
  lastNetDeposits = net;
  return net;
}

// Average cost per asset from Kraken's recent trade history (fees included).
async function getKrakenCostBook(base44) {
  const book = {};
  const res = await base44.functions.invoke('krakenApi', { action: 'getTradesHistory' }).catch(() => null);
  const trades = (res?.data || res)?.trades || [];
  trades.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
  for (const t of trades) {
    const sym = extractBaseAsset(t.pair);
    const vol = parseFloat(t.vol) || 0, cost = parseFloat(t.cost) || 0, fee = parseFloat(t.fee) || 0;
    if (!sym || vol <= 0) continue;
    const b = book[sym] || (book[sym] = { qty: 0, cost: 0 });
    if (t.type === 'buy') { b.qty += vol; b.cost += cost + fee; }
    else if (t.type === 'sell' && b.qty > 0) {
      const sold = Math.min(vol, b.qty);
      b.cost -= (b.cost / b.qty) * sold; b.qty -= sold;
    }
  }
  return book;
}

// Price exactly 24h ago per symbol (hourly candle open), cached 5 min per isolate.
const ref24hCache = new Map(); // symbol -> { price, at }
async function getPrices24hAgo(symbols) {
  const out = {};
  const since = Math.floor(Date.now() / 1000) - 86400;
  await Promise.all(symbols.map(async (sym) => {
    const c = ref24hCache.get(sym);
    if (c && Date.now() - c.at < 300000) { out[sym] = c.price; return; }
    const pair = knownPair(sym);
    if (!pair) return;
    try {
      const resp = await Promise.race([
        fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=60&since=${since}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
      ]);
      const data = await resp.json();
      const series = Object.entries(data?.result || {}).find(([k]) => k !== 'last')?.[1];
      const price = parseFloat(series?.[0]?.[1]) || 0;
      if (price > 0) { ref24hCache.set(sym, { price, at: Date.now() }); out[sym] = price; }
      else if (c) out[sym] = c.price;
    } catch (_e) { if (c) out[sym] = c.price; }
  }));
  return out;
}

Deno.serve(async (req) => {
  const start = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden', success: false }, { status: 403 });

    const hasBal = !!(Deno.env.get('Kraken_API_Key') && Deno.env.get('Kraken_API_Secret'));
    if (!hasBal) {
      return Response.json({
        success: false, connected: false, error: 'Not connected',
        usd_balance: 0, total_usd_balance: 0, available_usd_balance: 0,
        holdings: [], total_assets: 0, total_crypto_value_usd: 0, total_portfolio_value_usd: 0
      }, { status: 200 });
    }

    // Route through krakenApi to respect the shared rate limiter. Its short-TTL
    // cache only contains verified Kraken responses; post-trade invalidation keeps
    // normal updates prompt without repeatedly triggering temporary lockouts.
    const balanceRes = await base44.functions.invoke('krakenApi', { action: 'getExtendedBalance' });
    const balanceData = balanceRes?.data || balanceRes;
    
    if (!balanceData?.success) {
      // Never calculate a live account's displayed value from synced database
      // holdings. They are historical recovery data and can retain positions that
      // have since been sold, which turns a Kraken rate-limit response into an
      // inflated balance. The client retains its last verified Kraken snapshot;
      // if there is no verified snapshot yet, it remains in its loading state.
      const errMsg = balanceData?.error || 'Kraken BalanceEx failed';
      console.warn('[getKrakenBalance] Live Kraken balance unavailable:', errMsg);
      return Response.json({
        success: false, connected: false,
        error: errMsg,
        usd_balance: 0, total_usd_balance: 0, available_usd_balance: 0,
        holdings: [], total_assets: 0, total_crypto_value_usd: 0, total_portfolio_value_usd: 0
      }, { status: 200 });
    }

    const ext = balanceData.balance || {};

    // USD balances
    const usdInfo = ext['USD'] || {};
    const availableUsd = usdInfo.balance || 0;
    const totalUsd = usdInfo.total || usdInfo.balance || 0;

    // Build holdings and fetch prices
    // CRITICAL: Normalize Kraken's internal symbols (XDG, XXBT, XETH, etc.) to
    // standard symbols (DOGE, BTC, ETH) using parseKrakenAsset. This prevents
    // flickering caused by symbol mismatches between REST and WS data sources.
    const rawHoldings = [];
    const symbols = [];
    for (const [asset, info] of Object.entries(ext)) {
      // CRITICAL: Skip staking/opt-in-reward positions (Kraken suffixes them, e.g.
      // "ETH.S", "DOT.M"). These are separate from the tradeable Spot balance shown
      // on Kraken's Spot tab — merging them by stripping the suffix double-counts
      // the same underlying asset (spot + staked) and inflates the portfolio value.
      if (isStakingAsset(asset)) continue;
      const normalizedAsset = parseKrakenAsset(asset);
      if (normalizedAsset === 'USD') continue;
      const qty = info.balance || info.total || 0;
      if (qty <= 0) continue;
      rawHoldings.push({ symbol: normalizedAsset, quantity: qty });
      symbols.push(normalizedAsset);
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
      } catch (_e) { /* Non-critical - fall back to last known prices below */ }
    }

    // Fall back to the last known-good price for any symbol the live fetch
    // didn't return a price for (failed/rate-limited call, missing pair, etc.)
    // instead of letting that holding's value collapse to $0.
    for (const sym of symbols) {
      if (prices[sym] > 0) {
        lastKnownPrices.set(sym, prices[sym]);
      } else if (lastKnownPrices.has(sym)) {
        prices[sym] = lastKnownPrices.get(sym);
      }
    }

    // Fetch cost basis from DB holdings. Real holdings are synced by the service
    // role (syncKrakenBalance), so read them via service role, newest first.
    let costBasisMap = {};
    try {
      // Scope to THIS user — an unscoped read picked up other accounts' cost basis.
      const dbHoldings = await base44.asServiceRole.entities.Holding.filter({ is_simulation: false, created_by: user.email }, "-updated_date", 200);
      for (const h of (dbHoldings || [])) {
        if (h.symbol && h.average_cost_price > 0) {
          costBasisMap[h.symbol] = h.average_cost_price;
        }
      }
    } catch (_e) { }

    const qtyBySymbol = rawHoldings.reduce((acc, h) => { acc[h.symbol] = (acc[h.symbol] || 0) + h.quantity; return acc; }, {});

    // Cost basis from Kraken's OWN trade history (average-cost method, fees
    // included). The app's stored Trade/Holding rows are incomplete/stale.
    const [tradeBook, netDeposits, ref24h] = await Promise.all([
      getKrakenCostBook(base44),
      getNetDepositsUsd(base44, prices),
      getPrices24hAgo(Object.keys(qtyBySymbol))
    ]);

    const holdings = [];
    let totalCryptoValue = 0, unrealized = 0, costBasisTotal = 0, pnl24h = 0, value24hAgo = 0;
    for (const [sym, qty] of Object.entries(qtyBySymbol)) {
      const p = prices[sym] || 0;
      const val = qty * p;
      const book = tradeBook[sym];
      const avgCost = (book && book.qty > 0 ? book.cost / book.qty : 0) || costBasisMap[sym] || 0;
      const basis = avgCost > 0 ? avgCost * qty : 0;
      const p24 = ref24h[sym] || 0;
      totalCryptoValue += val;
      if (basis > 0 && p > 0) { unrealized += val - basis; costBasisTotal += basis; }
      if (p24 > 0 && p > 0) { pnl24h += qty * (p - p24); value24hAgo += qty * p24; }
      holdings.push({
        symbol: sym, quantity: qty, current_price: p, current_price_usd: p,
        total_value_usd: val, avg_cost: avgCost, cost_basis_total: basis, price_24h_ago: p24,
        asset_type: 'crypto', is_simulation: false, price_available: p > 0
      });
    }
    const total = totalUsd + totalCryptoValue;
    // Lifetime profit = what the account is worth now minus the money put in.
    // Falls back to open-position profit if Kraken's deposit history is unavailable.
    const lifetime = netDeposits != null ? total - netDeposits : unrealized;

    return Response.json({
      success: true, connected: true,
      usd_balance: totalUsd, total_usd_balance: totalUsd, available_usd_balance: availableUsd,
      holdings, total_assets: holdings.length,
      total_crypto_value_usd: totalCryptoValue, total_portfolio_value_usd: total,
      prices_available: Object.keys(prices).length > 0,
      pnl: {
        pnl_24h: pnl24h,
        pnl_24h_pct: value24hAgo > 0 ? (pnl24h / value24hAgo) * 100 : 0,
        unrealized_pnl: unrealized,
        pnl_lifetime: lifetime,
        pnl_lifetime_pct: netDeposits > 0 ? (lifetime / netDeposits) * 100 : (costBasisTotal > 0 ? (unrealized / costBasisTotal) * 100 : 0),
        net_deposits: netDeposits,
        lifetime_source: netDeposits != null ? 'deposits' : 'open_positions',
        cost_basis_total: costBasisTotal
      },
      duration_ms: Date.now() - start
    }, { status: 200 });
  } catch (error) {
    return Response.json({
      success: false, error: error.message, connected: false,
      usd_balance: 0, total_usd_balance: 0, available_usd_balance: 0,
      holdings: [], total_assets: 0, total_crypto_value_usd: 0, total_portfolio_value_usd: 0,
      duration_ms: Date.now() - start
    }, { status: 200 });
  }
});