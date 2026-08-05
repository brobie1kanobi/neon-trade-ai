import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { parseKrakenAsset, knownPair, isStakingAsset } from '../../shared/krakenAssets.ts';

/**
 * Get Kraken Balance — Routes through krakenApi to respect rate limits.
 * No direct Kraken calls — everything goes via krakenApi proxy.
 * Asset symbol normalization lives in shared/krakenAssets.ts.
 */

const KRAKEN_PUBLIC_API = 'https://api.kraken.com/0/public/Ticker';

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

    // Route through krakenApi to respect the shared rate limiter
    const balanceRes = await base44.functions.invoke('krakenApi', { action: 'getExtendedBalance' });
    const balanceData = balanceRes?.data || balanceRes;
    
    if (!balanceData?.success) {
      // RESILIENCE: On temporary lockout or rate limit, fall back to last-known DB data
      // so the UI doesn't flash $0 assets while Kraken is temporarily unavailable
      const errMsg = balanceData?.error || 'Kraken BalanceEx failed';
      const isTransient = /temporary lockout|rate limit|too many|throttl/i.test(errMsg);
      
      if (isTransient) {
        console.warn('[getKrakenBalance] Transient Kraken error, falling back to DB:', errMsg);
        try {
          // Real holdings are synced by syncKrakenBalance running as the service role,
          // so they are stamped created_by=<service account>, not the admin user.
          // Read the latest real holdings via service role and dedupe by symbol below.
          const dbHoldings = await base44.asServiceRole.entities.Holding.filter({ is_simulation: false }, "-updated_date", 200);
          const dbWallets = await base44.entities.Wallet.filter({ created_by: user.email });
          const dbWallet = dbWallets[0];
          const usd = dbWallet?.real_cash_balance || 0;
          
          // Fetch current prices for DB holdings
          const KRAKEN_PUBLIC = 'https://api.kraken.com/0/public/Ticker';
          const syms = dbHoldings.filter(h => h.quantity > 0).map(h => h.symbol);
          const pairList = syms.map(s => knownPair(s)).filter(Boolean);
          let fallbackPrices = {};
          if (pairList.length > 0) {
            try {
              const pResp = await Promise.race([
                fetch(`${KRAKEN_PUBLIC}?pair=${pairList.join(',')}`, { headers: { 'User-Agent': 'NeonTrade-AI/1.0' } }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
              ]);
              if (pResp.ok) {
                const pData = await pResp.json();
                for (const [pair, ticker] of Object.entries(pData?.result || {})) {
                  let sym = pair.replace(/ZUSD$|USD$/g, '');
                  if (sym.startsWith('X') && sym.length === 4) sym = sym.substring(1);
                  if (sym === 'XBT') sym = 'BTC';
                  if (sym === 'XDG') sym = 'DOGE';
                  const price = parseFloat(ticker.c?.[0]) || 0;
                  if (price > 0) fallbackPrices[sym] = price;
                }
              }
            } catch (_e) {}
          }
          
          // Deduplicate by symbol — syncKrakenBalance may leave stale duplicates
          const bySymbol = {};
          for (const h of dbHoldings.filter(h => h.quantity > 0)) {
            const sym = h.symbol;
            if (!bySymbol[sym] || new Date(h.updated_date || 0) > new Date(bySymbol[sym].updated_date || 0)) {
              bySymbol[sym] = h;
            }
          }
          
          let totalCrypto = 0;
          const fallbackHoldings = Object.values(bySymbol).map(h => {
            const p = fallbackPrices[h.symbol] || 0;
            const val = h.quantity * p;
            totalCrypto += val;
            return {
              symbol: h.symbol, quantity: h.quantity, current_price: p, current_price_usd: p,
              total_value_usd: val, avg_cost: h.average_cost_price || 0,
              cost_basis_total: (h.average_cost_price || 0) * h.quantity,
              asset_type: 'crypto', is_simulation: false, price_available: p > 0
            };
          });
          
          return Response.json({
            success: true, connected: true,
            usd_balance: usd, total_usd_balance: usd, available_usd_balance: usd,
            holdings: fallbackHoldings, total_assets: fallbackHoldings.length,
            total_crypto_value_usd: totalCrypto, total_portfolio_value_usd: usd + totalCrypto,
            prices_available: Object.keys(fallbackPrices).length > 0,
            is_fallback: true, fallback_reason: errMsg,
            duration_ms: Date.now() - start
          }, { status: 200 });
        } catch (fallbackErr) {
          console.error('[getKrakenBalance] DB fallback also failed:', fallbackErr.message);
        }
      }
      
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
      } catch (_e) { /* Non-critical */ }
    }

    // Fetch cost basis from DB holdings. Real holdings are synced by the service
    // role (syncKrakenBalance), so read them via service role, newest first.
    let costBasisMap = {};
    try {
      const dbHoldings = await base44.asServiceRole.entities.Holding.filter({ is_simulation: false }, "-updated_date", 200);
      for (const h of (dbHoldings || [])) {
        if (h.symbol && h.average_cost_price > 0) {
          costBasisMap[h.symbol] = h.average_cost_price;
        }
      }
    } catch (_e) { }

    const holdings = [];
    let totalCryptoValue = 0;
    const qtyBySymbol = rawHoldings.reduce((acc, h) => { acc[h.symbol] = (acc[h.symbol] || 0) + h.quantity; return acc; }, {});
    for (const [sym, qty] of Object.entries(qtyBySymbol)) {
      const p = prices[sym] || 0;
      const val = qty * p;
      const avgCost = costBasisMap[sym] || 0;
      totalCryptoValue += val;
      holdings.push({
        symbol: sym, quantity: qty, current_price: p, current_price_usd: p,
        total_value_usd: val, avg_cost: avgCost, cost_basis_total: avgCost > 0 ? avgCost * qty : 0,
        asset_type: 'crypto', is_simulation: false, price_available: p > 0
      });
    }

    const total = totalUsd + totalCryptoValue;

    return Response.json({
      success: true, connected: true,
      usd_balance: totalUsd, total_usd_balance: totalUsd, available_usd_balance: availableUsd,
      holdings, total_assets: holdings.length,
      total_crypto_value_usd: totalCryptoValue, total_portfolio_value_usd: total,
      prices_available: Object.keys(prices).length > 0,
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