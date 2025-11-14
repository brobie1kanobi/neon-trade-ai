// Service Worker for Push Notifications
// This must be served with Content-Type: application/javascript

Deno.serve((req) => {
  const serviceWorkerCode = `
// Push Notification Service Worker for NeonTrade AI
const CACHE_NAME = 'neontrade-v1';

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  self.skipWaiting(); // Activate immediately
});

// Activate event - claim all clients
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    self.clients.claim().then(() => {
      console.log('[Service Worker] Claimed all clients');
    })
  );
});

// Push event - show notification
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push received');
  
  if (!event.data) {
    console.warn('[Service Worker] Push event has no data');
    return;
  }

  try {
    const payload = event.data.json();
    console.log('[Service Worker] Push payload:', payload);
    
    const {
      title = 'NeonTrade AI',
      body = 'You have a new notification',
      icon = '/icon-192.png',
      badge = '/badge-72.png',
      data = {},
      tag = 'neontrade-notification',
      requireInteraction = false,
      actions = []
    } = payload;

    const notificationOptions = {
      body,
      icon,
      badge,
      data,
      tag,
      requireInteraction,
      vibrate: [200, 100, 200],
      timestamp: Date.now(),
      actions
    };

    event.waitUntil(
      self.registration.showNotification(title, notificationOptions)
        .then(() => {
          console.log('[Service Worker] Notification shown successfully');
        })
        .catch((error) => {
          console.error('[Service Worker] Error showing notification:', error);
        })
    );
  } catch (error) {
    console.error('[Service Worker] Error parsing push data:', error);
  }
});

// Notification click event - focus or open app
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked');
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window if none exists
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
      .catch((error) => {
        console.error('[Service Worker] Error handling notification click:', error);
      })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('[Service Worker] Notification closed:', event.notification.tag);
});

console.log('[Service Worker] Loaded and ready');
`;

  return new Response(serviceWorkerCode, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Service-Worker-Allowed': '/'
    }
  });
});