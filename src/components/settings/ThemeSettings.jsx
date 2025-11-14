import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Moon, Sun } from "lucide-react";

export default function ThemeSettings({ darkMode, onToggle }) {
  // Invert the logic - we show light mode toggle, dark is default
  const isLightMode = !darkMode;

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          {isLightMode ? <Sun className="w-5 h-5 neon-text" /> : <Moon className="w-5 h-5 neon-text" />}
          Appearance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Light Mode</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Switch to light theme (dark mode is default)
            </p>
          </div>
          <Switch
            checked={isLightMode}
            onCheckedChange={(checked) => onToggle(!checked)} // Invert because we're toggling light mode but storing dark mode
            className="data-[state=checked]:bg-green-600"
          />
        </div>
        
        <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            The app will automatically reload to apply theme changes. Dark mode is the default experience.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}