import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

// Broker sync is disabled until a real, verified broker token exchange exists.
// It previously accepted client-supplied positions/cash (or invented sample data)
// and wrote them as LIVE holdings and real cash, and marked pending connections
// as "connected" without any verification. Live portfolio data must only come
// from a verified broker source, so this endpoint now writes nothing.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if ((body?.action || 'sync') !== 'sync') {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    return Response.json({
      success: false,
      error: 'Broker sync is not available: no verified broker integration is configured.'
    }, { status: 501 });
  } catch (error) {
    return Response.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
});