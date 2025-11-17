import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Clock } from "lucide-react";

export default function TimeSettings({ value = "12h", onChange }) {
  const is24h = value === "24h";

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Clock className="w-5 h-5 neon-text" />
          Time Format
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="flex items-center justify-between p-4 rounded-lg"
          style={{ backgroundColor: 'var(--secondary-bg)' }}
        >
          <div>
            <Label htmlFor="time-format" className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
              24-hour time
            </Label>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Switch between 12-hour (AM/PM) and 24-hour time across the app.
            </p>
          </div>
          <Switch
            id="time-format"
            checked={is24h}
            onCheckedChange={(checked) => onChange?.(checked ? "24h" : "12h")}
            className="data-[state=checked]:bg-green-600"
          />
        </div>
      </CardContent>
    </Card>
  );
}