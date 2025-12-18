import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * PushManager - Handles Web Push Notification setup and subscription
 * 
 * This component:
 * 1. Checks browser support for push notifications
 * 2. Registers a service worker
 * 3. Manages push subscription lifecycle
 * 4. Does NOT auto-request permission (requires user interaction)
 */
export default function PushManager() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState('default');

  /**
   * Convert Base64 URL-safe string to Uint8Array for VAPID key
   */
  const base64UrlToUint8Array = (base64String) => {
    // Add padding if needed
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  };

  /**
   * Safely encode subscription keys
   */
  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  /**
   * Get service worker registration URL
   */
  const getServiceWorkerUrl = () => {
    // Extract app ID from URL path - must be present in URL
    const pathMatch = window.location.pathname.match(/\/apps\/([a-f0-9-]+)/);
    if (!pathMatch) {
      console.warn('[PushManager] Could not extract app ID from URL');
      return null;
    }
    const appId = pathMatch[1];
    
    // Construct service worker URL
    return `${window.location.origin}/api/apps/${appId}/functions/pushServiceWorker`;
  };

  /**
   * Initialize push notification system
   */
  useEffect(() => {
    const initializePushSystem = async () => {
      try {
        // Check browser support
        if (!('serviceWorker' in navigator)) {
          console.log('[PushManager] Service Worker not supported');
          return;
        }

        if (!('PushManager' in window)) {
          console.log('[PushManager] Push API not supported');
          return;
        }

        // Check current permission status
        const permission = Notification.permission;
        setPermissionStatus(permission);
        console.log('[PushManager] Current permission:', permission);

        // Only proceed with setup if permission is granted
        if (permission !== 'granted') {
          console.log('[PushManager] Permission not granted, waiting for user action');
          return;
        }

        // Register service worker
        const swUrl = getServiceWorkerUrl();
        if (!swUrl) {
          console.log('[PushManager] Cannot register service worker - app ID not found in URL');
          return;
        }
        console.log('[PushManager] Registering service worker:', swUrl);
        
        const registration = await navigator.serviceWorker.register(swUrl, {
          scope: '/',
          updateViaCache: 'none'
        });

        console.log('[PushManager] Service Worker registered:', registration);

        // Wait for service worker to be ready
        await navigator.serviceWorker.ready;
        console.log('[PushManager] Service Worker ready');

        // Check existing subscription
        let subscription = await registration.pushManager.getSubscription();

        if (subscription) {
          console.log('[PushManager] Existing subscription found');
          setIsSubscribed(true);
          
          // Optionally refresh subscription on backend
          await refreshSubscription(subscription);
        } else {
          console.log('[PushManager] No existing subscription, will create on user action');
        }

      } catch (error) {
        console.error('[PushManager] Initialization error:', error);
      }
    };

    initializePushSystem();

    // Listen for permission changes
    const handlePermissionChange = () => {
      const newPermission = Notification.permission;
      setPermissionStatus(newPermission);
      console.log('[PushManager] Permission changed to:', newPermission);
    };

    // Set up listener if supported
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'notifications' })
        .then((permissionStatus) => {
          permissionStatus.addEventListener('change', handlePermissionChange);
        })
        .catch(() => {
          // Permissions API not fully supported, ignore
        });
    }

  }, []);

  /**
   * Refresh subscription with backend
   */
  const refreshSubscription = async (subscription) => {
    try {
      const p256dh = arrayBufferToBase64(subscription.getKey('p256dh'));
      const auth = arrayBufferToBase64(subscription.getKey('auth'));

      await base44.functions.invoke('pushNotifications', {
        action: 'subscribe',
        payload: {
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          device_label: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
        }
      });

      console.log('[PushManager] Subscription refreshed');
    } catch (error) {
      console.error('[PushManager] Error refreshing subscription:', error);
    }
  };

  /**
   * Request permission and subscribe (called from user interaction)
   */
  const requestPermissionAndSubscribe = async () => {
    try {
      // Request permission
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);

      if (permission !== 'granted') {
        console.log('[PushManager] Permission denied');
        return false;
      }

      // Get VAPID public key
      const { data: keyData } = await base44.functions.invoke('pushNotifications', {
        action: 'getPublicKey',
        payload: {}
      });

      if (!keyData?.publicKey) {
        throw new Error('No VAPID public key received');
      }

      // Convert VAPID key to Uint8Array
      const applicationServerKey = base64UrlToUint8Array(keyData.publicKey);

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });

      console.log('[PushManager] Push subscription created');

      // Send subscription to backend
      const p256dh = arrayBufferToBase64(subscription.getKey('p256dh'));
      const auth = arrayBufferToBase64(subscription.getKey('auth'));

      await base44.functions.invoke('pushNotifications', {
        action: 'subscribe',
        payload: {
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          device_label: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
        }
      });

      setIsSubscribed(true);
      console.log('[PushManager] Subscription saved to backend');
      
      return true;
    } catch (error) {
      console.error('[PushManager] Error requesting permission and subscribing:', error);
      return false;
    }
  };

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        
        // Notify backend
        await base44.functions.invoke('pushNotifications', {
          action: 'unsubscribe',
          payload: {
            endpoint: subscription.endpoint
          }
        });

        setIsSubscribed(false);
        console.log('[PushManager] Unsubscribed successfully');
      }
    } catch (error) {
      console.error('[PushManager] Error unsubscribing:', error);
    }
  };

  // Expose functions globally for other components to use
  useEffect(() => {
    window.__pushManager = {
      requestPermissionAndSubscribe,
      unsubscribe,
      isSubscribed,
      permissionStatus
    };
  }, [isSubscribed, permissionStatus]);

  return null;
}