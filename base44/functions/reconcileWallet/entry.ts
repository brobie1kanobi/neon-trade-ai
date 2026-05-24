import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

function round2(n) { 
  const x = Number(n || 0); 
  return Math.round((x + Number.EPSILON) * 100) / 100; 
}

function is429(err) {
  const s = err?.status || err?.response?.status;
  const m = String(err?.message || '');
  return s === 429 || /rate limit/i.test(m);
}

async function withRetry(fn, { retries = 3, base = 250, label = '' } = {}) {
  let attempts = 0;
  while (true) {
    try { 
      return await fn(); 
    } catch (e) {
      if (attempts < retries && is429(e)) {
        const delay = base * Math.pow(2, attempts) + Math.round(Math.random() * 200);
        await new Promise(r => setTimeout(r, delay));
        attempts++; 
        continue;
      }
      const err = new Error(`[${label}] ${e?.message || 'Unknown error'}`); 
      err.original = e; 
      throw err;
    }
  }
}

async function computeSim(base44, email) {
  console.log('[Reconcile] Computing simulation mode balances...');
  
  // Fetch all transactions
  const txs = await withRetry(
    () => base44.entities.Transaction.filter(
      { created_by: email, is_real_money: false }, 
      '-created_date', 
      5000
    ),
    { label: 'tx_sim' }
  );
  
  const deposits = txs.filter(t => 
    t?.type === 'deposit' && ((t?.status || 'completed') === 'completed')
  ).reduce((sum, t) => sum + Number(t?.amount || 0), 0);
  
  const withdrawals = txs.filter(t => 
    t?.type === 'withdrawal' && ((t?.status || 'completed') === 'completed')
  ).reduce((sum, t) => sum + Number(t?.amount || 0), 0);
  
  console.log(`[Reconcile] SIM Deposits: $${deposits.toFixed(2)}, Withdrawals: $${withdrawals.toFixed(2)}`);
  
  // Fetch all trades
  const trades = await withRetry(
    () => base44.entities.Trade.filter(
      { created_by: email, is_simulation: true }, 
      '-created_date', 
      5000
    ),
    { label: 'tr_sim' }
  );
  
  const buys = trades.filter(tr => tr?.type === 'buy')
    .reduce((sum, tr) => sum + Number(tr?.total_value || 0), 0);
  
  const sells = trades.filter(tr => tr?.type === 'sell')
    .reduce((sum, tr) => sum + Number(tr?.total_value || 0), 0);
  
  console.log(`[Reconcile] SIM Buys: $${buys.toFixed(2)}, Sells: $${sells.toFixed(2)}`);
  console.log(`[Reconcile] SIM Trades count: ${trades.length} (${trades.filter(t => t?.type === 'buy').length} buys, ${trades.filter(t => t?.type === 'sell').length} sells)`);
  
  // Starting balance for simulation mode (adjust if needed)
  const startingBalance = 10000;
  
  // Calculate final cash: starting + deposits - withdrawals - buys + sells
  const cash = round2(startingBalance + deposits - withdrawals - buys + sells);
  
  console.log(`[Reconcile] SIM Final calculated cash: $${cash.toFixed(2)}`);
  console.log(`[Reconcile] SIM Calculation: $${startingBalance} (start) + $${deposits.toFixed(2)} (dep) - $${withdrawals.toFixed(2)} (with) - $${buys.toFixed(2)} (buys) + $${sells.toFixed(2)} (sells) = $${cash.toFixed(2)}`);
  
  return { 
    cash_balance: cash, 
    total_deposits: round2(deposits), 
    total_withdrawals: round2(withdrawals) 
  };
}

async function computeReal(base44, email) {
  console.log('[Reconcile] Computing real mode balances...');
  
  const txs = await withRetry(
    () => base44.entities.Transaction.filter(
      { created_by: email, is_real_money: true }, 
      '-created_date', 
      5000
    ),
    { label: 'tx_real' }
  );
  
  const deposits = txs.filter(t => 
    t?.type === 'deposit' && ((t?.status || 'completed') === 'completed')
  ).reduce((sum, t) => sum + Number(t?.amount || 0), 0);
  
  const withdrawals = txs.filter(t => 
    t?.type === 'withdrawal' && ((t?.status || 'completed') === 'completed')
  ).reduce((sum, t) => sum + Number(t?.amount || 0), 0);
  
  console.log(`[Reconcile] REAL Deposits: $${deposits.toFixed(2)}, Withdrawals: $${withdrawals.toFixed(2)}`);
  
  const trades = await withRetry(
    () => base44.entities.Trade.filter(
      { created_by: email, is_simulation: false }, 
      '-created_date', 
      5000
    ),
    { label: 'tr_real' }
  );
  
  const buys = trades.filter(tr => tr?.type === 'buy')
    .reduce((sum, tr) => sum + Number(tr?.total_value || 0), 0);
  
  const sells = trades.filter(tr => tr?.type === 'sell')
    .reduce((sum, tr) => sum + Number(tr?.total_value || 0), 0);
  
  console.log(`[Reconcile] REAL Buys: $${buys.toFixed(2)}, Sells: $${sells.toFixed(2)}`);
  console.log(`[Reconcile] REAL Trades count: ${trades.length}`);
  
  // Real mode starts at 0
  const cash = round2(deposits - withdrawals - buys + sells);
  
  console.log(`[Reconcile] REAL Final calculated cash: $${cash.toFixed(2)}`);
  
  return { 
    real_cash_balance: cash, 
    real_total_deposits: round2(deposits), 
    real_total_withdrawals: round2(withdrawals) 
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { 
        status: 204, 
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, content-type'
        }
      });
    }
    
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }), 
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode || 'both';

    console.log(`[Reconcile] Starting wallet reconciliation for ${user.email}, mode: ${mode}`);

    const wallets = await withRetry(
      () => base44.entities.Wallet.filter({ created_by: user.email }), 
      { label: 'wallet_fetch' }
    );
    const existing = wallets?.[0] || null;

    console.log(`[Reconcile] Existing wallet found: ${existing ? 'Yes' : 'No'}`);
    if (existing) {
      console.log(`[Reconcile] Current balances - SIM: $${(existing.cash_balance || 0).toFixed(2)}, REAL: $${(existing.real_cash_balance || 0).toFixed(2)}`);
    }

    const patch = {};
    
    if (mode === 'sim' || mode === 'both') {
      const sim = await computeSim(base44, user.email);
      Object.assign(patch, sim);
    }
    
    if (mode === 'real' || mode === 'both') {
      const real = await computeReal(base44, user.email);
      Object.assign(patch, real);
    }

    console.log(`[Reconcile] Patch to apply:`, patch);

    let updated;
    if (existing?.id) {
      updated = await withRetry(
        () => base44.entities.Wallet.update(existing.id, patch), 
        { label: 'wallet_update' }
      );
      console.log(`[Reconcile] Wallet updated successfully`);
    } else {
      updated = await withRetry(
        () => base44.entities.Wallet.create({ created_by: user.email, ...patch }), 
        { label: 'wallet_create' }
      );
      console.log(`[Reconcile] Wallet created successfully`);
    }

    console.log(`[Reconcile] Final balances - SIM: $${(updated.cash_balance || 0).toFixed(2)}, REAL: $${(updated.real_cash_balance || 0).toFixed(2)}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        patch, 
        wallet: updated,
        message: `Wallet reconciled successfully. ${mode === 'sim' ? 'Simulation' : mode === 'real' ? 'Real' : 'Both'} balance(s) updated.`
      }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (e) {
    console.error('[Reconcile] Error:', e);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Wallet reconciliation failed' 
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});