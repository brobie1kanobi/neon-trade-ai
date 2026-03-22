import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Delete User Account Data
 * 
 * Removes user's NeonTrade application data while preserving
 * audit records required for regulatory compliance (FTC/IRS/SEC).
 * 
 * PRESERVED (for audit/compliance):
 * - Live trade records (kraken_order_id present, is_simulation: false)
 * - Transaction records with is_real_money: true
 * - ProcessedSession and ProcessedRefund records
 * 
 * DELETED (user data):
 * - Simulation trades and holdings
 * - User settings and preferences
 * - Wallet balances (sim and real display only)
 * - Conditional orders
 * - Auto-buy preferences
 * - Push subscriptions
 * - Notifications
 * - Kraken connection credentials
 * - Authenticator records
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { userEmail, confirmationText } = body;

    // Verify the user is deleting their own account
    if (userEmail !== user.email) {
      return Response.json({ error: 'You can only delete your own account' }, { status: 403 });
    }

    // Require explicit confirmation
    if (confirmationText !== 'DELETE') {
      return Response.json({ error: 'Confirmation text does not match' }, { status: 400 });
    }

    console.log(`[deleteUserAccount] Starting deletion for user: ${user.email}`);

    const deletionResults = {
      deleted: {},
      preserved: {},
      errors: []
    };

    // Helper to safely delete entities
    const safeDelete = async (entityName, filter, preserveFilter = null) => {
      try {
        const items = await base44.entities[entityName].filter(filter);
        let toDelete = items;
        let preserved = [];

        if (preserveFilter) {
          toDelete = items.filter(item => !preserveFilter(item));
          preserved = items.filter(item => preserveFilter(item));
        }

        for (const item of toDelete) {
          try {
            await base44.entities[entityName].delete(item.id);
          } catch (delErr) {
            console.warn(`[deleteUserAccount] Failed to delete ${entityName} ${item.id}:`, delErr.message);
          }
        }

        deletionResults.deleted[entityName] = toDelete.length;
        if (preserved.length > 0) {
          deletionResults.preserved[entityName] = preserved.length;
        }
        
        console.log(`[deleteUserAccount] ${entityName}: deleted ${toDelete.length}, preserved ${preserved.length}`);
      } catch (err) {
        console.error(`[deleteUserAccount] Error processing ${entityName}:`, err.message);
        deletionResults.errors.push({ entity: entityName, error: err.message });
      }
    };

    // 1. Delete simulation trades, PRESERVE live trades with Kraken order IDs
    await safeDelete('Trade', { created_by: user.email }, (trade) => {
      // Preserve if it's a real Kraken trade (has order ID and not simulation)
      return trade.kraken_order_id && trade.is_simulation === false;
    });

    // 2. Delete simulation holdings, PRESERVE live holdings
    await safeDelete('Holding', { created_by: user.email }, (holding) => {
      return holding.is_simulation === false;
    });

    // 3. Delete wallet data (display only, not actual funds)
    await safeDelete('Wallet', { created_by: user.email });

    // 4. Delete simulation transactions, PRESERVE real money transactions
    await safeDelete('Transaction', { created_by: user.email }, (tx) => {
      return tx.is_real_money === true;
    });

    // 5. Delete conditional orders (all - these are app-side only)
    await safeDelete('ConditionalOrder', { created_by: user.email });

    // 6. Delete user settings
    await safeDelete('UserSettings', { created_by: user.email });

    // 7. Delete auto-buy preferences
    await safeDelete('AutoBuyPreference', { created_by: user.email });

    // 8. Delete push subscriptions
    await safeDelete('PushSubscription', { created_by: user.email });

    // 9. Delete notifications
    await safeDelete('Notification', { created_by: user.email });

    // 10. Delete Kraken connection (credentials)
    await safeDelete('KrakenConnection', { created_by: user.email });

    // 11. Delete authenticator records (biometric)
    await safeDelete('Authenticator', { created_by: user.email });

    // 12. Delete Kraken logs (user activity, not audit-critical)
    await safeDelete('KrakenLog', { created_by: user.email });

    // 13. Delete holdings snapshots
    await safeDelete('HoldingsSnapshot', { created_by: user.email });

    // NOTE: We do NOT delete ProcessedSession or ProcessedRefund records
    // These are audit records for payment processing and must be retained

    console.log(`[deleteUserAccount] Deletion complete for user: ${user.email}`);
    console.log(`[deleteUserAccount] Results:`, JSON.stringify(deletionResults));

    return Response.json({
      success: true,
      message: 'Account data deleted successfully',
      results: deletionResults
    });

  } catch (error) {
    console.error('[deleteUserAccount] Error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});