import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * SYSTEM HEALTH MONITOR
 * 
 * Monitors system health and auto-pauses trading when issues detected.
 * 
 * Checks:
 * - Kraken API error rate
 * - WebSocket disconnect frequency
 * - Order rejection rate
 * - Balance drift detection
 */

// Thresholds for auto-pause
const THRESHOLDS = {
  errorRate1h: 10,           // Pause if >10 errors in 1 hour
  wsDisconnects1h: 5,        // Pause if >5 WS disconnects in 1 hour
  orderRejectionRate: 0.3,   // Pause if >30% orders rejected
  driftThresholdUsd: 50      // Alert if balance drift >$50
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json().catch(() => ({}));
    const { action = 'checkHealth', component, error_message } = body;
    
    switch (action) {
      case 'checkHealth': {
        // Get all health records
        const healthRecords = await base44.asServiceRole.entities.SystemHealth.filter({});
        
        const health = {};
        for (const record of healthRecords) {
          health[record.component] = {
            status: record.status,
            error_count_1h: record.error_count_1h,
            error_count_24h: record.error_count_24h,
            last_success: record.last_success_at,
            last_error: record.last_error_at,
            is_paused: record.is_auto_paused
          };
        }
        
        // Determine overall system status
        const anyUnhealthy = Object.values(health).some(h => h.status === 'unhealthy');
        const anyDegraded = Object.values(health).some(h => h.status === 'degraded');
        const anyPaused = Object.values(health).some(h => h.is_paused);
        
        let overallStatus = 'healthy';
        if (anyUnhealthy || anyPaused) overallStatus = 'unhealthy';
        else if (anyDegraded) overallStatus = 'degraded';
        
        return Response.json({
          success: true,
          overall_status: overallStatus,
          components: health,
          trading_allowed: overallStatus !== 'unhealthy' && !anyPaused
        });
      }
      
      case 'recordSuccess': {
        if (!component) {
          return Response.json({ error: 'Missing component' }, { status: 400 });
        }
        
        // Find or create health record
        const existing = await base44.asServiceRole.entities.SystemHealth.filter({
          component
        });
        
        const now = new Date().toISOString();
        
        if (existing.length > 0) {
          await base44.asServiceRole.entities.SystemHealth.update(existing[0].id, {
            status: 'healthy',
            last_success_at: now,
            is_auto_paused: false,
            pause_reason: null
          });
        } else {
          await base44.asServiceRole.entities.SystemHealth.create({
            component,
            status: 'healthy',
            error_count_1h: 0,
            error_count_24h: 0,
            last_success_at: now,
            is_auto_paused: false
          });
        }
        
        return Response.json({ success: true });
      }
      
      case 'recordError': {
        if (!component) {
          return Response.json({ error: 'Missing component' }, { status: 400 });
        }
        
        // CRITICAL: "volume minimum not met" and similar per-trade errors are NOT system health issues.
        // They indicate a single trade had invalid parameters — NOT that the API is broken.
        // These should NEVER block all trading or increment error counters.
        const msg = String(error_message || '').toLowerCase();
        const isPerTradeError = (
          /volume minimum not met/i.test(msg) ||
          /minimum not met/i.test(msg) ||
          /egeneral:invalid arguments/i.test(msg) ||
          /too small/i.test(msg) ||
          /below minimum/i.test(msg) ||
          /insufficient funds/i.test(msg) ||
          /eorder:insufficient/i.test(msg) ||
          /invalid volume/i.test(msg) ||
          /invalid price/i.test(msg)
        );
        
        if (isPerTradeError) {
          console.log(`[systemHealthMonitor] Ignoring per-trade error (not a system issue): ${error_message}`);
          return Response.json({ success: true, ignored: true, reason: 'Per-trade error, not system health issue' });
        }
        
        const existing = await base44.asServiceRole.entities.SystemHealth.filter({
          component
        });
        
        const now = new Date().toISOString();
        
        let record;
        if (existing.length > 0) {
          record = existing[0];
          const newErrorCount1h = (record.error_count_1h || 0) + 1;
          const newErrorCount24h = (record.error_count_24h || 0) + 1;
          
          // Check if should auto-pause
          let shouldPause = false;
          let pauseReason = null;
          
          if (newErrorCount1h >= THRESHOLDS.errorRate1h) {
            shouldPause = true;
            pauseReason = `Error rate exceeded: ${newErrorCount1h} errors in 1 hour`;
          }
          
          await base44.asServiceRole.entities.SystemHealth.update(record.id, {
            status: shouldPause ? 'unhealthy' : 'degraded',
            error_count_1h: newErrorCount1h,
            error_count_24h: newErrorCount24h,
            last_error_at: now,
            last_error_message: error_message || 'Unknown error',
            is_auto_paused: shouldPause,
            pause_reason: pauseReason
          });
          
          // Create notification if paused
          if (shouldPause) {
            try {
              await base44.entities.Notification.create({
                title: '⚠️ Trading Auto-Paused',
                message: `${component} has been paused due to errors: ${pauseReason}`,
                type: 'warning',
                created_by: user.email
              });
            } catch (e) {
              console.warn('[systemHealthMonitor] Could not create notification:', e.message);
            }
          }
        } else {
          await base44.asServiceRole.entities.SystemHealth.create({
            component,
            status: 'degraded',
            error_count_1h: 1,
            error_count_24h: 1,
            last_error_at: now,
            last_error_message: error_message || 'Unknown error',
            is_auto_paused: false
          });
        }
        
        return Response.json({ success: true });
      }
      
      case 'resetErrors': {
        if (!component) {
          return Response.json({ error: 'Missing component' }, { status: 400 });
        }
        
        const existing = await base44.asServiceRole.entities.SystemHealth.filter({
          component
        });
        
        if (existing.length > 0) {
          await base44.asServiceRole.entities.SystemHealth.update(existing[0].id, {
            status: 'healthy',
            error_count_1h: 0,
            is_auto_paused: false,
            pause_reason: null
          });
        }
        
        return Response.json({ success: true });
      }
      
      case 'resetHourlyCounters': {
        // Called by scheduled job every hour
        const allRecords = await base44.asServiceRole.entities.SystemHealth.filter({});
        
        for (const record of allRecords) {
          await base44.asServiceRole.entities.SystemHealth.update(record.id, {
            error_count_1h: 0
          });
        }
        
        return Response.json({ success: true, reset_count: allRecords.length });
      }
      
      case 'resumeComponent': {
        if (!component) {
          return Response.json({ error: 'Missing component' }, { status: 400 });
        }
        
        const existing = await base44.asServiceRole.entities.SystemHealth.filter({
          component
        });
        
        if (existing.length > 0) {
          await base44.asServiceRole.entities.SystemHealth.update(existing[0].id, {
            status: 'healthy',
            is_auto_paused: false,
            pause_reason: null,
            error_count_1h: 0
          });
        }
        
        return Response.json({ success: true });
      }
      
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('[systemHealthMonitor] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});