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

export const notify = {
  success: (title, options = {}) => {
    toast.success(title, options);
    // Don't save transient success messages unless specified? 
    // User said "notifications that pop up at the top, to be able to be managed"
    // I'll save them.
    saveNotification(title, options.description, 'success', options.data);
  },
  error: (title, options = {}) => {
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