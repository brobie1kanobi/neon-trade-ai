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
      // Mark all as read when opening? Or maybe just fetch.
      // Let's keep them unread until dismissed or clicked.
    }
  }, [isOpen, user]);

  // Also fetch count on mount for the badge
  useEffect(() => {
    if (user) {
      // Just a quick check for count
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
      // Update unread count if it was unread
      // Actually easier to just re-calc or decr
      // But we deleted it.
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  const handleClearAll = async () => {
    try {
      // Fetch ALL notifications for this user (not just the visible 50)
      let allNotifications = [];
      let batch = await Notification.filter({ created_by: user.email }, "-created_date", 100);
      allNotifications = batch;
      
      // Keep fetching if there might be more
      while (batch.length === 100) {
        const lastId = batch[batch.length - 1].id;
        batch = await Notification.filter({ created_by: user.email, id: { $lt: lastId } }, "-created_date", 100);
        allNotifications = [...allNotifications, ...batch];
      }
      
      // Delete all notifications
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
      case 'success':return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'warning':return <AlertTriangle className="w-5 h-5 text-orange-500" />;
      default:return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="bg-slate-950 text-slate-100 p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed z-50 gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 inset-y-0 right-0 h-full sm:max-w-sm w-[85vw] sm:w-[400px] flex flex-col dark:bg-slate-950 border-l border-gray-200 dark:border-gray-800">
          <SheetHeader className="bg-lime-500 p-4 text-center sm:text-left border-b border-gray-100 dark:border-gray-800 flex flex-row items-center justify-between space-y-0">
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
            <Button variant="ghost" size="sm" onClick={handleClearAll} className="text-gray-500 mx-auto px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent h-8 hover:text-red-500">
                Clear all
              </Button>
            }
          </SheetHeader>
          
          <div className="bg-zinc-950 p-4 flex-1 overflow-y-auto space-y-3">
            {isLoading ?
            <div className="text-center py-8 text-gray-500">Loading...</div> :
            notifications.length === 0 ?
            <div className="text-center py-12 flex flex-col items-center text-gray-400">
                <Bell className="w-12 h-12 mb-4 opacity-20" />
                <p>No notifications yet</p>
              </div> :

            notifications.map((notification) =>
            <div
              key={notification.id}
              onClick={() => handleNotificationClick(notification)}
              className={`relative p-4 rounded-lg border transition-all cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-900 ${
              notification.read ?
              'bg-white dark:bg-slate-950 border-gray-200 dark:border-gray-800 opacity-75' :
              'bg-blue-50/50 dark:bg-slate-900/50 border-blue-100 dark:border-blue-900/30'}`
              }>

                  <div className="flex gap-3">
                    <div className="mt-1 flex-shrink-0">
                      {getIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`text-sm font-medium mb-1 ${
                  notification.read ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-white'}`
                  }>
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
                  className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">

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
        <DialogContent className="bg-slate-900 p-6 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedNotification && getIcon(selectedNotification.type)}
              {selectedNotification?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-gray-200 text-sm dark:text-gray-300">
              {selectedNotification?.message}
            </p>
            
            {selectedNotification?.details_json &&
            <div className="bg-gray-50 dark:bg-slate-900 p-3 rounded-md border border-gray-100 dark:border-gray-800 space-y-2">
                {(() => {
                try {
                  const details = JSON.parse(selectedNotification.details_json);
                  // Format details in a user-friendly way
                  return (
                    <div className="space-y-1.5">
                        {details.symbol &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Asset:</span>
                            <span className="font-medium text-gray-300">{details.symbol}</span>
                          </div>
                      }
                        {details.orderType &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Order Type:</span>
                            <span className={`font-medium ${details.orderType === 'take-profit' ? 'text-green-400' : 'text-red-400'}`}>
                              {details.orderType === 'take-profit' ? 'Take Profit' : 'Stop Loss'}
                            </span>
                          </div>
                      }
                        {details.quantity &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Quantity:</span>
                            <span className="font-medium text-gray-300">{details.quantity}</span>
                          </div>
                      }
                        {details.purchasePrice &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Purchase Price:</span>
                            <span className="font-medium text-gray-300">${details.purchasePrice}</span>
                          </div>
                      }
                        {details.fillPrice &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Fill Price:</span>
                            <span className="font-medium text-gray-300">${details.fillPrice}</span>
                          </div>
                      }
                        {details.pnl &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Profit/Loss:</span>
                            <span className={`font-medium ${parseFloat(details.pnl) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {parseFloat(details.pnl) >= 0 ? '+' : ''}${details.pnl}
                            </span>
                          </div>
                      }
                        {details.pnlPct &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Change:</span>
                            <span className={`font-medium ${parseFloat(details.pnlPct) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {parseFloat(details.pnlPct) >= 0 ? '+' : ''}{details.pnlPct}%
                            </span>
                          </div>
                      }
                        {details.total_value &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Total Value:</span>
                            <span className="font-medium text-gray-300">${parseFloat(details.total_value).toFixed(2)}</span>
                          </div>
                      }
                        {details.cost && !details.total_value &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Cost:</span>
                            <span className="font-medium text-gray-300">${parseFloat(details.cost).toFixed(2)}</span>
                          </div>
                      }
                        {details.proceeds &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Proceeds:</span>
                            <span className="font-medium text-green-400">${parseFloat(details.proceeds).toFixed(2)}</span>
                          </div>
                      }
                        {details.fee &&
                      <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Fee:</span>
                            <span className="font-medium text-orange-400">-${parseFloat(details.fee).toFixed(2)}</span>
                          </div>
                      }
                        {details.trade && !details.symbol &&
                      <div className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Asset:</span>
                              <span className="font-medium text-gray-300">{details.trade.symbol}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Action:</span>
                              <span className={`font-medium ${details.trade.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                                {details.trade.type?.toUpperCase()}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Quantity:</span>
                              <span className="font-medium text-gray-300">{details.trade.quantity?.toFixed(4)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Price:</span>
                              <span className="font-medium text-gray-300">${details.trade.price?.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">Total:</span>
                              <span className="font-medium text-gray-300">${details.trade.total_value?.toFixed(2)}</span>
                            </div>
                          </div>
                      }
                        {details.error &&
                      <div className="pt-2 border-t border-gray-700">
                            <p className="text-xs text-red-400">{details.error}</p>
                          </div>
                      }
                      </div>);

                } catch (e) {
                  return (
                    <pre className="text-xs overflow-auto whitespace-pre-wrap text-gray-600 dark:text-gray-400 max-h-[200px]">
                        {selectedNotification.details_json}
                      </pre>);

                }
              })()}
              </div>
            }
            
            <p className="text-xs text-gray-400 text-right">
              {selectedNotification && format(new Date(selectedNotification.created_date), 'MMM d, yyyy h:mm a')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedNotification(null)} className="bg-red-600 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-9">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>);

}