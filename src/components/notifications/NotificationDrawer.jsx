import React, { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Bell, X, Check, Trash2, Info, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Notification } from "@/entities/all";
import { format } from "date-fns";
import { useUser } from "@/components/hooks/useUser";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function NotificationDrawer({ isOpen, onOpenChange }) {
  const { user } = useUser();
  const [notifications, setNotifications] = useState([]);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const data = await Notification.filter({ created_by: user.email }, "-created_date", 50);
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.read).length);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      fetchNotifications();
      // Mark all as read when opening? Or maybe just fetch.
      // Let's keep them unread until dismissed or clicked.
    }
  }, [isOpen, user]);

  // Also fetch count on mount for the badge
  useEffect(() => {
    if (user) {
      // Just a quick check for count
      Notification.filter({ created_by: user.email, read: false }).then(data => {
        setUnreadCount(data.length);
      }).catch(err => console.error(err));
    }
  }, [user]);

  const handleDismiss = async (e, id) => {
    e.stopPropagation();
    try {
      await Notification.delete(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      // Update unread count if it was unread
      // Actually easier to just re-calc or decr
      // But we deleted it.
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  const handleClearAll = async () => {
    try {
      // Delete all visible notifications
      // In a real app we might just mark as read or have a bulk delete API.
      // Since we don't have bulk delete, we'll iterate (limit 50).
      await Promise.all(notifications.map(n => Notification.delete(n.id)));
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to clear notifications:", err);
    }
  };

  const handleNotificationClick = async (notification) => {
    setSelectedNotification(notification);
    if (!notification.read) {
      try {
        await Notification.update(notification.id, { read: true });
        setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
        console.error("Failed to mark read:", err);
      }
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error': return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-orange-500" />;
      default: return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[85vw] sm:w-[400px] p-0 flex flex-col bg-white dark:bg-slate-950 border-l border-gray-200 dark:border-gray-800">
          <SheetHeader className="p-4 border-b border-gray-100 dark:border-gray-800 flex flex-row items-center justify-between space-y-0">
            <SheetTitle className="text-lg font-semibold flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5 ml-2">
                  {unreadCount}
                </span>
              )}
            </SheetTitle>
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearAll} className="text-xs text-gray-500 hover:text-red-500">
                Clear all
              </Button>
            )}
          </SheetHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-12 flex flex-col items-center text-gray-400">
                <Bell className="w-12 h-12 mb-4 opacity-20" />
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`relative p-4 rounded-lg border transition-all cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-900 ${
                    notification.read 
                      ? 'bg-white dark:bg-slate-950 border-gray-200 dark:border-gray-800 opacity-75' 
                      : 'bg-blue-50/50 dark:bg-slate-900/50 border-blue-100 dark:border-blue-900/30'
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="mt-1 flex-shrink-0">
                      {getIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`text-sm font-medium mb-1 ${
                        notification.read ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-white'
                      }`}>
                        {notification.title}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-2">
                        {format(new Date(notification.created_date), 'MMM d, h:mm a')}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDismiss(e, notification.id)}
                      className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!selectedNotification} onOpenChange={(open) => !open && setSelectedNotification(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedNotification && getIcon(selectedNotification.type)}
              {selectedNotification?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {selectedNotification?.message}
            </p>
            
            {selectedNotification?.details_json && (
              <div className="bg-gray-50 dark:bg-slate-900 p-3 rounded-md border border-gray-100 dark:border-gray-800">
                <pre className="text-xs overflow-auto whitespace-pre-wrap text-gray-600 dark:text-gray-400 max-h-[200px]">
                  {(() => {
                    try {
                      const details = JSON.parse(selectedNotification.details_json);
                      return JSON.stringify(details, null, 2);
                    } catch (e) {
                      return selectedNotification.details_json;
                    }
                  })()}
                </pre>
              </div>
            )}
            
            <p className="text-xs text-gray-400 text-right">
              {selectedNotification && format(new Date(selectedNotification.created_date), 'MMM d, yyyy h:mm a')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedNotification(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}