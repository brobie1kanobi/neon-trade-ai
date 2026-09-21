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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * TRANSIENT vs BLOCKING errors.
 *
 * Kraken answers a rate-limited account with "EGeneral:Temporary lockout" and,
 * during that lockout, sometimes with a misleading "unknown key". Those are
 * throttling responses, not broken infrastructure — counting them toward the
 * auto-pause threshold is what blocked auto-trading with 34 phantom errors.
 * They are still recorded (last_error_message + a transient counter) for
 * visibility, but they never increment the blocking counters or pause trading.
 */
function isTransientError(message) {
  return /lockout|unknown key|rate limit|too many requests|429|timeout/i.test(String(message || ''));
}

/** Parse metrics_json safely. */
function parseMetrics(record) {
  try {
    const m = JSON.parse(record?.metrics_json || '{}');
    return m && typeof m === 'object' ? m : {};
  } catch (_e) {
    return {};
  }
}

/** Keep only error timestamps from the last 24h, so the 24h count decays. */
function pruneErrorTimes(times, nowMs) {
  if (!Array.isArray(times)) return [];
  return times
    .map(t => new Date(t).getTime())
    .filter(t => Number.isFinite(t) && nowMs - t < DAY_MS)
    .slice(-500)
    .map(t => new Date(t).toISOString());
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if ((user.role || '').toLowerCase() !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
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
        
        const existing = await base44.asServiceRole.entities.SystemHealth.filter({
          component
        });
        
        const now = new Date().toISOString();
        const nowMs = Date.now();
        const transient = isTransientError(error_message);
        
        let record;
        if (existing.length > 0) {
          record = existing[0];
          const metrics = parseMetrics(record);

          // Rolling 24h window: error_count_24h is DERIVED from timestamps in
          // the last 24 hours, never a lifetime accumulator, so the system
          // self-unblocks once the errors age out.
          const errorTimes = pruneErrorTimes(metrics.error_times, nowMs);
          if (!transient) errorTimes.push(now);

          const newErrorCount1h = transient
            ? (record.error_count_1h || 0)
            : (record.error_count_1h || 0) + 1;
          const newErrorCount24h = errorTimes.length;
          const transientCount = (Number(metrics.transient_count) || 0) + (transient ? 1 : 0);

          // Check if should auto-pause — transient throttling never pauses.
          let shouldPause = false;
          let pauseReason = null;
          
          if (!transient && newErrorCount1h >= THRESHOLDS.errorRate1h) {
            shouldPause = true;
            pauseReason = `Error rate exceeded: ${newErrorCount1h} errors in 1 hour`;
          }

          // A transient error must never downgrade an otherwise healthy
          // component — keep whatever status the real signals produced.
          const nextStatus = shouldPause
            ? 'unhealthy'
            : transient
              ? (record.status === 'unhealthy' ? 'unhealthy' : record.status || 'healthy')
              : 'degraded';
          
          await base44.asServiceRole.entities.SystemHealth.update(record.id, {
            status: nextStatus,
            error_count_1h: newErrorCount1h,
            error_count_24h: newErrorCount24h,
            last_error_at: now,
            last_error_message: error_message || 'Unknown error',
            is_auto_paused: shouldPause ? true : (transient ? !!record.is_auto_paused : false),
            pause_reason: shouldPause ? pauseReason : (transient ? record.pause_reason || null : null),
            metrics_json: JSON.stringify({
              ...metrics,
              error_times: errorTimes,
              transient_count: transientCount,
              last_error_transient: transient,
              last_transient_at: transient ? now : metrics.last_transient_at || null
            })
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
            status: transient ? 'healthy' : 'degraded',
            error_count_1h: transient ? 0 : 1,
            error_count_24h: transient ? 0 : 1,
            last_error_at: now,
            last_error_message: error_message || 'Unknown error',
            is_auto_paused: false,
            metrics_json: JSON.stringify({
              error_times: transient ? [] : [now],
              transient_count: transient ? 1 : 0,
              last_error_transient: transient
            })
          });
        }
        
        return Response.json({ success: true, transient });
      }

      // Cheap check used before any Kraken reconnection attempt: is this
      // component currently paused/unhealthy (i.e. in cooldown)?
      case 'isLockedOut': {
        const target = component || 'kraken_api';
        const existing = await base44.asServiceRole.entities.SystemHealth.filter({
          component: target
        });
        const record = existing[0];
        const lockedOut = !!record && (record.is_auto_paused === true || record.status === 'unhealthy');
        return Response.json({
          success: true,
          component: target,
          locked_out: lockedOut,
          status: record?.status || 'unknown',
          error_count_1h: record?.error_count_1h || 0,
          error_count_24h: record?.error_count_24h || 0,
          reason: record?.pause_reason || record?.last_error_message || null
        });
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
        // Called by scheduled job every hour. Also prunes the rolling 24h
        // window so error_count_24h decays instead of accumulating forever —
        // this is what lets a component recover on its own.
        const allRecords = await base44.asServiceRole.entities.SystemHealth.filter({});
        const nowMs = Date.now();
        
        for (const record of allRecords) {
          const metrics = parseMetrics(record);
          const errorTimes = pruneErrorTimes(metrics.error_times, nowMs);
          const stillUnhealthy = errorTimes.length >= THRESHOLDS.errorRate1h;

          await base44.asServiceRole.entities.SystemHealth.update(record.id, {
            error_count_1h: 0,
            error_count_24h: errorTimes.length,
            // With the hourly counter cleared and no recent real errors left,
            // release the auto-pause so trading resumes without manual reset.
            status: stillUnhealthy ? record.status : 'healthy',
            is_auto_paused: stillUnhealthy ? record.is_auto_paused : false,
            pause_reason: stillUnhealthy ? record.pause_reason : null,
            metrics_json: JSON.stringify({ ...metrics, error_times: errorTimes })
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