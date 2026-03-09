import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { strategy_id } = await req.json();
    
    // Get strategy with ownership check
    const strategy = await base44.entities.TradingStrategy.get(strategy_id);
    if (!strategy || !strategy.is_active) {
      return Response.json({ error: 'Strategy not found or inactive' }, { status: 404 });
    }
    if (user?.role !== 'admin' && strategy.created_by !== user.email) {
      return Response.json({ error: 'Forbidden: You do not own this strategy' }, { status: 403 });
    }
    
    const executions = [];
    
    for (const symbol of strategy.symbols) {
      // Get recent price data
      const chartRes = await base44.functions.invoke('getMarketData', {
        action: 'getAssetChartData',
        payload: {
          symbol,
          assetType: strategy.asset_type,
          days: 7
        }
      });
      
      const chartData = chartRes?.data?.data || [];
      if (chartData.length === 0) continue;
      
      const prices = chartData.map(d => d.price);
      const currentPrice = prices[prices.length - 1];
      
      // Evaluate signal
      const signalRes = await base44.functions.invoke('technicalIndicators', {
        action: 'evaluateSignal',
        payload: { prices, strategy }
      });
      
      const signal = signalRes?.data?.signal;
      if (!signal || (!signal.buy && !signal.sell)) continue;
      
      // Get wallet
      const wallets = await base44.entities.Wallet.filter({ created_by: user.email });
      const wallet = wallets[0];
      
      const isSimMode = strategy.mode === 'simulation';
      const cashBalance = isSimMode ? wallet.cash_balance : wallet.real_cash_balance;
      
      // Execute trade
      if (signal.buy && cashBalance > 0) {
        const quantity = (cashBalance * (strategy.position_size / 100)) / currentPrice;
        
        // Create trade record
        await base44.entities.Trade.create({
          symbol,
          type: 'buy',
          asset_type: strategy.asset_type,
          quantity,
          price: currentPrice,
          total_value: quantity * currentPrice,
          is_auto_trade: true,
          is_simulation: isSimMode,
          created_by: user.email
        });
        
        // Create execution record
        const execution = await base44.entities.StrategyExecution.create({
          strategy_id,
          execution_type: 'live',
          symbol,
          action: 'buy',
          price: currentPrice,
          quantity,
          signal: signal.type,
          indicators_snapshot: signal.indicators,
          mode: strategy.mode,
          created_by: user.email
        });
        
        executions.push(execution);
        
        // Send notification
        if (user.email) {
          await base44.functions.invoke('pushNotifications', {
            action: 'send',
            payload: {
              user_email: user.email,
              title: `Strategy Buy Signal: ${symbol}`,
              body: `${strategy.name} executed BUY for ${symbol} at $${currentPrice.toFixed(2)}`,
              icon: '/icon-192.png',
              badge: '/icon-192.png'
            }
          });
        }
      }
      
      // Check for sell signals on existing holdings
      if (signal.sell) {
        const holdings = await base44.entities.Holding.filter({
          created_by: user.email,
          symbol,
          is_simulation: isSimMode
        });
        
        for (const holding of holdings) {
          if (holding.quantity > 0) {
            await base44.entities.Trade.create({
              symbol,
              type: 'sell',
              asset_type: strategy.asset_type,
              quantity: holding.quantity,
              price: currentPrice,
              total_value: holding.quantity * currentPrice,
              is_auto_trade: true,
              is_simulation: isSimMode,
              created_by: user.email
            });
            
            const pnl = (currentPrice - holding.average_cost_price) * holding.quantity;
            
            await base44.entities.StrategyExecution.create({
              strategy_id,
              execution_type: 'live',
              symbol,
              action: 'sell',
              price: currentPrice,
              quantity: holding.quantity,
              signal: signal.type,
              indicators_snapshot: signal.indicators,
              pnl,
              mode: strategy.mode,
              created_by: user.email
            });
            
            if (user.email) {
              await base44.functions.invoke('pushNotifications', {
                action: 'send',
                payload: {
                  user_email: user.email,
                  title: `Strategy Sell Signal: ${symbol}`,
                  body: `${strategy.name} executed SELL for ${symbol} at $${currentPrice.toFixed(2)} | P/L: $${pnl.toFixed(2)}`,
                  icon: '/icon-192.png',
                  badge: '/icon-192.png'
                }
              });
            }
          }
        }
      }
    }
    
    // Update strategy stats
    await base44.entities.TradingStrategy.update(strategy_id, {
      last_run: new Date().toISOString(),
      total_trades: (strategy.total_trades || 0) + executions.length
    });
    
    return Response.json({
      success: true,
      executions: executions.length,
      details: executions
    });
    
  } catch (error) {
    console.error('Strategy execution error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});