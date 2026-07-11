import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import * as webpush from 'npm:web-push@3.6.7';

/**
 * Push Notifications Handler
 * 
 * SECURITY FIX: sendNotification restricted to user's own email or admin users
 * 
 * Actions:
 * - getPublicKey: Returns VAPID public key for subscription
 * - subscribe: Saves push subscription to database
 * - unsubscribe: Removes push subscription
 * - sendNotification: Sends push notification (ONLY to own email or if admin)
 * - testNotification: Sends test notification (authenticated users only)
 */

Deno.serve(async (req) => {
  try {
    // Parse request body with timeout
    const body = await Promise.race([
      req.json(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 3000)
      )
    ]);
    
    const { action, payload = {} } = body;

    // ============================================
    // PUBLIC ACTION: Get VAPID Public Key
    // ============================================
    if (action === 'getPublicKey') {
      const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      
      if (!publicKey) {
        console.error('[Push] VAPID_PUBLIC_KEY not configured');
        return Response.json({ 
          error: 'VAPID keys not configured' 
        }, { status: 500 });
      }
      
      return Response.json({ publicKey }, { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ============================================
    // AUTHENTICATED ACTIONS
    // ============================================
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Configure web-push with VAPID credentials
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    
    if (!publicKey || !privateKey) {
      console.error('[Push] VAPID keys not configured');
      return Response.json({ 
        error: 'VAPID keys not configured' 
      }, { status: 500 });
    }

    webpush.setVapidDetails(
      'mailto:support@neontrade.ai',
      publicKey,
      privateKey
    );

    // ============================================
    // SUBSCRIBE ACTION
    // ============================================
    if (action === 'subscribe') {
      const { endpoint, p256dh, auth, device_label } = payload;

      if (!endpoint || !p256dh || !auth) {
        return Response.json({ 
          error: 'Missing required subscription data (endpoint, p256dh, auth)' 
        }, { status: 400 });
      }

      // Check if subscription already exists
      const existing = await base44.entities.PushSubscription.filter({
        created_by: user.email,
        endpoint
      });

      if (existing.length > 0) {
        // Update existing subscription
        await base44.entities.PushSubscription.update(existing[0].id, {
          last_seen: new Date().toISOString(),
          p256dh,
          auth
        });
        
        console.log('[Push] Updated existing subscription for:', user.email);
      } else {
        // Create new subscription
        await base44.entities.PushSubscription.create({
          endpoint,
          p256dh,
          auth,
          user_agent: req.headers.get('user-agent') || '',
          device_label: device_label || 'Unknown Device',
          last_seen: new Date().toISOString(),
          created_by: user.email
        });
        
        console.log('[Push] Created new subscription for:', user.email);
      }

      return Response.json({ 
        success: true,
        message: 'Subscription saved successfully'
      });
    }

    // ============================================
    // UNSUBSCRIBE ACTION
    // ============================================
    if (action === 'unsubscribe') {
      const { endpoint } = payload;

      if (!endpoint) {
        return Response.json({ 
          error: 'Missing endpoint' 
        }, { status: 400 });
      }

      const subscriptions = await base44.entities.PushSubscription.filter({
        created_by: user.email,
        endpoint
      });

      if (subscriptions.length > 0) {
        await base44.entities.PushSubscription.delete(subscriptions[0].id);
        console.log('[Push] Deleted subscription for:', user.email);
      }

      return Response.json({ 
        success: true,
        message: 'Unsubscribed successfully'
      });
    }

    // ============================================
    // SEND NOTIFICATION ACTION - SECURITY FIX
    // ============================================
    if (action === 'sendNotification') {
      const { title, body, data, targetUser } = payload;

      if (!title || !body) {
        return Response.json({ 
          error: 'Missing required fields (title, body)' 
        }, { status: 400 });
      }

      // SECURITY FIX: Only allow sending to own email OR if admin
      const isAdmin = (user?.role || '').toLowerCase() === 'admin';
      const target = targetUser || user.email;
      
      // CRITICAL: Block non-admin users from sending to other users
      if (target !== user.email && !isAdmin) {
        console.warn('[Push] BLOCKED: Non-admin user attempted to send to different user');
        return Response.json({ 
          error: 'Permission denied - can only send notifications to yourself',
          success: false 
        }, { status: 403 });
      }

      console.log('[Push] Sending notification:', { from: user.email, to: target, isAdmin });

      // Get all active subscriptions for target user
      const subscriptions = await base44.asServiceRole.entities.PushSubscription.filter({
        created_by: target
      });

      if (subscriptions.length === 0) {
        return Response.json({ 
          success: false,
          message: 'No active subscriptions found',
          sent: 0 
        });
      }

      const notificationPayload = JSON.stringify({
        title,
        body,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data: data || {},
        tag: 'neontrade-notification',
        timestamp: Date.now()
      });

      let sent = 0;
      let failed = 0;
      const errors = [];

      // Send to all subscriptions
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            const pushSubscription = {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
              }
            };

            await webpush.sendNotification(pushSubscription, notificationPayload);
            sent++;
            
            // Update last_seen timestamp
            await base44.asServiceRole.entities.PushSubscription.update(sub.id, {
              last_seen: new Date().toISOString()
            });
            
          } catch (error) {
            failed++;
            errors.push({
              endpoint: sub.endpoint.substring(0, 50) + '...',
              error: error.message
            });
            
            console.error('[Push] Send error:', error);
            
            // Delete invalid subscriptions (410 Gone)
            if (error.statusCode === 410 || error.statusCode === 404) {
              try {
                await base44.asServiceRole.entities.PushSubscription.delete(sub.id);
                console.log('[Push] Deleted invalid subscription');
              } catch (deleteError) {
                console.error('[Push] Error deleting subscription:', deleteError);
              }
            }
          }
        })
      );

      return Response.json({ 
        success: sent > 0,
        sent,
        failed,
        total: subscriptions.length,
        errors: errors.length > 0 ? errors : undefined
      });
    }

    // ============================================
    // TEST NOTIFICATION ACTION
    // ============================================
    if (action === 'testNotification') {
      const subscriptions = await base44.entities.PushSubscription.filter({
        created_by: user.email
      });

      if (subscriptions.length === 0) {
        return Response.json({ 
          success: false,
          message: 'No active subscriptions. Please enable notifications first.'
        }, { status: 400 });
      }

      // Send test notification to current user
      const testPayload = JSON.stringify({
        title: '🎉 Test Notification',
        body: 'If you see this, push notifications are working perfectly!',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data: { type: 'test', timestamp: Date.now() },
        tag: 'test-notification',
        requireInteraction: false
      });

      let sent = 0;
      const errors = [];

      for (const sub of subscriptions) {
        try {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          };

          await webpush.sendNotification(pushSubscription, testPayload);
          sent++;
        } catch (error) {
          errors.push(error.message);
          console.error('[Push] Test notification error:', error);
        }
      }

      return Response.json({ 
        success: sent > 0,
        message: sent > 0 
          ? `Test notification sent to ${sent} device(s)` 
          : 'Failed to send test notification',
        sent,
        errors: errors.length > 0 ? errors : undefined
      });
    }

    // ============================================
    // UNKNOWN ACTION
    // ============================================
    return Response.json({ 
      error: 'Unknown action' 
    }, { status: 400 });

  } catch (error) {
    console.error('[Push] Handler error:', error);
    return Response.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
});