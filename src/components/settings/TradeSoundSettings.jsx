import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Volume2, VolumeX, Play, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { playTradeSound, previewBuiltInSound, SOUND_TRIGGERS } from "@/components/utils/TradeSoundEngine";

export default function TradeSoundSettings({ settings, onToggle }) {
  const [uploadingFor, setUploadingFor] = useState(null);
  const soundEnabled = settings?.sound_enabled !== false;
  const volume = settings?.sound_volume ?? 0.5;

  const handleVolumeChange = (val) => {
    onToggle('sound_volume', val[0]);
  };

  const handlePreview = (triggerKey) => {
    const customUrl = settings?.[SOUND_TRIGGERS.find(t => t.key === triggerKey)?.settingKey];
    if (customUrl) {
      playTradeSound(triggerKey, { ...settings, sound_enabled: true });
    } else {
      previewBuiltInSound(triggerKey, volume);
    }
  };

  const handleUpload = async (triggerKey, settingKey) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mp3,audio/wav,audio/ogg,audio/webm,audio/*';

    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        toast.error("File too large", { description: "Max 2MB for sound files" });
        return;
      }

      setUploadingFor(triggerKey);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        await onToggle(settingKey, file_url);
        toast.success("Custom sound uploaded!", { description: `Set for "${SOUND_TRIGGERS.find(t => t.key === triggerKey)?.label}"` });
      } catch (err) {
        toast.error("Upload failed", { description: err.message });
      } finally {
        setUploadingFor(null);
      }
    };

    input.click();
  };

  const handleRemoveCustom = async (settingKey) => {
    await onToggle(settingKey, "");
    toast.success("Custom sound removed — using default cyberpunk sound");
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Volume2 className="w-5 h-5 neon-text" />
          Trade Sounds
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Master toggle */}
        <div className="flex items-center justify-between p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
          <div>
            <Label className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
              Sound Effects
            </Label>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Play sounds on trade events
            </p>
          </div>
          <Switch
            checked={soundEnabled}
            onCheckedChange={(v) => onToggle('sound_enabled', v)}
            className="data-[state=checked]:bg-green-600"
          />
        </div>

        {soundEnabled && (
          <>
            {/* Volume slider */}
            <div className="px-4 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Volume</Label>
                <span className="text-sm font-mono" style={{ color: 'var(--neon-green)' }}>
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <VolumeX className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
                <Slider
                  value={[volume]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={handleVolumeChange}
                  className="flex-1"
                />
                <Volume2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
              </div>
            </div>

            {/* Individual trigger sounds */}
            <div className="space-y-2">
              <Label className="text-sm font-medium px-1" style={{ color: 'var(--text-secondary)' }}>
                Sound Triggers
              </Label>
              {SOUND_TRIGGERS.map((trigger) => {
                const customUrl = settings?.[trigger.settingKey];
                const hasCustom = !!customUrl;
                return (
                  <div
                    key={trigger.key}
                    className="flex items-center justify-between p-3 rounded-lg border"
                    style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-base">{trigger.icon}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {trigger.label}
                        </p>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                          style={{ color: hasCustom ? 'var(--neon-green)' : 'var(--text-secondary)', borderColor: hasCustom ? 'var(--neon-green)' : 'var(--border-color)' }}
                        >
                          {hasCustom ? 'Custom' : 'Cyberpunk'}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handlePreview(trigger.key)}
                        title="Preview sound"
                      >
                        <Play className="w-3.5 h-3.5" style={{ color: 'var(--neon-green)' }} />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleUpload(trigger.key, trigger.settingKey)}
                        disabled={uploadingFor === trigger.key}
                        title="Upload custom sound"
                      >
                        {uploadingFor === trigger.key ? (
                          <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--text-secondary)', borderTopColor: 'var(--neon-green)' }} />
                        ) : (
                          <Upload className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                        )}
                      </Button>

                      {hasCustom && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRemoveCustom(trigger.settingKey)}
                          title="Remove custom sound"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Help */}
            <div className="pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                🔊 Default sounds are generated in-browser using Web Audio (no downloads). Upload MP3, WAV, or OGG files (max 2MB) to customize any trigger.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}