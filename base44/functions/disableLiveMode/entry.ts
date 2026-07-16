import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Allow only admins to force SIM for all users; non-admins will only fix their own settings.
    // Defense-in-depth against role-field tampering: the system-wide reset requires BOTH
    // the platform-authenticated admin role AND membership in an explicit admin-email
    // allowlist (DISABLE_LIVE_MODE_ADMINS, comma-separated). If the allowlist is not
    // configured, no caller is permitted to perform the all-users reset — it degrades
    // safely to self-only scope rather than trusting the role field alone.
    const roleIsAdmin = (me?.role || '').toLowerCase() === 'admin';
    const allowlist = (Deno.env.get('DISABLE_LIVE_MODE_ADMINS') || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const emailAllowed = allowlist.length > 0 && allowlist.includes((me.email || '').toLowerCase());
    const isAdmin = roleIsAdmin && emailAllowed;

    if (isAdmin) {
      // Service role: update every UserSettings record to sim_trading_mode = true
      const all = await base44.asServiceRole.entities.UserSettings.list();
      let updated = 0;
      for (const s of all) {
        if (s?.sim_trading_mode === false) {
          await base44.asServiceRole.entities.UserSettings.update(s.id, { sim_trading_mode: true });
          updated += 1;
        }
      }
      return Response.json({ success: true, scope: 'all_users', updated });
    }

    // Non-admin: enforce SIM for current user's records only
    const mine = await base44.entities.UserSettings.filter({ created_by: me.email }, '-updated_date', 100);
    let updated = 0;
    for (const s of mine) {
      if (s?.sim_trading_mode === false) {
        await base44.entities.UserSettings.update(s.id, { sim_trading_mode: true });
        updated += 1;
      }
    }
    return Response.json({ success: true, scope: 'self_only', updated });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
});