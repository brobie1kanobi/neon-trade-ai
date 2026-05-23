import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const list = await base44.entities.Wallet.filter(
      { created_by: user.email },
      "-updated_date"
    );
    const wallet = list?.[0] || null;

    return Response.json({
      success: true,
      wallet
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
});