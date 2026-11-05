import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { runCanonicalPipeline } from '../../shared/signalEngine.ts';

// Proxy kept for compatibility — runs the unified pipeline (symbol resolution
// from AutoBuyPreference / watchlist / defaults happens inside the pipeline).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if ((user.role || '').toLowerCase() !== 'admin') return Response.json({ error: 'Admin access required' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const { signals, summary } = await runCanonicalPipeline(base44, user, { symbols: Array.isArray(body?.symbols) ? body.symbols : [] });
    return Response.json({ success: true, proxy: 'generateSignalsProxy', ...summary, signals });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});