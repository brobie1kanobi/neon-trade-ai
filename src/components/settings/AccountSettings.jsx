
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User as UserIcon, LogOut, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { User } from "@/entities/all";

export default function AccountSettings({ user }) {
  const handleLogout = async () => {
    try {
      await User.logout();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
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
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
          
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => alert('Account deactivation feature coming soon')}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Deactivate Account
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
  );
}
