import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

function normalizeBoolean(v, defaultVal) {
  if (typeof v === 'boolean') return v;
  if (v === 0) return false;
  if (v === 1) return true;
  return defaultVal;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { desired_mode } = await (async () => {
      try { return await req.json(); } catch { return {}; }
    })();

    // Fetch all settings for this user (most recent first)
    let list = await base44.entities.UserSettings.filter(
      { created_by: me.email },
      '-updated_date',
      100
    );

    // Create a baseline record if none exists
    if (!Array.isArray(list) || list.length === 0) {
      const created = await base44.entities.UserSettings.create({
        created_by: me.email,
        sim_trading_mode: desired_mode ? (desired_mode !== 'live') : true
      });
      list = [created];
    }

    // Decide the canonical mode to enforce
    const latest = list[0];
    let canonicalSim =
      typeof desired_mode === 'string'
        ? (desired_mode !== 'live')
        : normalizeBoolean(latest?.sim_trading_mode, true);

    // Update all records that don’t match canonicalSim
    const updated = [];
    for (const s of list) {
      const cur = normalizeBoolean(s?.sim_trading_mode, true);
      if (cur !== canonicalSim) {
        const rec = await base44.entities.UserSettings.update(s.id, {
          sim_trading_mode: canonicalSim
        });
        updated.push(rec.id);
      }
    }

    // Return normalized settings (matching the latest after updates)
    const normalized = { ...latest, sim_trading_mode: canonicalSim };
    return Response.json({
      success: true,
      user: me.email,
      normalized_sim_mode: canonicalSim ? 'sim' : 'live',
      duplicates_count: Math.max(0, list.length - 1),
      updated_ids: updated,
      settings: normalized
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
});