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
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user settings (prefer server sort by -updated_date)
    let list = [];
    try {
      list = await base44.entities.UserSettings.filter(
        { created_by: user.email },
        '-updated_date',
        50
      );
    } catch (_e) {
      // Fallback: try without sort
      list = await base44.entities.UserSettings.filter({ created_by: user.email });
      // Sort on server response just in case
      list.sort((a, b) => {
        const au = new Date(a?.updated_date || a?.created_date || 0).getTime();
        const bu = new Date(b?.updated_date || b?.created_date || 0).getTime();
        return bu - au;
      });
    }

    const latest = list[0] || null;

    // Defaults if none exist
    const DEFAULTS = {
      dark_mode: true,
      auto_trading_enabled: false,
      notifications_enabled: true,
      notify_on_trade: true,
      notify_on_deposit_withdrawal: true,
      notify_on_market_news: false,
      bank_connected: false,
      preferred_currency: 'USD',
      default_input_mode: 'quantity',
      sim_trading_mode: true,
      has_seen_welcome: false,
      credits_balance: 0,
      tts_enabled: true,
      tts_voice_uri: '',
      biometrics_enabled: false,
      has_seen_biometrics_prompt: false,
      time_format: '12h'
    };

    const settings = latest ? { ...DEFAULTS, ...latest } : { ...DEFAULTS };

    // Normalize sim mode: SIM when not explicitly false
    settings.sim_trading_mode = normalizeBoolean(settings.sim_trading_mode, true);

    // Provide a concise summary for consumers (avoids re-deriving)
    const summary = {
      isSimMode: settings.sim_trading_mode !== false,
      source: latest ? 'latest_record' : 'defaults',
      record_id: latest?.id || null,
      updated_at: latest?.updated_date || latest?.created_date || null,
      duplicates: Math.max(0, list.length - 1)
    };

    return Response.json({ settings, summary }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unknown error' }, { status: 500 });
  }
});