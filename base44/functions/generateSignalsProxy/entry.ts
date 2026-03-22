import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Proxy to ensure generateSignals always receives symbols and bypasses stale cross-function signals
// - Gathers symbols from AutoBuyPreference
// - Falls back to UserSettings.watched_crypto, then to safe defaults [BTC, ETH, SOL]
// - Forces refresh to prevent 1d signals (from other generators) from suppressing 4h generation

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Admin/creator-only guard (matches generateSignals protection)
    const isAdmin = (user?.role || '').toLowerCase() === 'admin';
    const isCreator = !!user?.is_creator;
    if (!isAdmin && !isCreator) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const bodySymbols = Array.isArray(body?.symbols) ? body.symbols : [];

    let symbols = bodySymbols.map((s) => String(s || '').toUpperCase());

    if (symbols.length === 0) {
      // 1) Try enabled AutoBuyPreference across users (service role bypasses RLS)
      try {
        const prefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({ enabled: true });
        const fromPrefs = Array.from(new Set((prefs || [])
          .map((p) => String(p.symbol || '').toUpperCase())
          .filter(Boolean)));
        if (fromPrefs.length > 0) symbols = fromPrefs;
      } catch (_) {}
    }

    if (symbols.length === 0) {
      // 2) Fallback to latest global UserSettings.watched_crypto
      try {
        const latestSettings = await base44.asServiceRole.entities.UserSettings.filter({}, '-updated_date', 1);
        const watched = Array.from(new Set(((latestSettings?.[0]?.watched_crypto) || [])
          .map((s) => String(s || '').toUpperCase())));
        if (watched.length > 0) symbols = watched;
      } catch (_) {}
    }

    if (symbols.length === 0) {
      // 3) Safe defaults to ensure analysis always runs
      symbols = ['BTC', 'ETH', 'SOL'];
    }

    // Force refresh so existing 1d signals don't suppress 4h generation
    const payload = { symbols, forceRefresh: true };

    const result = await base44.functions.invoke('generateSignals', payload);
    // base44.functions.invoke returns either a Response-like or plain JSON; normalize
    const data = result?.data ?? result;

    return Response.json({
      success: true,
      proxy: 'generateSignalsProxy',
      symbols_used: symbols,
      forwarded: data,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});