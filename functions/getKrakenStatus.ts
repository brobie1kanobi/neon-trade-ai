import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Get Kraken Connection Status - For AI Assistant
 * Returns whether user has connected Kraken and when last synced
 * SECURITY FIX: Returns 401 for unauthorized users
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // SECURITY FIX: Auth check - RETURN 401 IF UNAUTHORIZED
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ 
        error: 'Unauthorized',
        success: false 
      }, { status: 401 }); // SECURITY FIX: Changed from 200 to 401
    }

    // Check connection
    const connections = await base44.asServiceRole.entities.KrakenConnection.filter({
      created_by: user.email
    });

    if (!connections || connections.length === 0) {
      return Response.json({ 
        connected: false,
        message: 'Kraken not connected. User needs to connect their Kraken account in Settings.',
        success: true
      }, { status: 200 });
    }

    const conn = connections[0];
    
    // Get last sync from logs
    const logs = await base44.asServiceRole.entities.KrakenLog.filter({
      created_by: user.email,
      event_type: 'balance'
    }, '-created_date', 1);

    const lastSync = logs[0];
    const lastSyncTime = lastSync ? new Date(lastSync.created_date) : null;
    const timeSinceSync = lastSyncTime ? Math.floor((Date.now() - lastSyncTime.getTime()) / 1000) : null;

    return Response.json({
      success: true,
      connected: true,
      account_verified: conn.account_verified,
      last_verified: conn.last_verified,
      last_sync: lastSyncTime ? lastSyncTime.toISOString() : null,
      seconds_since_sync: timeSinceSync,
      message: lastSyncTime 
        ? `Kraken connected. Last synced ${timeSinceSync}s ago.`
        : 'Kraken connected but never synced. User should sync their balance.'
    });

  } catch (error) {
    console.error('[getKrakenStatus] Error:', error);
    
    // SECURITY FIX: Return 401 for auth errors, 500 for others
    if (error.message?.includes('Unauthorized') || error.message?.includes('Auth')) {
      return Response.json({ 
        error: 'Unauthorized',
        success: false
      }, { status: 401 });
    }
    
    return Response.json({ 
      error: error.message || 'Internal error',
      success: false
    }, { status: 500 });
  }
});