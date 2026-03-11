import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

// Helper to save notification to DB
const saveNotification = async (title, message, type, details) => {
  try {
    const user = await base44.auth.me();
    if (!user) return;
    
    const notification = await base44.entities.Notification.create({
      title,
      message: message || '',
      type,
      read: false,
      details_json: details ? JSON.stringify(details) : null,
      created_by: user.email
    });
    
    // Dispatch event to update badge
    window.dispatchEvent(new CustomEvent('notification:created', { detail: notification }));
  } catch (err) {
    console.error("Failed to save notification:", err);
  }
};

// Lightweight dedup/downgrade: if an error comes right after a success for the same key, downgrade to info
const recentSuccessMap = new Map();
const markRecentSuccess = (key) => { if (!key) return; recentSuccessMap.set(key, Date.now()); };
const hadRecentSuccess = (key, ms = 10000) => {
  if (!key) return false;
  const t = recentSuccessMap.get(key);
  return !!t && (Date.now() - t < ms);
};

// Messages that should NOT be saved to the notification list (just show toast)
const TOAST_ONLY_MESSAGES = [
  'Orders refresh failed',
  'orders refresh failed',
  'Failed to refresh orders'
];

const shouldSaveToDb = (title) => {
  return !TOAST_ONLY_MESSAGES.some(msg => title?.toLowerCase().includes(msg.toLowerCase()));
};

// Suppress noisy errors for auto-skipped SELL orders (insufficient available / below Kraken minimum)
const SUPPRESSED_PATTERNS = [
  'kraken minimum sell',
  'insufficient available',
  'insufficient funds',
  'failed to sell',
  'failed sell',
  'kraken sell failed',
  'below kraken minimum',
  'order blocked',
  'trade execution timeout',
  'execution timeout',
  'rate limit exceeded'
];

const isSuppressed = (title, description) => {
  const t = String(title || '').toLowerCase();
  const d = String(description || '').toLowerCase();
  return SUPPRESSED_PATTERNS.some(p => t.includes(p) || d.includes(p));
};

export const notify = {
  success: (title, options = {}) => {
    const dedupKey = options.dedupKey;
    if (dedupKey) markRecentSuccess(dedupKey);
    toast.success(title, options);
    if (shouldSaveToDb(title)) {
      saveNotification(title, options.description, 'success', options.data);
    }
  },
  error: (title, options = {}) => {
    const dedupKey = options.dedupKey;
    // Suppress specific auto-skipped sell notifications
    if (isSuppressed(title, options.description)) {
      return; // no toast, no DB record
    }
    if (hadRecentSuccess(dedupKey)) {
      // Downgrade to info to avoid false failures right after confirmed success
      const infoOpts = { ...options };
      toast.info(title, infoOpts);
      if (shouldSaveToDb(title)) {
        saveNotification(title, options.description, 'info', options.data);
      }
      return;
    }
    toast.error(title, options);
    if (shouldSaveToDb(title)) {
      saveNotification(title, options.description, 'error', options.data);
    }
  },
  info: (title, options = {}) => {
    toast.info(title, options);
    if (shouldSaveToDb(title)) {
      saveNotification(title, options.description, 'info', options.data);
    }
  },
  warning: (title, options = {}) => {
    // Suppress specific auto-skipped sell notifications
    if (isSuppressed(title, options.description)) {
      return; // no toast, no DB record
    }
    toast.warning(title, options);
    if (shouldSaveToDb(title)) {
      saveNotification(title, options.description, 'warning', options.data);
    }
  }
};