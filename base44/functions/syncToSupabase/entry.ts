import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SUPABASE_URL = 'https://ebcblyznnbaqbuvlkkjy.supabase.co';

const ENTITIES_TO_SYNC = [
  'Wallet', 'UserSettings', 'AutoBuyPreference', 'AssetSignal',
  'MarketIntelligenceCache', 'AssetCache', 'AssetChartCache', 'StockMoversCache',
  'Holding', 'HoldingsSnapshot', 'Trade', 'ConditionalOrder',
  'LedgerEntry', 'Transaction', 'KrakenLog', 'AutoTraderRun',
  'SystemHealth', 'Notification', 'GovSpendingAward', 'ApiRateCounter'
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role || '').toLowerCase() !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabaseKey = Deno.env.get('SUPABASE_SECRET_KEY');
    if (!supabaseKey) {
      return Response.json({ error: 'SUPABASE_SECRET_KEY not configured' }, { status: 500 });
    }

    const supabaseHeaders = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    };

    // Load all SyncState cursors in one call
    const allCursors = await base44.asServiceRole.entities.SyncState.filter({});
    const cursorMap = {};
    for (const c of allCursors) {
      cursorMap[c.entity_name] = c;
    }

    const summary = [];
    let totalSynced = 0;
    let totalErrors = 0;

    for (const entityName of ENTITIES_TO_SYNC) {
      try {
        const cursor = cursorMap[entityName];
        const lastSynced = cursor ? cursor.last_synced_at : null;

        // Build filter: if we have a cursor, only pull records updated after it
        let records;
        if (lastSynced) {
          records = await base44.asServiceRole.entities[entityName].filter(
            { updated_date: { $gt: lastSynced } },
            'updated_date',
            500
          );
        } else {
          // First run — pull everything (up to 500 per cycle; subsequent runs catch the rest)
          records = await base44.asServiceRole.entities[entityName].filter({}, 'updated_date', 500);
        }

        if (records.length === 0) {
          summary.push({ entity: entityName, synced: 0, status: 'ok' });
          continue;
        }

        // Upsert to Supabase in chunks of 100
        const CHUNK = 100;
        let syncedCount = 0;
        for (let i = 0; i < records.length; i += CHUNK) {
          const chunk = records.slice(i, i + CHUNK);

          // PostgREST requires every object in a batch to have identical keys.
          // Collect the union of all keys across this chunk, then normalize
          // every record so missing fields are explicitly null.
          const allKeys = new Set();
          for (const rec of chunk) {
            for (const k of Object.keys(rec)) allKeys.add(k);
          }
          const normalizedChunk = chunk.map(rec => {
            const out = {};
            for (const k of allKeys) {
              out[k] = rec[k] !== undefined ? rec[k] : null;
            }
            return out;
          });

          const url = `${SUPABASE_URL}/rest/v1/${entityName}?on_conflict=id`;
          const res = await fetch(url, {
            method: 'POST',
            headers: supabaseHeaders,
            body: JSON.stringify(normalizedChunk)
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Supabase POST ${entityName} ${res.status}: ${errText}`);
          }
          syncedCount += chunk.length;
        }

        // Update cursor to the max updated_date in the batch
        const maxDate = records[records.length - 1].updated_date;
        if (cursor) {
          await base44.asServiceRole.entities.SyncState.update(cursor.id, { last_synced_at: maxDate });
        } else {
          await base44.asServiceRole.entities.SyncState.create({ entity_name: entityName, last_synced_at: maxDate });
        }

        totalSynced += syncedCount;
        summary.push({ entity: entityName, synced: syncedCount, status: 'ok' });
        console.log(`[syncToSupabase] ${entityName}: ${syncedCount} rows synced`);
      } catch (entityErr) {
        totalErrors++;
        const msg = entityErr.message || String(entityErr);
        summary.push({ entity: entityName, synced: 0, status: 'error', error: msg });
        console.error(`[syncToSupabase] ${entityName} FAILED:`, msg);
      }
    }

    // Log to SystemHealth
    try {
      const existing = await base44.asServiceRole.entities.SystemHealth.filter({ component: 'supabase_sync' }, '-updated_date', 1);
      const healthData = {
        component: 'supabase_sync',
        status: totalErrors === 0 ? 'healthy' : (totalErrors < 5 ? 'degraded' : 'unhealthy'),
        last_success_at: new Date().toISOString(),
        error_count_1h: totalErrors,
        metrics_json: JSON.stringify({ total_synced: totalSynced, total_errors: totalErrors, summary })
      };
      if (totalErrors > 0) {
        healthData.last_error_at = new Date().toISOString();
        healthData.last_error_message = summary.filter(s => s.status === 'error').map(s => `${s.entity}: ${s.error}`).join('; ').slice(0, 500);
      }
      if (existing.length > 0) {
        await base44.asServiceRole.entities.SystemHealth.update(existing[0].id, healthData);
      } else {
        await base44.asServiceRole.entities.SystemHealth.create(healthData);
      }
    } catch (healthErr) {
      console.warn('[syncToSupabase] Failed to update SystemHealth:', healthErr.message);
    }

    return Response.json({
      success: true,
      total_synced: totalSynced,
      total_errors: totalErrors,
      summary
    });
  } catch (error) {
    console.error('[syncToSupabase] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});