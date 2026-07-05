import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (req.method !== 'POST') {
      return Response.json({ error: 'POST required' }, { status: 405 });
    }

    const body = await req.json();
    const { user_email, signals } = body;

    if (!user_email || typeof user_email !== 'string') {
      return Response.json({ error: 'Missing or invalid user_email' }, { status: 400 });
    }
    if (!Array.isArray(signals) || signals.length === 0) {
      return Response.json({ error: 'signals must be a non-empty array' }, { status: 400 });
    }

    // Validate required fields on every signal before doing any writes
    const REQUIRED = ['asset_symbol', 'asset_type', 'signal_type', 'confidence_score'];
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i];
      const missing = REQUIRED.filter(f => s[f] === undefined || s[f] === null || s[f] === '');
      if (missing.length > 0) {
        return Response.json({
          error: `Signal at index ${i} is missing required fields: ${missing.join(', ')}`,
          index: i
        }, { status: 400 });
      }
    }

    // Verify user exists
    const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
    if (users.length === 0) {
      return Response.json({ error: `No user found with email: ${user_email}` }, { status: 404 });
    }

    const results = [];
    let totalSuperseded = 0;
    let totalCreated = 0;

    for (const sig of signals) {
      const symbol = String(sig.asset_symbol).toUpperCase();
      try {
        // Deactivate existing active signals for this symbol
        const existing = await base44.asServiceRole.entities.AssetSignal.filter({
          asset_symbol: symbol,
          is_active: true
        });
        let superseded = 0;
        for (const old of existing) {
          await base44.asServiceRole.entities.AssetSignal.update(old.id, { is_active: false });
          superseded++;
        }
        totalSuperseded += superseded;

        // Build the new record — only include fields that are actually provided
        const record = { asset_symbol: symbol, is_active: true };
        const OPTIONAL_FIELDS = [
          'asset_type', 'timeframe', 'signal_type', 'confidence_score',
          'reasoning', 'technical_pattern', 'sentiment_score',
          'price_at_signal', 'target_price', 'stop_loss_price',
          'take_profit_pct', 'stop_loss_pct', 'momentum_strength',
          'timing_window', 'predicted_gain_pct', 'change_24h',
          'expires_at', 'is_active', 'metadata_json'
        ];
        for (const f of OPTIONAL_FIELDS) {
          if (sig[f] !== undefined && sig[f] !== null) {
            record[f] = sig[f];
          }
        }

        await base44.asServiceRole.entities.AssetSignal.create(record);
        totalCreated++;

        results.push({ symbol, superseded, created: true });
      } catch (e) {
        results.push({ symbol, error: e.message });
      }
    }

    return Response.json({
      success: true,
      total_superseded: totalSuperseded,
      total_created: totalCreated,
      details: results
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});