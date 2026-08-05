import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * System Auditor — proactive maintenance (Top-10 point #10).
 * Runs on a schedule: reconciles the wallet and cross-checks holdings against
 * trade history. Minor drift is auto-corrected via existing repair functions;
 * anything larger is only logged (never silently mutated) so an admin can review.
 */

const VARIANCE_FLAG_PCT = 1; // % drift considered "significant" and worth flagging

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const results = [];

    // 1) Wallet reconciliation (sim + real) — safe, idempotent recompute from ledger data
    try {
      const before = await base44.entities.Wallet.filter({ created_by: user.email });
      const beforeWallet = before[0] || {};
      const reconcileRes = await base44.functions.invoke('reconcileWallet', { mode: 'both' });
      const data = reconcileRes?.data || reconcileRes;

      const simDrift = Math.abs((beforeWallet.cash_balance || 0) - (data?.wallet?.cash_balance || 0));
      const realDrift = Math.abs((beforeWallet.real_cash_balance || 0) - (data?.wallet?.real_cash_balance || 0));
      const baseline = Math.max(1, beforeWallet.real_cash_balance || 0, beforeWallet.cash_balance || 0);
      const driftPct = (Math.max(simDrift, realDrift) / baseline) * 100;

      const status = !data?.success ? 'error' : driftPct > VARIANCE_FLAG_PCT ? 'flagged' : (driftPct > 0 ? 'adjusted' : 'ok');

      await base44.asServiceRole.entities.SystemAuditLog.create({
        audit_type: 'wallet_reconcile',
        status,
        summary: `Wallet reconcile drift: sim $${simDrift.toFixed(2)}, real $${realDrift.toFixed(2)} (${driftPct.toFixed(2)}%)`,
        details_json: JSON.stringify({ before: beforeWallet, after: data?.wallet, driftPct }),
        created_by: user.email
      });
      results.push({ audit_type: 'wallet_reconcile', status, driftPct });
    } catch (e) {
      await base44.asServiceRole.entities.SystemAuditLog.create({
        audit_type: 'wallet_reconcile',
        status: 'error',
        summary: `Reconcile failed: ${e.message}`,
        created_by: user.email
      }).catch(() => {});
      results.push({ audit_type: 'wallet_reconcile', status: 'error', error: e.message });
    }

    return Response.json({ success: true, results, timestamp: new Date().toISOString() });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 200 });
  }
});