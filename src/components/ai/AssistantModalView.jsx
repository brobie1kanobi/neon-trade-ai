import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Mic, MicOff, Loader2, Square, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { agentSDK } from "@/agents";
import MessageBubble from "./MessageBubble";
import TradeConfirmation from "./TradeConfirmation";
import { User, UserSettings } from "@/entities/all";
import { useToast } from "@/components/ui/use-toast";
import TypingIndicator from "./TypingIndicator";
import { useSettings } from "@/components/utils/SettingsContext";
import { base44 } from "@/api/base44Client";
import useSpeechRecognition from "./hooks/useSpeechRecognition";
import { extractTradeProposalFromText, speakTextChunked } from "./assistantHelpers";

export default function AssistantModalView({ isOpen, onClose }) {
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [pendingTrade, setPendingTrade] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [isTTSPlaying, setIsTTSPlaying] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [thinkingText, setThinkingText] = useState("");

  const messagesEndRef = useRef(null);
  const { toast } = useToast();
  const lastSpokenIdRef = useRef(null);
  const sessionStartMsgCountRef = useRef(null);
  const tutorialSpokenRef = useRef(false);
  const { settings, updateSetting } = useSettings?.() || {};

  const extractProposal = (content) => extractTradeProposalFromText(content, () => {
    toast({ variant: "destructive", title: "AI Response Error", description: "Trade proposal malformed." });
  });

  const eff = React.useEffect;

  eff(() => {
    if (!isOpen) return;
    (async () => {
      try { const u = await User.me(); const s = await UserSettings.filter({ created_by: u.email }); } catch (_) {}
    })();
  }, [isOpen]);

  eff(() => {
    if (isOpen && settings && settings.has_seen_assistant_tutorial !== true) setShowTutorial(true);
  }, [isOpen, settings]);

  eff(() => {
    if (!showTutorial || !settings || settings.tts_enabled === false || tutorialSpokenRef.current) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance("Hey, I'm Neo, your all things trading assistant!");
    const voices = synth.getVoices?.() || [];
    if (settings.tts_voice_uri) { const v = voices.find(vv => vv.voiceURI === settings.tts_voice_uri); if (v) u.voice = v; }
    u.rate = ({ slow: 0.8, normal: 1.0, fast: 1.2 })[settings.tts_speech_rate || 'normal'] ?? 1.0;
    u.pitch = ({ slow: 0.9, normal: 1.0, fast: 1.2 })[settings.tts_speech_pitch || 'normal'] ?? 1.0;
    try { synth.cancel(); synth.speak(u); tutorialSpokenRef.current = true; } catch (_) {}
  }, [showTutorial, settings]);

  eff(() => {
    const onS = (e) => setThinkingText(typeof e.detail === 'string' ? e.detail : 'Thinking...');
    const onI = () => setThinkingText("");
    window.addEventListener('assistant:status', onS);
    window.addEventListener('assistant:idle', onI);
    return () => { window.removeEventListener('assistant:status', onS); window.removeEventListener('assistant:idle', onI); };
  }, []);

  const closeTutorial = async () => {
    setShowTutorial(false);
    if (dontShowAgain && updateSetting) await updateSetting('has_seen_assistant_tutorial', true);
  };

  const stopSpeaking = () => {
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
    setIsTTSPlaying(false);
  };

  const handleClose = () => { stopSpeaking(); try { stop(); } catch (_) {} setConnectionError(null); onClose(); };

  const handleSendMessage = async (messageText, attachments = []) => {
    const content = (typeof messageText === 'string' ? messageText : inputText).trim();
    if (!content && attachments.length === 0) return;
    if (!currentConversation) { toast({ variant: "destructive", title: "Error", description: "Not initialized." }); return; }
    setInputText(""); setConnectionError(null); setIsThinking(true);
    try {
      setMessages(prev => [...prev, { id: Date.now(), role: 'user', content, timestamp: new Date() }]);
      await agentSDK.addMessage(currentConversation, { role: 'user', content, file_urls: attachments });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: error.message || 'Connection failed.' });
      setMessages(prev => [...prev, { id: Date.now(), role: 'system', content: `❌ ${error.message || 'Try again.'}`, timestamp: new Date() }]);
      setIsThinking(false);
    }
  };

  const sendFromMic = async (text) => { const t = (text || "").trim(); if (t) await handleSendMessage(t); };
  const { isSupported, isListening, interim, finalText, start, stop } = useSpeechRecognition({ silenceMs: 2000, onAutoSend: sendFromMic });

  eff(() => { if (interim) setInputText(interim); }, [interim]);
  eff(() => { if (finalText && !interim) setInputText(""); }, [finalText, interim]);
  eff(() => {
    if (typeof window === 'undefined') return;
    window.__assistantMic = { start, stop };
    return () => { if (window.__assistantMic?.stop === stop) try { delete window.__assistantMic; } catch (_) {} try { stop(); } catch (_) {} };
  }, [start, stop]);

  // TTS: Only speak NEW messages from this session
  eff(() => {
    if (!settings || settings.tts_enabled === false || !isOpen) return;
    if (sessionStartMsgCountRef.current === null) return;
    const latest = messages[messages.length - 1];
    if (!latest || latest.role !== 'assistant' || !latest.content || latest.stream_delta) return;
    if (lastSpokenIdRef.current === latest.id) return;
    if (messages.length - 1 < sessionStartMsgCountRef.current) return;
    lastSpokenIdRef.current = latest.id;
    try { speakTextChunked(latest.content, settings, () => setIsTTSPlaying(true), () => setIsTTSPlaying(false)); }
    catch (e) { console.error("TTS failed:", e); setIsTTSPlaying(false); }
  }, [messages, isOpen, settings]);

  const handleTradeConfirmation = async (td) => {
    if (!currentConversation) return;
    try { await agentSDK.addMessage(currentConversation, { role: 'user', content: `USER_CONFIRMED_TRADE: ${JSON.stringify(td)}` }); setPendingTrade(null); toast({ title: "Trade Sent" }); }
    catch (e) { toast({ variant: "destructive", title: "Failed", description: e.message }); }
  };

  const handleTradeCancel = () => { setPendingTrade(null); toast({ title: "Trade Cancelled" }); };

  eff(() => {
    if (!isOpen || currentConversation) return;
    (async () => {
      setIsThinking(true); setConnectionError(null);
      try {
        const convos = await agentSDK.listConversations({ agent_name: "trader_agent" });
        let convo;
        if (convos.length > 0) {
          convo = convos[0];
          const full = await agentSDK.getConversation(convo.id);
          sessionStartMsgCountRef.current = (full?.messages || []).length;
        } else {
          convo = await agentSDK.createConversation({ agent_name: "trader_agent", metadata: { name: "Trading Assistant", description: "AI Trading Assistant Conversation" } });
          sessionStartMsgCountRef.current = 0;
        }
        setMessages([]); setCurrentConversation(convo);
      } catch (error) { const m = error.message || 'Failed'; setConnectionError(m); toast({ variant: "destructive", title: "Connection Error", description: m }); }
      finally { setIsThinking(false); }
    })();
  }, [isOpen, currentConversation, toast]);

  eff(() => {
    if (!currentConversation?.id) return;
    const unsub = agentSDK.subscribeToConversation(currentConversation.id, (data) => {
      const msgs = data.messages || [];
      setMessages(prev => JSON.stringify(prev) === JSON.stringify(msgs) ? prev : msgs);
      const last = msgs[msgs.length - 1];
      const prop = last?.role === 'assistant' && last?.content ? extractProposal(last.content) : null;
      if (prop) setPendingTrade(prop);
      else if (last?.role !== 'user' || !last?.content?.includes('USER_CONFIRMED_TRADE')) setPendingTrade(null);
      setIsThinking(last?.role === 'user' || (last?.role === 'assistant' && !last.content && (last.tool_calls?.length > 0 || last.stream_delta)));
      if (msgs.length > 0) setConnectionError(null);
    });
    return () => unsub();
  }, [currentConversation?.id]);

  eff(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pendingTrade]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col p-0" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
          <DialogHeader className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}><DialogTitle className="neon-text">NeonTrade AI Assistant</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !isThinking && !connectionError && <div className="text-sm opacity-80" style={{ color: 'var(--text-secondary)' }}>Ask Neo anything — from basic trading questions to executing orders.</div>}
            {connectionError && <div className="text-center p-4"><div className="text-red-500 font-medium mb-2">❌ Connection Failed</div><div className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>{connectionError}</div><Button onClick={() => { setCurrentConversation(null); setMessages([]); }} variant="outline">Retry</Button></div>}
            <AnimatePresence>
              {messages.map((msg, i) => {
                if (msg.role === 'assistant' && msg.content && extractProposal(msg.content) && pendingTrade) return null;
                return <motion.div key={msg.id || i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}><MessageBubble message={msg} /></motion.div>;
              })}
            </AnimatePresence>
            {isThinking && !connectionError && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center"><div className="flex items-center gap-2"><Loader2 className="w-6 h-6 animate-spin text-green-500" /><span className="text-sm" style={{ color: 'var(--text-secondary)' }}>AI is thinking...</span></div></motion.div>}
            <div ref={messagesEndRef} />
            {thinkingText && <div className="mt-2"><TypingIndicator text={thinkingText} /></div>}
          </div>
          {pendingTrade && <div className="px-4 pb-4"><TradeConfirmation proposal={pendingTrade} onConfirm={() => handleTradeConfirmation(pendingTrade.trade_details)} onCancel={handleTradeCancel} /></div>}
          <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Input value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage(inputText)} placeholder="Ask Neo anything about trading..." className="flex-1 text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-800" />
              <Button size="icon" onClick={() => handleSendMessage(inputText)}><Send className="w-5 h-5" /></Button>
            </div>
            <div className="flex items-center gap-2">
              {isSupported && <Button type="button" onClick={isListening ? stop : start} variant={isListening ? "destructive" : "outline"} size="sm" className="bg-lime-500 px-3 text-sm font-medium rounded-md whitespace-nowrap border border-input hover:bg-accent hover:text-accent-foreground h-9 flex items-center gap-2">{isListening ? <><MicOff className="w-4 h-4" />Stop Listening</> : <><Mic className="w-4 h-4" />Start Mic</>}</Button>}
              {isTTSPlaying && <Button type="button" onClick={stopSpeaking} variant="outline" size="sm" className="inline-flex items-center gap-1.5 border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300 animate-pulse"><VolumeX className="w-3.5 h-3.5" />Cancel Playback</Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {showTutorial && <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}><div className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl p-5" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}><button className="absolute top-4 right-4 rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={e => { e.stopPropagation(); closeTutorial(); }}><Square className="w-5 h-5" /></button><div className="space-y-4 pr-2"><h2 className="text-xl font-bold neon-text">Meet Neo</h2><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>I'm your personalized trading copilot. From "what is a ticker?" to executing hundreds of orders an hour — I've got you.</p><ul className="list-disc pl-5 space-y-1 text-sm"><li>Explain complex ideas simply, or go full quant.</li><li>Place trades, set stop-loss/take-profit, manage orders.</li><li>Build a personalized roadmap for your goals.</li><li>Respect privacy. Your data stays yours.</li></ul><div className="rounded-lg p-3 border" style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}><p className="text-sm">"Help, I'm trapped in a tutorial! Click the green button to set me free." — Neo</p></div><div className="flex items-center justify-between gap-4 pt-2"><label className="flex items-center gap-2 select-none cursor-pointer" onClick={e => e.stopPropagation()}><input type="checkbox" checked={dontShowAgain} onChange={e => setDontShowAgain(e.target.checked)} /><span className="text-sm">Don't show again</span></label><button className="px-4 py-2 rounded-md text-white bg-green-600 hover:bg-green-700" onClick={e => { e.stopPropagation(); closeTutorial(); }}>Get started</button></div></div></div></div>}
    </>
  );
}