
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, TestTube, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function NotificationSettings({ settings, onToggle }) {
  const [isEnabling, setIsEnabling] = useState(false);
  const [isTestingSync, setIsTestingSync] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState('checking');

  const masterEnabled = settings?.notifications_enabled ?? true;

  // Check subscription status on mount
  React.useEffect(() => {
    const checkStatus = () => {
      const status = Notification.permission;
      const pushManager = window.__pushManager;
      
      if (status === 'granted' && pushManager?.isSubscribed) {
        setSubscriptionStatus('subscribed');
      } else if (status === 'granted') {
        setSubscriptionStatus('granted');
      } else if (status === 'denied') {
        setSubscriptionStatus('denied');
      } else {
        setSubscriptionStatus('default');
      }
    };

    checkStatus();
    
    // Re-check periodically
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleEnableNotifications = async () => {
    setIsEnabling(true);
    
    try {
      const pushManager = window.__pushManager;
      
      if (!pushManager) {
        toast.error('Push notification system not ready. Please refresh the page.');
        return;
      }

      const success = await pushManager.requestPermissionAndSubscribe();
      
      if (success) {
        toast.success('🔔 Push notifications enabled!', {
          description: 'You\'ll now receive trade alerts and market updates.'
        });
        setSubscriptionStatus('subscribed');
      } else {
        toast.error('Failed to enable notifications', {
          description: 'Please check your browser permissions.'
        });
      }
    } catch (error) {
      console.error('Enable notifications error:', error);
      toast.error('Error enabling notifications', {
        description: error.message
      });
    } finally {
      setIsEnabling(false);
    }
  };

  const handleDisableNotifications = async () => {
    try {
      const pushManager = window.__pushManager;
      
      if (!pushManager) {
        toast.error('Push notification system not ready.');
        return;
      }

      await pushManager.unsubscribe();
      toast.success('Notifications disabled');
      setSubscriptionStatus('default');
    } catch (error) {
      console.error('Disable notifications error:', error);
      toast.error('Error disabling notifications');
    }
  };

  const handleTestNotification = async () => {
    setIsTestingSync(true);
    
    try {
      const result = await base44.functions.invoke('pushNotifications', {
        action: 'testNotification',
        payload: {}
      });

      if (result.data?.success) {
        toast.success('Test notification sent!', {
          description: 'Check your device for the notification.'
        });
      } else {
        toast.error('Failed to send test notification', {
          description: result.data?.message || 'Unknown error'
        });
      }
    } catch (error) {
      console.error('Test notification error:', error);
      toast.error('Error sending test notification', {
        description: error.message
      });
    } finally {
      setIsTestingSync(false);
    }
  };

  const getStatusBadge = () => {
    switch (subscriptionStatus) {
      case 'subscribed':
        return <Badge className="bg-green-100 text-green-800 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          Active
        </Badge>;
      case 'granted':
        return <Badge variant="outline" className="text-yellow-600">Permission Granted</Badge>;
      case 'denied':
        return <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="w-3 h-3" />
          Blocked
        </Badge>;
      case 'checking':
        return <Badge variant="outline" className="flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Checking...
        </Badge>;
      default:
        return <Badge variant="outline">Not Enabled</Badge>;
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Bell className="w-5 h-5 neon-text" />
          Push Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Push Notification Status */}
        <div className="p-4 rounded-lg border" style={{backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)'}}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-base mb-1" style={{ color: 'var(--text-primary)' }}>
                Browser Notifications
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Get real-time alerts on your device
              </p>
            </div>
            {getStatusBadge()}
          </div>

          <div className="flex flex-wrap gap-2">
            {subscriptionStatus === 'subscribed' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisableNotifications}
                  className="flex items-center gap-2"
                >
                  Disable
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestNotification}
                  disabled={isTestingSync}
                  className="flex items-center gap-2"
                >
                  {isTestingSync ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4" />
                  )}
                  Send Test
                </Button>
              </>
            ) : subscriptionStatus === 'denied' ? (
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Notifications are blocked. Please enable them in your browser settings.
              </div>
            ) : (
              <Button
                onClick={handleEnableNotifications}
                disabled={isEnabling}
                className="bg-green-600 hover:bg-green-700 flex items-center gap-2"
              >
                {isEnabling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4" />
                    Enable Notifications
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Master Toggle */}
        <div className="flex items-center justify-between p-4 rounded-lg" style={{backgroundColor: 'var(--secondary-bg)'}}>
          <div>
            <Label htmlFor="master-notifications" className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
              In-App Notifications
            </Label>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Control notification triggers
            </p>
          </div>
          <Switch
            id="master-notifications"
            checked={masterEnabled}
            onCheckedChange={(value) => onToggle('notifications_enabled', value)}
            className="data-[state=checked]:bg-green-600"
          />
        </div>

        {/* Help Text */}
        <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            💡 <strong>Tip:</strong> Push notifications work even when the app is closed. Make sure to enable them for important trade alerts.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
