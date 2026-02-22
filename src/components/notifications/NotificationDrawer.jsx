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
  DialogFooter } from
"@/components/ui/dialog";

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
      setUnreadCount(data.filter((n) => !n.read).length);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      fetchNotifications();
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (user) {
      Notification.filter({ created_by: user.email, read: false }).then((data) => {
        setUnreadCount(data.length);
      }).catch((err) => console.error(err));
    }
  }, [user]);

  const handleDismiss = async (e, id) => {
    e.stopPropagation();
    try {
      await Notification.delete(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  const handleClearAll = async () => {
    try {
      let allNotifications = [];
      let batch = await Notification.filter({ created_by: user.email }, "-created_date", 100);
      allNotifications = batch;

      while (batch.length === 100) {
        const lastId = batch[batch.length - 1].id;
        batch = await Notification.filter({ created_by: user.email, id: { $lt: lastId } }, "-created_date", 100);
        allNotifications = [...allNotifications, ...batch];
      }

      await Promise.all(allNotifications.map((n) => Notification.delete(n.id)));
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
        setNotifications((prev) => prev.map((n) => n.id === notification.id ? { ...n, read: true } : n));
        setUnreadCount((prev) => Math.max(0, prev - 1));
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
        <SheetContent side="right" className="bg-slate-950 text-slate-100 p-0 fixed z-50 inset-y-0 right-0 h-full sm:max-w-sm w-[85vw] sm:w-[400px] flex flex-col border-l border-gray-800">
          <SheetHeader className="bg-lime-500 p-4 flex flex-row items-center justify-between">
            <SheetTitle className="text-slate-100 text-lg font-semibold flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
              {unreadCount > 0 &&
                <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5 ml-2">
                  {unreadCount}
                </span>
              }
            </SheetTitle>

            {notifications.length > 0 &&
              <Button variant="ghost" size="sm" onClick={handleClearAll} className="text-xs hover:text-red-500">
                Clear all
              </Button>
            }
          </SheetHeader>

          <div className="bg-zinc-950 p-4 flex-1 overflow-y-auto space-y-3">
            {isLoading ?
              <div className="text-center py-8 text-gray-500">Loading...</div> :
              notifications.length === 0 ?
                <div className="text-center py-12 text-gray-400">
                  <Bell className="w-12 h-12 mb-4 opacity-20 mx-auto" />
                  <p>No notifications yet</p>
                </div> :

                notifications.map((notification) =>
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`relative p-4 rounded-lg border transition-all cursor-pointer ${notification.read
                      ? 'bg-slate-950 border-gray-800 opacity-75'
                      : 'bg-slate-900 border-blue-900/30'}`}>

                    <div className="flex gap-3">
                      <div className="mt-1">
                        {getIcon(notification.type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium mb-1">
                          {notification.title}
                        </h4>

                        <p className="text-xs text-gray-400 line-clamp-2">
                          {notification.message}
                        </p>

                        <p className="text-[10px] text-gray-500 mt-2">
                          {format(new Date(notification.created_date), 'MMM d, h:mm a')}
                        </p>
                      </div>

                      <button
                        onClick={(e) => handleDismiss(e, notification.id)}
                        className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
            }
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!selectedNotification} onOpenChange={(open) => !open && setSelectedNotification(null)}>
        <DialogContent className="bg-slate-900 p-6 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedNotification && getIcon(selectedNotification.type)}
              {selectedNotification?.title}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <p className="text-gray-200 text-sm">
              {selectedNotification?.message}
            </p>

            {selectedNotification?.details_json &&
              <div className="bg-gray-900 p-3 rounded-md border border-gray-800 space-y-2">
                {(() => {
                  try {
                    const details =
                      typeof selectedNotification.details_json === "string"
                        ? JSON.parse(selectedNotification.details_json)
                        : selectedNotification.details_json;

                    const hasStructuredData = false;

                    if (!details || typeof details !== "object") {
                      return null;
                    }

                    return (
                      <div className="space-y-1.5 border-t border-gray-700 pt-2 mt-2">
                        {Object.entries(details)
                          .filter(([_, value]) => value !== null && value !== undefined)
                          .map(([key, value]) => {
                            const formattedKey = key
                              .replace(/([A-Z])/g, " $1")
                              .replace(/^./, str => str.toUpperCase());

                            const formattedValue =
                              typeof value === "number"
                                ? value.toLocaleString()
                                : typeof value === "boolean"
                                  ? value ? "Yes" : "No"
                                  : String(value);

                            return (
                              <div key={key} className="flex justify-between text-sm">
                                <span className="text-gray-500">
                                  {formattedKey}:
                                </span>
                                <span className="font-medium text-gray-300 text-right break-words max-w-[60%]">
                                  {formattedValue}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    );
                  } catch (e) {
                    return (
                      <div className="text-xs text-gray-400 break-words">
                        {selectedNotification.details_json}
                      </div>
                    );
                  }
                })()}
              </div>
            }

            <p className="text-xs text-gray-400 text-right">
              {selectedNotification &&
                format(new Date(selectedNotification.created_date), 'MMM d, yyyy h:mm a')}
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedNotification(null)}
              className="bg-red-600 text-white hover:bg-red-700">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}