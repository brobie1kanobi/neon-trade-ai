import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User as UserIcon, LogOut, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { User } from "@/entities/all";
import { base44 } from "@/api/base44Client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/utils/notifications";

export default function AccountSettings({ user }) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleLogout = async () => {
    try {
      await User.logout();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE") return;
    
    setIsDeleting(true);
    try {
      // Call backend function to handle account deletion
      const response = await base44.functions.invoke('deleteUserAccount', {
        userEmail: user.email,
        confirmationText: confirmText
      });
      
      const data = response?.data || response;
      
      if (data?.success) {
        notify.success("Account Deleted", {
          description: "Your NeonTrade data has been removed. Logging out..."
        });
        
        // Small delay before logout to show the success message
        setTimeout(async () => {
          try {
            await User.logout();
          } catch (_e) {
            window.location.href = '/';
          }
        }, 2000);
      } else {
        throw new Error(data?.error || 'Failed to delete account');
      }
    } catch (error) {
      console.error("Delete account error:", error);
      notify.error("Deletion Failed", {
        description: error.message || "Could not delete account. Please try again."
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setConfirmText("");
    }
  };

  return (
    <>
      <AlertDialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Delete Account
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will permanently delete your NeonTrade account data from this device, including:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1 text-gray-600 dark:text-gray-400">
                <li>All simulation trades and holdings</li>
                <li>Wallet balances and transactions</li>
                <li>User preferences and settings</li>
                <li>Auto-buy preferences and conditional orders</li>
                <li>Push notification subscriptions</li>
              </ul>
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-800 dark:text-amber-400">
                  <strong>Note:</strong> For regulatory compliance, audit records of any live Kraken trades will be retained. Your Kraken account itself is not affected.
                </p>
              </div>
              <div className="pt-2">
                <p className="text-sm font-medium mb-2">Type "DELETE" to confirm:</p>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                  placeholder="DELETE"
                  className="font-mono"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={confirmText !== "DELETE" || isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Account
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <UserIcon className="w-5 h-5 neon-text" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {user?.full_name || 'User'}
            </p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {user?.email}
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
              Member since {user?.created_date ? format(new Date(user.created_date), "MMMM yyyy") : 'recently'}
            </p>
          </div>

          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full select-none"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
            
            <Button
              variant="destructive"
              className="w-full select-none"
              onClick={() => setShowDeleteModal(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Account
            </Button>
          </div>

          <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-400 mb-2">
              🚀 Future Ready
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              This app is designed to integrate with real trading APIs when you're ready to go live.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}