import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SUPABASE_URL = 'https://ebcblyznnbaqbuvlkkjy.supabase.co';

const ENTITIES_TO_SYNC = [
  'Wallet', 'UserSettings', 'AutoBuyPreference', 'AssetSignal',
  'MarketIntelligenceCache', 'AssetCache', 'AssetChartCache', 'StockMoversCache',
  'Holding', 'HoldingsSnapshot', 'Trade', 'ConditionalOrder',
  'LedgerEntry', 'Transaction', 'KrakenLog', 'AutoTraderRun',
  'SystemHealth', 'Notification', 'ApiRateCounter'
];

const UPSERT_CHUNK = 500;
const CONCURRENCY = 5; // max parallel entity fetches

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

    // 1. Load all SyncState cursors in one call
    const allCursors = await base44.asServiceRole.entities.SyncState.filter({});
    const cursorMap = {};
    for (const c of allCursors) {
      cursorMap[c.entity_name] = c;
    }

    // 2. Fetch changed records for all entities in parallel (batched concurrency)
    const fetchResults = [];
    for (let i = 0; i < ENTITIES_TO_SYNC.length; i += CONCURRENCY) {
      const batch = ENTITIES_TO_SYNC.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (entityName) => {
          const cursor = cursorMap[entityName];
          const lastSynced = cursor ? cursor.last_synced_at : null;
          const filter = lastSynced ? { updated_date: { $gt: lastSynced } } : {};
          const records = await base44.asServiceRole.entities[entityName].filter(filter, 'updated_date', 500);
          return { entityName, records };
        })
      );
      fetchResults.push(...results);
    }

    // 3. Upsert to Supabase — only entities with changed records
    const summary = [];
    let totalSynced = 0;
    let totalErrors = 0;
    const cursorUpdates = []; // collect cursor changes for batch write

    for (const result of fetchResults) {
      if (result.status === 'rejected') {
        totalErrors++;
        summary.push({ entity: '?', synced: 0, status: 'error', error: result.reason?.message || String(result.reason) });
        continue;
      }

      const { entityName, records } = result.value;

      if (records.length === 0) {
        summary.push({ entity: entityName, synced: 0, status: 'ok' });
        continue;
      }

      try {
        // Upsert in chunks (500 rows per POST to minimize round-trips)
        let syncedCount = 0;
        for (let i = 0; i < records.length; i += UPSERT_CHUNK) {
          const chunk = records.slice(i, i + UPSERT_CHUNK);

          // PostgREST requires identical keys across all rows in a batch
          const allKeys = new Set();
          for (const rec of chunk) {
            for (const k of Object.keys(rec)) allKeys.add(k);
          }
          const normalized = chunk.map(rec => {
            const out = {};
            for (const k of allKeys) {
              out[k] = rec[k] !== undefined ? rec[k] : null;
            }
            return out;
          });

          const res = await fetch(`${SUPABASE_URL}/rest/v1/${entityName}?on_conflict=id`, {
            method: 'POST',
            headers: supabaseHeaders,
            body: JSON.stringify(normalized)
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Supabase POST ${entityName} ${res.status}: ${errText}`);
          }
          syncedCount += chunk.length;
        }

        // Queue cursor update (don't write individually)
        const maxDate = records[records.length - 1].updated_date;
        const existing = cursorMap[entityName];
        cursorUpdates.push({ entityName, maxDate, existingId: existing?.id || null });

        totalSynced += syncedCount;
        summary.push({ entity: entityName, synced: syncedCount, status: 'ok' });
      } catch (entityErr) {
        totalErrors++;
        summary.push({ entity: entityName, synced: 0, status: 'error', error: entityErr.message || String(entityErr) });
        console.error(`[syncToSupabase] ${entityName} FAILED:`, entityErr.message);
      }
    }

    // 4. Batch-write all cursor updates (one bulkUpdate + one bulkCreate)
    try {
      const toUpdate = cursorUpdates.filter(c => c.existingId);
      const toCreate = cursorUpdates.filter(c => !c.existingId);

      if (toUpdate.length > 0) {
        await base44.asServiceRole.entities.SyncState.bulkUpdate(
          toUpdate.map(c => ({ id: c.existingId, last_synced_at: c.maxDate }))
        );
      }
      if (toCreate.length > 0) {
        await base44.asServiceRole.entities.SyncState.bulkCreate(
          toCreate.map(c => ({ entity_name: c.entityName, last_synced_at: c.maxDate }))
        );
      }
    } catch (cursorErr) {
      console.warn('[syncToSupabase] Failed to batch-update cursors:', cursorErr.message);
    }

    // 5. Single SystemHealth update
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

    console.log(`[syncToSupabase] Done: ${totalSynced} synced, ${totalErrors} errors`);
    return Response.json({ success: true, total_synced: totalSynced, total_errors: totalErrors, summary });
  } catch (error) {
    console.error('[syncToSupabase] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});