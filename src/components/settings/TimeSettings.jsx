import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock } from "lucide-react";

// Common timezones with friendly names
const TIMEZONES = [
  { value: "Pacific/Honolulu", label: "Hawaii (HST)", offset: "-10:00" },
  { value: "America/Anchorage", label: "Alaska (AKST)", offset: "-09:00" },
  { value: "America/Los_Angeles", label: "Pacific Time (PST)", offset: "-08:00" },
  { value: "America/Denver", label: "Mountain Time (MST)", offset: "-07:00" },
  { value: "America/Chicago", label: "Central Time (CST)", offset: "-06:00" },
  { value: "America/New_York", label: "Eastern Time (EST)", offset: "-05:00" },
  { value: "America/Halifax", label: "Atlantic Time (AST)", offset: "-04:00" },
  { value: "America/Sao_Paulo", label: "São Paulo (BRT)", offset: "-03:00" },
  { value: "Atlantic/South_Georgia", label: "South Georgia (GST)", offset: "-02:00" },
  { value: "Atlantic/Azores", label: "Azores (AZOT)", offset: "-01:00" },
  { value: "UTC", label: "UTC", offset: "+00:00" },
  { value: "Europe/London", label: "London (GMT)", offset: "+00:00" },
  { value: "Europe/Paris", label: "Central Europe (CET)", offset: "+01:00" },
  { value: "Europe/Helsinki", label: "Eastern Europe (EET)", offset: "+02:00" },
  { value: "Europe/Moscow", label: "Moscow (MSK)", offset: "+03:00" },
  { value: "Asia/Dubai", label: "Dubai (GST)", offset: "+04:00" },
  { value: "Asia/Karachi", label: "Pakistan (PKT)", offset: "+05:00" },
  { value: "Asia/Kolkata", label: "India (IST)", offset: "+05:30" },
  { value: "Asia/Dhaka", label: "Bangladesh (BST)", offset: "+06:00" },
  { value: "Asia/Bangkok", label: "Thailand (ICT)", offset: "+07:00" },
  { value: "Asia/Singapore", label: "Singapore (SGT)", offset: "+08:00" },
  { value: "Asia/Shanghai", label: "China (CST)", offset: "+08:00" },
  { value: "Asia/Tokyo", label: "Japan (JST)", offset: "+09:00" },
  { value: "Australia/Sydney", label: "Sydney (AEDT)", offset: "+11:00" },
  { value: "Pacific/Auckland", label: "New Zealand (NZDT)", offset: "+13:00" }
];

export default function TimeSettings({ value = "12h", onChange, timezone, onTimezoneChange }) {
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
        {/* Time Zone Selector */}
        <div className="space-y-2">
          <Label htmlFor="timezone-select" style={{ color: 'var(--text-primary)' }}>
            Time Zone
          </Label>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Trade timestamps will be displayed in your selected time zone
          </p>
          <Select 
            value={timezone || "America/New_York"} 
            onValueChange={onTimezoneChange}
          >
            <SelectTrigger id="timezone-select">
              <SelectValue placeholder="Select time zone" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-mono w-14">{tz.offset}</span>
                    <span>{tz.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 24-hour Toggle */}
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