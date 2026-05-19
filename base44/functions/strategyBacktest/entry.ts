import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { strategy_id, start_date, end_date, initial_capital = 10000 } = await req.json();
    
    // Get strategy
    const strategy = await base44.asServiceRole.entities.TradingStrategy.get(strategy_id);
    if (!strategy) {
      return Response.json({ error: 'Strategy not found' }, { status: 404 });
    }
    
    // SECURITY: Verify the authenticated user owns this strategy or is an admin
    if (strategy.created_by !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: You do not own this strategy' }, { status: 403 });
    }
    
    // Fetch historical data for backtesting
    const results = [];
    let capital = initial_capital;
    let position = null;
    let trades = [];
    let wins = 0;
    let losses = 0;
    
    for (const symbol of strategy.symbols) {
      // Get historical price data
      const chartRes = await base44.functions.invoke('getMarketData', {
        action: 'getAssetChartData',
        payload: {
          symbol,
          assetType: strategy.asset_type,
          days: 90
        }
      });
      
      const chartData = chartRes?.data?.data || [];
      if (chartData.length === 0) continue;
      
      const prices = chartData.map(d => d.price);
      
      // Evaluate each time point
      for (let i = strategy.indicators.rsi_period || 14; i < prices.length; i++) {
        const historicalPrices = prices.slice(0, i + 1);
        
        const signalRes = await base44.functions.invoke('technicalIndicators', {
          action: 'evaluateSignal',
          payload: {
            prices: historicalPrices,
            strategy
          }
        });
        
        const signal = signalRes?.data?.signal;
        if (!signal) continue;
        
        const currentPrice = prices[i];
        const timestamp = chartData[i].time;
        
        // Buy signal
        if (signal.buy && !position) {
          const quantity = (capital * (strategy.position_size / 100)) / currentPrice;
          position = {
            symbol,
            entry_price: currentPrice,
            quantity,
            entry_time: timestamp
          };
          
          trades.push({
            action: 'buy',
            symbol,
            price: currentPrice,
            quantity,
            timestamp,
            signal: signal.type,
            indicators: signal.indicators
          });
        }
        
        // Sell signal or stop loss
        if (position && signal.sell) {
          const exitPrice = currentPrice;
          const pnl = (exitPrice - position.entry_price) * position.quantity;
          capital += pnl;
          
          if (pnl > 0) wins++;
          else if (pnl < 0) losses++;
          
          trades.push({
            action: 'sell',
            symbol,
            price: exitPrice,
            quantity: position.quantity,
            timestamp,
            pnl,
            signal: signal.type,
            indicators: signal.indicators
          });
          
          position = null;
        }
      }
    }
    
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalReturn = ((capital - initial_capital) / initial_capital) * 100;
    
    return Response.json({
      success: true,
      backtest: {
        strategy_name: strategy.name,
        initial_capital,
        final_capital: capital,
        total_return: totalReturn,
        total_trades: totalTrades,
        wins,
        losses,
        win_rate: winRate,
        trades
      }
    });
    
  } catch (error) {
    console.error('Backtest error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});