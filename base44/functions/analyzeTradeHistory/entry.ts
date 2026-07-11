import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * Trade History Intelligence Analyzer
 * 
 * Analyzes the entire history of trades to:
 * 1. Identify optimal buy-in price zones for each asset
 * 2. Calculate expected sell points based on historical performance
 * 3. Track win/loss patterns and timing
 * 4. Discover correlations between market conditions and successful trades
 * 5. Build asset-specific intelligence profiles
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { 
      symbols = [], // Optional: filter to specific symbols
      includeKrakenHistory = true, // Fetch from Kraken API
      analyzePatterns = true // Run AI pattern analysis
    } = body;

    console.log('[TradeHistory] Analyzing trade history for user:', user.email);
    console.log('[TradeHistory] Symbols filter:', symbols.length > 0 ? symbols : 'ALL');

    // 1. Fetch local trades defensively so this helper never hard-fails analyzeSmallGains
    const [localTrades, conditionalOrders] = await Promise.all([
      base44.entities.Trade.filter({ created_by: user.email }, '-created_date', 500).catch((err) => {
        console.warn('[TradeHistory] Local Trade fetch failed:', err.message);
        return [];
      }),
      base44.entities.ConditionalOrder.filter({ created_by: user.email }, '-created_date', 250).catch((err) => {
        console.warn('[TradeHistory] Local ConditionalOrder fetch failed:', err.message);
        return [];
      })
    ]);

    console.log('[TradeHistory] Found', localTrades.length, 'local trades,', conditionalOrders.length, 'conditional orders');

    // 2. Fetch Kraken trade history if available
    let krakenTrades = [];
    if (includeKrakenHistory) {
      try {
        const krakenResponse = await base44.functions.invoke('krakenApi', { action: 'getTradesHistory' });
        const krakenData = krakenResponse?.data || krakenResponse;
        if (krakenData?.trades) {
          krakenTrades = krakenData.trades;
          console.log('[TradeHistory] Fetched', krakenTrades.length, 'trades from Kraken');
        }
      } catch (err) {
        console.warn('[TradeHistory] Kraken fetch failed:', err.message);
      }
    }

    // 3. Normalize and merge all trades
    const normalizeSymbol = (symbol) => {
      if (!symbol) return 'UNKNOWN';
      let s = symbol.toUpperCase();
      s = s.replace(/USD$/, '').replace(/ZUSD$/, '').replace(/\/USD$/, '');
      s = s.replace(/^XXBT$/, 'BTC').replace(/^XBT$/, 'BTC');
      s = s.replace(/^XETH$/, 'ETH').replace(/^XXRP$/, 'XRP').replace(/^XXLM$/, 'XLM');
      if (s.length > 3 && s.startsWith('X') && /^X[A-Z]/.test(s)) s = s.substring(1);
      if (s.length > 3 && s.endsWith('Z')) s = s.slice(0, -1);
      return s;
    };

    // Convert Kraken trades to unified format
    const krakenNormalized = krakenTrades.map(kt => ({
      symbol: normalizeSymbol(kt.pair),
      type: kt.type || 'unknown',
      quantity: parseFloat(kt.vol) || 0,
      price: parseFloat(kt.price) || 0,
      total_value: parseFloat(kt.cost) || 0,
      fee: parseFloat(kt.fee) || 0,
      timestamp: kt.time ? new Date(kt.time * 1000) : new Date(),
      source: 'kraken',
      order_type: kt.ordertype,
      is_simulation: false
    }));

    // Convert local trades to unified format
    const localNormalized = localTrades.map(lt => ({
      symbol: normalizeSymbol(lt.symbol),
      type: lt.type || 'unknown',
      quantity: Number(lt.quantity) || 0,
      price: Number(lt.price) || 0,
      total_value: Number(lt.total_value) || 0,
      fee: Number(lt.fee) || 0,
      timestamp: new Date(lt.filled_at || lt.created_date || Date.now()),
      source: 'local',
      order_type: lt.is_auto_trade ? 'auto' : 'manual',
      is_simulation: lt.is_simulation
    }));

    // Merge and dedupe (prefer Kraken data for live trades)
    const allTrades = [...krakenNormalized];
    localNormalized.forEach(lt => {
      // Check if this trade already exists in Kraken data
      const isDupe = krakenNormalized.some(kt => 
        kt.symbol === lt.symbol && 
        Math.abs(kt.quantity - lt.quantity) < 0.0001 &&
        Math.abs(kt.timestamp.getTime() - lt.timestamp.getTime()) < 60000
      );
      if (!isDupe) {
        allTrades.push(lt);
      }
    });

    // Sort by timestamp
    allTrades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    console.log('[TradeHistory] Total merged trades:', allTrades.length);

    // 4. Build per-asset analytics
    const assetAnalytics = {};
    const symbolsToAnalyze = symbols.length > 0 
      ? symbols.map(s => s.toUpperCase()) 
      : [...new Set(allTrades.map(t => t.symbol))];

    for (const symbol of symbolsToAnalyze) {
      const symbolTrades = allTrades.filter(t => t.symbol === symbol);
      if (symbolTrades.length === 0) continue;

      const buys = symbolTrades.filter(t => t.type === 'buy');
      const sells = symbolTrades.filter(t => t.type === 'sell');

      // Calculate buy price statistics
      const buyPrices = buys.map(b => b.price).filter(p => p > 0);
      const avgBuyPrice = buyPrices.length > 0 
        ? buyPrices.reduce((a, b) => a + b, 0) / buyPrices.length 
        : 0;
      const minBuyPrice = buyPrices.length > 0 ? Math.min(...buyPrices) : 0;
      const maxBuyPrice = buyPrices.length > 0 ? Math.max(...buyPrices) : 0;

      // Calculate sell price statistics
      const sellPrices = sells.map(s => s.price).filter(p => p > 0);
      const avgSellPrice = sellPrices.length > 0 
        ? sellPrices.reduce((a, b) => a + b, 0) / sellPrices.length 
        : 0;

      // Calculate profit/loss for matched buy-sell pairs
      let totalPnL = 0;
      let winningTrades = 0;
      let losingTrades = 0;
      const pnlHistory = [];

      // Match sells to buys (FIFO) with fee-adjusted P&L
      const remainingBuys = [...buys];
      for (const sell of sells) {
        if (remainingBuys.length === 0) break;
        const matchedBuy = remainingBuys.shift();
        const matchedQty = Math.min(sell.quantity, matchedBuy.quantity);
        const grossPnl = (sell.price - matchedBuy.price) * matchedQty;
        const totalFees = (matchedBuy.fee || 0) + (sell.fee || 0);
        const netPnl = grossPnl - totalFees;
        totalPnL += netPnl;
        pnlHistory.push({
          buyPrice: matchedBuy.price,
          sellPrice: sell.price,
          quantity: matchedQty,
          pnl: netPnl,
          grossPnl: grossPnl,
          fees: totalFees,
          pnlPercent: matchedBuy.price > 0 ? ((sell.price - matchedBuy.price) / matchedBuy.price) * 100 : 0,
          netPnlPercent: (matchedBuy.price * matchedQty) > 0 ? (netPnl / (matchedBuy.price * matchedQty)) * 100 : 0,
          timestamp: sell.timestamp
        });
        if (netPnl > 0) winningTrades++;
        else losingTrades++;
      }

      // Calculate optimal zones based on history
      const successfulBuys = pnlHistory.filter(p => p.pnl > 0).map(p => p.buyPrice);
      const optimalBuyZone = successfulBuys.length > 0 
        ? {
            low: Math.min(...successfulBuys) * 0.95,
            mid: successfulBuys.reduce((a, b) => a + b, 0) / successfulBuys.length,
            high: Math.max(...successfulBuys) * 1.05
          }
        : { low: avgBuyPrice * 0.9, mid: avgBuyPrice, high: avgBuyPrice * 1.1 };

      const successfulSells = pnlHistory.filter(p => p.pnl > 0).map(p => p.sellPrice);
      const avgSuccessfulGain = pnlHistory.filter(p => p.pnl > 0).length > 0
        ? pnlHistory.filter(p => p.pnl > 0).reduce((a, p) => a + p.pnlPercent, 0) / pnlHistory.filter(p => p.pnl > 0).length
        : 5;

      // Time-based analysis
      const tradesByHour = {};
      symbolTrades.forEach(t => {
        const hour = t.timestamp.getHours();
        if (!tradesByHour[hour]) tradesByHour[hour] = { buys: 0, sells: 0 };
        if (t.type === 'buy') tradesByHour[hour].buys++;
        else tradesByHour[hour].sells++;
      });

      // Find best trading hours
      const bestBuyHours = Object.entries(tradesByHour)
        .filter(([_, v]) => v.buys > 0)
        .sort((a, b) => b[1].buys - a[1].buys)
        .slice(0, 3)
        .map(([hour]) => parseInt(hour));

      assetAnalytics[symbol] = {
        symbol,
        total_trades: symbolTrades.length,
        total_buys: buys.length,
        total_sells: sells.length,
        total_volume_usd: symbolTrades.reduce((sum, t) => sum + (t.total_value || 0), 0),
        
        // Price statistics
        avg_buy_price: avgBuyPrice,
        min_buy_price: minBuyPrice,
        max_buy_price: maxBuyPrice,
        avg_sell_price: avgSellPrice,
        
        // PnL analysis
        total_pnl: totalPnL,
        winning_trades: winningTrades,
        losing_trades: losingTrades,
        win_rate: winningTrades + losingTrades > 0 
          ? (winningTrades / (winningTrades + losingTrades)) * 100 
          : 0,
        avg_successful_gain_pct: avgSuccessfulGain,
        
        // Optimal zones (for AI to use)
        optimal_buy_zone: optimalBuyZone,
        expected_sell_gain_pct: avgSuccessfulGain,
        
        // Timing insights
        best_buy_hours_utc: bestBuyHours,
        
        // Total fees
        total_fees: symbolTrades.reduce((sum, t) => sum + (t.fee || 0), 0),
        
        // Recent activity with P&L context
        last_trade_date: symbolTrades[symbolTrades.length - 1]?.timestamp,
        recent_trades: pnlHistory.slice(-5).map(p => ({
          type: 'round_trip',
          buyPrice: p.buyPrice,
          sellPrice: p.sellPrice,
          quantity: p.quantity,
          pnl: p.pnl,
          pnlPercent: p.pnlPercent,
          fees: p.fees || 0,
          timestamp: p.timestamp
        }))
      };
    }

    console.log('[TradeHistory] Built analytics for', Object.keys(assetAnalytics).length, 'assets');

    // 5. AI Pattern Analysis (if requested)
    let aiInsights = null;
    if (analyzePatterns && Object.keys(assetAnalytics).length > 0) {
      try {
        const analyticsSection = Object.values(assetAnalytics).map(a => 
          `${a.symbol}: ${a.total_trades} trades, Win rate: ${a.win_rate.toFixed(1)}%, Avg gain: ${a.avg_successful_gain_pct.toFixed(1)}%, Optimal buy: $${a.optimal_buy_zone.mid.toFixed(4)}`
        ).join('\n');

        const aiResponse = await base44.integrations.Core.InvokeLLM({
          prompt: `You are an expert quantitative trader analyzing historical trade data to identify patterns and optimal entry/exit points.

HISTORICAL TRADE DATA:
${analyticsSection}

ANALYSIS TASKS:
1. For each asset, identify the optimal buy-in price zone based on historical successful trades
2. Calculate expected sell targets based on historical win rates and gains
3. Identify any time-based patterns (best hours/days to trade)
4. Flag any assets that have consistently poor performance
5. Recommend which assets show the strongest historical patterns for profitable trades
6. Suggest specific price levels for auto-trading take-profit and stop-loss

Provide actionable intelligence for automated trading decisions.`,
          add_context_from_internet: false,
          response_json_schema: {
            type: "object",
            properties: {
              asset_insights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    recommended_buy_zone: { 
                      type: "object", 
                      properties: { 
                        low: { type: "number" }, 
                        high: { type: "number" } 
                      } 
                    },
                    expected_sell_target_pct: { type: "number" },
                    suggested_stop_loss_pct: { type: "number" },
                    historical_pattern: { type: "string" },
                    confidence_from_history: { type: "number" },
                    best_trade_timing: { type: "string" },
                    risk_assessment: { type: "string" }
                  }
                }
              },
              top_performers: { type: "array", items: { type: "string" } },
              avoid_list: { type: "array", items: { type: "string" } },
              market_timing_insight: { type: "string" },
              portfolio_recommendation: { type: "string" }
            }
          }
        });

        aiInsights = aiResponse;
        console.log('[TradeHistory] AI insights generated');
      } catch (aiErr) {
        console.warn('[TradeHistory] AI analysis failed:', aiErr.message);
      }
    }

    // 6. Build summary statistics
    const allLiveTrades = allTrades.filter(t => !t.is_simulation);
    const allSimTrades = allTrades.filter(t => t.is_simulation);

    const summary = {
      total_trades: allTrades.length,
      live_trades: allLiveTrades.length,
      simulation_trades: allSimTrades.length,
      unique_assets: Object.keys(assetAnalytics).length,
      total_volume_usd: allTrades.reduce((sum, t) => sum + (t.total_value || 0), 0),
      date_range: {
        first_trade: allTrades[0]?.timestamp,
        last_trade: allTrades[allTrades.length - 1]?.timestamp
      },
      overall_win_rate: Object.values(assetAnalytics).reduce((sum, a) => sum + a.win_rate, 0) / 
        Math.max(Object.keys(assetAnalytics).length, 1),
      best_performing_assets: Object.values(assetAnalytics)
        .sort((a, b) => b.win_rate - a.win_rate)
        .slice(0, 5)
        .map(a => ({ symbol: a.symbol, win_rate: a.win_rate, avg_gain: a.avg_successful_gain_pct }))
    };

    return Response.json({
      success: true,
      summary,
      asset_analytics: assetAnalytics,
      ai_insights: aiInsights,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[TradeHistory] Error:', error);
    return Response.json({
      success: true,
      summary: {
        total_trades: 0,
        live_trades: 0,
        simulation_trades: 0,
        unique_assets: 0,
        total_volume_usd: 0,
        date_range: {
          first_trade: null,
          last_trade: null
        },
        overall_win_rate: 0,
        best_performing_assets: []
      },
      asset_analytics: {},
      ai_insights: null,
      degraded: true,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
});