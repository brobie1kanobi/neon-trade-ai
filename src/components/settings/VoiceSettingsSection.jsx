import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Volume2, ChevronRight } from "lucide-react";
import { createPageUrl } from "@/utils";

export default function VoiceSettingsSection({ settings, onToggle }) {
  const ttsEnabled = settings?.tts_enabled ?? true;

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Volume2 className="w-5 h-5 neon-text" />
          AI Voice & Speech
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg" style={{backgroundColor: 'var(--secondary-bg)'}}>
          <div>
            <Label htmlFor="tts-enabled" className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
              Enable AI Speech
            </Label>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              AI responses will be read out loud.
            </p>
          </div>
          <Switch
            id="tts-enabled"
            checked={ttsEnabled}
            onCheckedChange={(value) => onToggle('tts_enabled', value)}
            className="data-[state=checked]:bg-green-600"
          />
        </div>

        <Link
          to={createPageUrl("VoiceSettings")}
          className={`flex items-center justify-between p-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${!ttsEnabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <Label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-primary)' }}>
            Customize AI Voice
          </Label>
          <ChevronRight className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </Link>
      </CardContent>
    </Card>
  );
}