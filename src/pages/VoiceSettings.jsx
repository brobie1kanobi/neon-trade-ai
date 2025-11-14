
import { useState, useEffect } from 'react';
import { UserSettings } from "@/entities/UserSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Volume2, PlayCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function VoiceSettings() {
    const [voices, setVoices] = useState([]);
    const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
    const [settings, setSettings] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [speechRate, setSpeechRate] = useState('normal');
    const [speechPitch, setSpeechPitch] = useState('normal');

    useEffect(() => {
        const loadVoices = () => {
            const voiceList = window.speechSynthesis.getVoices();
            if (voiceList.length > 0) {
                setVoices(voiceList);
            }
        };

        loadVoices();
        // Voices may load asynchronously
        window.speechSynthesis.onvoiceschanged = loadVoices;

        const loadSettings = async () => {
            setIsLoading(true);
            const userSettings = await UserSettings.list();
            if (userSettings.length > 0) {
                setSettings(userSettings[0]);
                setSelectedVoiceURI(userSettings[0].tts_voice_uri || '');
                setSpeechRate(userSettings[0].tts_speech_rate || 'normal');
                setSpeechPitch(userSettings[0].tts_speech_pitch || 'normal');
            }
            setIsLoading(false);
        };

        loadSettings();
        
        return () => {
            window.speechSynthesis.onvoiceschanged = null;
        };
    }, []);

    const getSpeechSettings = (setting) => {
        const settingsMap = {
            slow: { rate: 0.7, pitch: 0.8 },
            normal: { rate: 1.0, pitch: 1.0 },
            fast: { rate: 1.3, pitch: 1.2 }
        };
        return settingsMap[setting] || settingsMap.normal;
    };

    const handleTestVoice = () => {
        if (!selectedVoiceURI) {
            toast.info("Please select a voice to test.");
            return;
        }
        const voice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (voice) {
            const utterance = new SpeechSynthesisUtterance("Hello, this is a test of my voice from NeonTrade AI.");
            utterance.voice = voice;
            
            // Apply speed and pitch settings
            const rateSettings = getSpeechSettings(speechRate);
            const pitchSettings = getSpeechSettings(speechPitch);
            utterance.rate = rateSettings.rate;
            utterance.pitch = pitchSettings.pitch;
            
            window.speechSynthesis.speak(utterance);
        }
    };

    const handleSaveChanges = async () => {
        setIsSaving(true);
        try {
            const settingsData = {
                tts_voice_uri: selectedVoiceURI,
                tts_speech_rate: speechRate,
                tts_speech_pitch: speechPitch
            };
            
            if (settings?.id) {
                await UserSettings.update(settings.id, settingsData);
            } else {
                // If no settings exist, create a new entry.
                // It's important to include the current selectedVoiceURI, speechRate, and speechPitch
                // in the creation, even if they are default, so a record is established.
                await UserSettings.create(settingsData);
            }
            toast.success("Voice settings saved!");
        } catch (error) {
            console.error("Failed to save voice settings:", error);
            toast.error("Could not save settings. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--primary-bg)' }}>
                <Loader2 className="w-8 h-8 animate-spin neon-text" />
            </div>
        );
    }
    
    return (
        <div className="p-4 space-y-6" style={{ backgroundColor: 'var(--primary-bg)' }}>
            <div className="text-center py-4">
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    AI Voice & Speech
                </h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                    Choose the voice for your AI assistant.
                </p>
            </div>
        
            <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Volume2 className="w-5 h-5 neon-text" />
                        Voice Selection
                    </CardTitle>
                    <CardDescription style={{ color: 'var(--text-secondary)' }}>
                        Select from the voices available on your device.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="voice-select">Choose a voice</Label>
                        <Select value={selectedVoiceURI} onValueChange={setSelectedVoiceURI}>
                            <SelectTrigger id="voice-select">
                                <SelectValue placeholder="Select a voice..." />
                            </SelectTrigger>
                            <SelectContent>
                                {voices.map((voice) => (
                                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                                        {voice.name} ({voice.lang})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Speed Control */}
                    <div>
                        <Label>Speech Speed</Label>
                        <div className="flex gap-2 mt-2">
                            {['slow', 'normal', 'fast'].map((speed) => (
                                <button
                                    key={speed}
                                    onClick={() => setSpeechRate(speed)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                        speechRate === speed 
                                            ? 'bg-green-600 text-white neon-glow' 
                                            : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                                    }`}
                                    style={{ 
                                        color: speechRate === speed ? 'white' : 'var(--text-primary)',
                                        backgroundColor: speechRate === speed ? '#16a34a' : 'var(--secondary-bg)'
                                    }}
                                >
                                    {speed.charAt(0).toUpperCase() + speed.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Pitch Control */}
                    <div>
                        <Label>Speech Pitch</Label>
                        <div className="flex gap-2 mt-2">
                            {['slow', 'normal', 'fast'].map((pitch) => (
                                <button
                                    key={pitch}
                                    onClick={() => setSpeechPitch(pitch)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                        speechPitch === pitch 
                                            ? 'bg-green-600 text-white neon-glow' 
                                            : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                                    }`}
                                    style={{ 
                                        color: speechPitch === pitch ? 'white' : 'var(--text-primary)',
                                        backgroundColor: speechPitch === pitch ? '#16a34a' : 'var(--secondary-bg)'
                                    }}
                                >
                                    {pitch === 'slow' ? 'Low' : pitch === 'normal' ? 'Normal' : 'High'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                         <Button onClick={handleTestVoice} variant="outline" className="w-full">
                            <PlayCircle className="w-4 h-4 mr-2" />
                            Test Voice
                        </Button>
                        <Button onClick={handleSaveChanges} disabled={isSaving} className="w-full neon-glow bg-green-600 hover:bg-green-700">
                            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Save Changes
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
