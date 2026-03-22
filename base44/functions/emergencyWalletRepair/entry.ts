import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user settings to determine mode
    const [settings] = await base44.entities.UserSettings.filter({ created_by: user.email });
    const isSimMode = settings?.sim_trading_mode !== false;

    // Get wallet
    const [wallet] = await base44.entities.Wallet.filter({ created_by: user.email });
    if (!wallet) {
      return Response.json({ error: 'Wallet not found' }, { status: 404 });
    }

    // Get ALL trades for this mode
    const allTrades = await base44.entities.Trade.filter(
      { created_by: user.email, is_simulation: isSimMode },
      '-created_date',
      10000
    );

    // Calculate what cash SHOULD be based on all trades
    let calculatedCash = isSimMode ? 10000 : 0; // Starting balance

    // Add deposits, subtract withdrawals
    const transactions = await base44.entities.Transaction.filter(
      { created_by: user.email, is_real_money: !isSimMode },
      '-created_date',
      10000
    );

    for (const txn of transactions) {
      if (txn.status === 'completed') {
        if (txn.type === 'deposit') {
          calculatedCash += Number(txn.amount || 0);
        } else if (txn.type === 'withdrawal') {
          calculatedCash -= Number(txn.amount || 0);
        }
      }
    }

    // Process all trades to calculate correct cash
    for (const trade of allTrades) {
      const totalValue = Number(trade.total_value || 0);
      if (trade.type === 'buy') {
        calculatedCash -= totalValue; // Subtract purchases
      } else if (trade.type === 'sell') {
        calculatedCash += totalValue; // ADD sell proceeds
      }
    }

    // Get current holdings to verify
    const holdings = await base44.entities.Holding.filter(
      { created_by: user.email, is_simulation: isSimMode },
      '-updated_date',
      10000
    );

    // Update wallet with correct cash
    const updateField = isSimMode ? 'cash_balance' : 'real_cash_balance';
    const currentCash = isSimMode ? wallet.cash_balance : wallet.real_cash_balance;
    
    await base44.asServiceRole.entities.Wallet.update(wallet.id, {
      [updateField]: Math.max(0, calculatedCash)
    });

    return Response.json({
      success: true,
      mode: isSimMode ? 'simulation' : 'live',
      previousCash: currentCash,
      correctedCash: calculatedCash,
      difference: calculatedCash - currentCash,
      tradesProcessed: allTrades.length,
      holdingsCount: holdings.length,
      message: `Wallet repaired! Cash ${updateField} updated from $${currentCash.toFixed(2)} to $${calculatedCash.toFixed(2)}`
    });

  } catch (error) {
    console.error('Emergency repair error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});