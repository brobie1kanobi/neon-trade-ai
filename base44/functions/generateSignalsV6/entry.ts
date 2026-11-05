import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { runCanonicalPipeline } from '../../shared/signalEngine.ts';

// Scheduled + on-demand entry point for the unified signal pipeline.
// All signal logic lives in shared/signalEngine.ts.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if ((user.role || '').toLowerCase() !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
    const start = Date.now();
    const { signals, summary } = await runCanonicalPipeline(base44, user, { symbols });
    return Response.json({
      success: true,
      ...summary,
      signals: signals.map(s => ({ symbol: s.asset_symbol, signal_type: s.signal_type, confidence: s.confidence_score, status: JSON.parse(s.metadata_json).data_status, reason: JSON.parse(s.metadata_json).non_actionable_reason })),
      duration_ms: Date.now() - start
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});