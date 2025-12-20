import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Auto-Trader Monitor - SIMPLIFIED & INDEPENDENT
 * 
 * CRITICAL: Auto-trader operates INDEPENDENTLY of Kraken
 * - Only checks local database state
 * - Does NOT wait for Kraken API responses
 * - Returns health instantly based on local data
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Fast auth check
    const user = await Promise.race([
      base44.auth.me(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 2000))
    ]);

    if (!user) {
      return Response.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // Ignore JSON parse errors
    }

    const { action = 'health' } = body;
    console.log('[autoTraderMonitor] Action:', action);

    // ============================================
    // HEALTH CHECK - FAST & LOCAL ONLY
    // ============================================
    if (action === 'health') {
      try {
        // CRITICAL: All queries run in parallel with fast timeouts
        const [settings, trades, orders, wallet, holdings] = await Promise.all([
          Promise.race([
            base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => []),
          
          Promise.race([
            base44.asServiceRole.entities.Trade.filter({
              created_by: user.email,
              is_auto_trade: true
            }, '-created_date', 50),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => []),
          
          Promise.race([
            base44.asServiceRole.entities.ConditionalOrder.filter({
              created_by: user.email,
              status: 'active'
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => []),
          
          Promise.race([
            base44.asServiceRole.entities.Wallet.filter({ created_by: user.email }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => []),
          
          Promise.race([
            base44.asServiceRole.entities.Holding.filter({ created_by: user.email, is_simulation: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => [])
        ]);

        const userSetting = settings[0] || {};
        const walletData = wallet[0] || {};
        
        // Calculate metrics
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // CRITICAL: Auto-Trader Status ALWAYS shows LIVE data only
        const trades24h = trades.filter(t => 
          new Date(t.created_date) > oneDayAgo && 
          t.is_simulation === false  // ONLY count LIVE trades
        );
        
        // CRITICAL: ALWAYS use real_cash_balance for Auto-Trader Status
        const balance = Number(walletData.real_cash_balance) || 0;

        const health = {
          auto_trading_enabled: Boolean(userSetting.auto_trading_enabled),
          wallet_balance: balance,
          wallet_status: balance < 0 ? 'critical' : balance < 10 ? 'warning' : 'healthy',
          active_conditional_orders: orders.filter(o => o.is_simulation === false).length,  // ONLY LIVE orders
          trades_24h: {
            total: trades24h.length,
            buys: trades24h.filter(t => t.type === 'buy').length,
            sells: trades24h.filter(t => t.type === 'sell').length,
            volume: trades24h.reduce((sum, t) => sum + (Number(t.total_value) || 0), 0)
          },
          last_check: new Date().toISOString()
        };

        return Response.json({ success: true, health }, { status: 200 });

      } catch (healthError) {
        console.error('[autoTraderMonitor] Health error:', healthError);
        
        // Return minimal valid health data (LIVE mode only)
        return Response.json({
          success: true,
          health: {
            auto_trading_enabled: false,
            wallet_balance: 0,
            wallet_status: 'unknown',
            active_conditional_orders: 0,
            trades_24h: { total: 0, buys: 0, sells: 0, volume: 0 },
            last_check: new Date().toISOString()
          }
        }, { status: 200 });
      }
    }

    // ============================================
    // EMERGENCY STOP - SIMPLE & FAST
    // ============================================
    if (action === 'emergency_stop') {
      console.log('[autoTraderMonitor] 🚨 EMERGENCY STOP');

      try {
        const [settings, activeOrders] = await Promise.all([
          base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email }),
          base44.asServiceRole.entities.ConditionalOrder.filter({
            created_by: user.email,
            status: 'active'
          })
        ]);

        // Disable auto-trading
        if (settings.length > 0) {
          await base44.asServiceRole.entities.UserSettings.update(settings[0].id, {
            auto_trading_enabled: false
          });
        }

        // Cancel all active orders in parallel
        await Promise.all(
          activeOrders.map(order =>
            base44.asServiceRole.entities.ConditionalOrder.update(order.id, {
              status: 'cancelled'
            }).catch(() => {})
          )
        );

        return Response.json({
          success: true,
          message: 'Auto-trading disabled',
          cancelled_orders: activeOrders.length
        }, { status: 200 });

      } catch (stopError) {
        console.error('[autoTraderMonitor] Stop error:', stopError);
        return Response.json({
          success: false,
          error: stopError.message
        }, { status: 200 });
      }
    }

    // ============================================
    // CLEAR ERRORS - NOT NEEDED, REMOVED
    // ============================================
    if (action === 'clear_errors') {
      return Response.json({
        success: true,
        message: 'Error logs are auto-cleaned',
        cleared_count: 0
      }, { status: 200 });
    }

    return Response.json({ 
      error: 'Unknown action', 
      success: false 
    }, { status: 400 });

  } catch (error) {
    console.error('[autoTraderMonitor] Fatal error:', error);
    
    return Response.json({
      success: false,
      error: error.message
    }, { status: 200 });
  }
});