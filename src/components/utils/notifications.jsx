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

export const notify = {
  success: (title, options = {}) => {
    const dedupKey = options.dedupKey;
    if (dedupKey) markRecentSuccess(dedupKey);
    toast.success(title, options);
    saveNotification(title, options.description, 'success', options.data);
  },
  error: (title, options = {}) => {
    const dedupKey = options.dedupKey;
    if (hadRecentSuccess(dedupKey)) {
      // Downgrade to info to avoid false failures right after confirmed success
      const infoOpts = { ...options };
      toast.info(title, infoOpts);
      saveNotification(title, options.description, 'info', options.data);
      return;
    }
    toast.error(title, options);
    saveNotification(title, options.description, 'error', options.data);
  },
  info: (title, options = {}) => {
    toast.info(title, options);
    saveNotification(title, options.description, 'info', options.data);
  },
  warning: (title, options = {}) => {
    toast.warning(title, options);
    saveNotification(title, options.description, 'warning', options.data);
  }
};