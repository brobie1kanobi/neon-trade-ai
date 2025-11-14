import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Mic, MicOff, Loader2, Square } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { agentSDK } from "@/agents";
import MessageBubble from "./MessageBubble";
import TradeConfirmation from "./TradeConfirmation";
import { User, UserSettings } from "@/entities/all";
import { useToast } from "@/components/ui/use-toast";
import TypingIndicator from "./TypingIndicator";
import { useSettings } from "@/components/utils/SettingsContext";
import useSpeechRecognition from "./hooks/useSpeechRecognition";

export default function AssistantModal({ isOpen, onClose }) {
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [pendingTrade, setPendingTrade] = useState(null);
  const [userSettings, setUserSettings] = useState(null);
  const [connectionError, setConnectionError] = useState(null);

  const messagesEndRef = useRef(null);
  const { toast } = useToast();

  const lastSpokenIdRef = React.useRef(null);

  const { settings, updateSetting } = useSettings?.() || {};
  const [showTutorial, setShowTutorial] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const [thinkingText, setThinkingText] = useState("");

  const tutorialSpokenRef = useRef(false);

  useEffect(() => {
    const loadUserSettings = async () => {
      try {
        const currentUser = await User.me();
        const settings = await UserSettings.filter({ created_by: currentUser.email });
        setUserSettings(settings[0] || { sim_trading_mode: true });
      } catch (error) {
        console.error("Failed to load user settings:", error);
        setUserSettings({ sim_trading_mode: true });
      }
    };

    if (isOpen) {
      loadUserSettings();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (settings && settings.has_seen_assistant_tutorial !== true) {
      setShowTutorial(true);
    }
  }, [isOpen, settings]);

  useEffect(() => {
    if (!showTutorial) return;
    if (!settings || settings.tts_enabled === false) return;
    if (tutorialSpokenRef.current) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utter = new SpeechSynthesisUtterance(
      "Hey, I'm Neo, your all things trading assistant! Here's some of the things I can do!"
    );
    const voices = synth.getVoices?.() || [];
    if (settings.tts_voice_uri) {
      const v = voices.find((vv) => vv.voiceURI === settings.tts_voice_uri);
      if (v) utter.voice = v;
    }
    const rateMap = { slow: 0.8, normal: 1.0, fast: 1.2 };
    const pitchMap = { slow: 0.9, normal: 1.0, fast: 1.2 };
    utter.rate = rateMap[settings.tts_speech_rate || 'normal'] ?? 1.0;
    utter.pitch = pitchMap[settings.tts_speech_pitch || 'normal'] ?? 1.0;
    try {
      synth.cancel();
      synth.speak(utter);
      tutorialSpokenRef.current = true;
    } catch (e) {
      console.error("Error speaking tutorial intro:", e);
    }
  }, [showTutorial, settings]);

  useEffect(() => {
    const onStatus = (e) => setThinkingText(typeof e.detail === 'string' ? e.detail : 'Thinking...');
    const onIdle = () => setThinkingText("");
    window.addEventListener('assistant:status', onStatus);
    window.addEventListener('assistant:idle', onIdle);
    return () => {
      window.removeEventListener('assistant:status', onStatus);
      window.removeEventListener('assistant:idle', onIdle);
    };
  }, []);

  const closeTutorial = async () => {
    setShowTutorial(false);
    if (dontShowAgain && updateSetting) {
      await updateSetting('has_seen_assistant_tutorial', true);
    }
  };

  const handleClose = () => {
    try {window.speechSynthesis?.cancel();} catch (e) {console.error("Error cancelling TTS on close:", e);}
    stop();
    setConnectionError(null);
    onClose();
  };

  const handleSendMessage = useCallback(async (messageText, attachments = []) => {
    const content = (typeof messageText === 'string' ? messageText : inputText).trim();
    if (!content && attachments.length === 0) return;

    if (!currentConversation) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Conversation not initialized. Please try again."
      });
      return;
    }

    setInputText("");
    setConnectionError(null);
    setIsThinking(true);

    const userMessage = {
      role: 'user',
      content: content,
      file_urls: attachments
    };

    try {
      setMessages((prev) => [...prev, {
        id: Date.now(),
        role: 'user',
        content: content,
        timestamp: new Date()
      }]);

      await agentSDK.addMessage(currentConversation, userMessage);
    } catch (error) {
      console.error('Failed to send message:', error);
      toast({
        variant: "destructive",
        title: "Error sending message",
        description: error.message || 'Please check your connection and try again.'
      });
      setMessages((prev) => [...prev, {
        id: Date.now(),
        role: 'system',
        content: `❌ **Connection Error**: Unable to send message. ${error.message || 'Please check your connection and try again.'}`,
        timestamp: new Date()
      }]);
      setIsThinking(false);
    }
  }, [currentConversation, inputText, toast]);

  const handleSendRef = useRef(handleSendMessage);
  useEffect(() => {
    handleSendRef.current = handleSendMessage;
  }, [handleSendMessage]);

  // Speech Recognition with proper auto-send
  const sendFromMic = async (text) => {
    const t = (text || "").trim();
    if (!t) return;
    try {
      await handleSendMessage(t);
    } catch (e) {
      console.error("Error calling handleSendMessage from mic:", e);
    }
  };

  const {
    isSupported,
    isListening,
    interim,
    finalText,
    start,
    stop
  } = useSpeechRecognition({
    silenceMs: 2000,
    onAutoSend: sendFromMic
  });

  // Update input field with interim speech results
  useEffect(() => {
    if (interim) {
      setInputText(interim);
    }
  }, [interim]);

  // Clear input when finalText is sent
  useEffect(() => {
    if (finalText && !interim) {
      setInputText("");
    }
  }, [finalText, interim]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__assistantMic = { start, stop };
    return () => {
      if (window.__assistantMic && window.__assistantMic.stop === stop) {
        try {delete window.__assistantMic;} catch (e) {console.error("Error deleting __assistantMic:", e);}
      }
      try {stop();} catch (_) {}
    };
  }, [start, stop]);

  const isSpeaking = useMemo(() => {
    return typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.speaking;
  }, [isOpen]);

  const stopSpeaking = () => {
    try {window.speechSynthesis && window.speechSynthesis.cancel();} catch (_) {}
  };

  useEffect(() => {
    if (!settings || settings.tts_enabled === false) return;
    if (!isOpen) return;
    const latest = messages[messages.length - 1];
    if (!latest || latest.role !== 'assistant') return;
    if (!latest.content || latest.stream_delta) return;
    if (lastSpokenIdRef.current === latest.id) return;
    lastSpokenIdRef.current = latest.id;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const utter = new SpeechSynthesisUtterance(latest.content);
      const rateMap = { slow: 0.8, normal: 1.0, fast: 1.2 };
      const pitchMap = { slow: 0.9, normal: 1.0, fast: 1.2 };
      utter.rate = rateMap[settings.tts_speech_rate || 'normal'] ?? 1.0;
      utter.pitch = pitchMap[settings.tts_speech_pitch || 'normal'] ?? 1.0;
      if (settings.tts_voice_uri) {
        const voices = synth.getVoices?.() || [];
        const v = voices.find((vv) => vv.voiceURI === settings.tts_voice_uri);
        if (v) utter.voice = v;
      }
      synth.cancel();
      synth.speak(utter);
    } catch (e) {
      console.error("TTS speak failed:", e);
    }
  }, [messages, isOpen, settings]);

  const handleTradeConfirmation = async (tradeDetails) => {
    if (!currentConversation) return;

    try {
      await agentSDK.addMessage(currentConversation, {
        role: 'user',
        content: `USER_CONFIRMED_TRADE: ${JSON.stringify(tradeDetails)}`
      });
      setPendingTrade(null);
      toast({
        title: "Trade Confirmation Sent",
        description: "Your trade request has been sent for processing."
      });
    } catch (error) {
      console.error('Failed to confirm trade:', error);
      toast({
        variant: "destructive",
        title: "Failed to confirm trade",
        description: error.message || 'Please try again.'
      });
    }
  };

  const handleTradeCancel = useCallback(() => {
    setPendingTrade(null);
    toast({
      title: "Trade Cancelled",
      description: "The trade proposal has been canceled."
    });
  }, [toast]);

  const extractTradeProposal = useCallback((content) => {
    if (!content || typeof content !== 'string') return null;

    const labelIdx = content.indexOf('TRADE_PROPOSAL');
    let start = -1;
    if (labelIdx !== -1) {
      start = content.indexOf('{', labelIdx);
    }
    if (start === -1) {
      const hint = content.indexOf('"propose_trade"');
      if (hint !== -1) {
        start = content.lastIndexOf('{', hint);
      } else {
        start = content.indexOf('{');
      }
    }
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaping = false;
    let end = -1;

    for (let i = start; i < content.length; i++) {
      const ch = content[i];

      if (inString) {
        if (escaping) {
          escaping = false;
        } else if (ch === '\\') {
          escaping = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth += 1;
        continue;
      }

      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) {
      return null;
    }

    let jsonString = content.slice(start, end + 1);
    jsonString = jsonString.replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(jsonString);
      if (parsed?.action === 'propose_trade' && parsed?.trade_details) {
        return parsed;
      }
    } catch (e) {
      console.error('Failed to parse TRADE_PROPOSAL:', e, 'Original string:', jsonString);
      toast({
        variant: "destructive",
        title: "AI Response Error",
        description: "The AI proposed a trade, but its response was malformed. Please try again."
      });
    }
    return null;
  }, [toast]);

  useEffect(() => {
    const initConversation = async () => {
      if (isOpen && !currentConversation) {
        setIsThinking(true);
        setConnectionError(null);

        try {
          const conversations = await agentSDK.listConversations({ agent_name: "trader_agent" });
          let conversation;
          if (conversations.length > 0) {
            conversation = conversations[0];
            const fullConversation = await agentSDK.getConversation(conversation.id);

            // FIX: Don't set messages immediately - let subscription handle it
            // This prevents showing stale messages
            setMessages([]);
          } else {
            conversation = await agentSDK.createConversation({
              agent_name: "trader_agent",
              metadata: { name: "Trading Assistant", description: "AI Trading Assistant Conversation" }
            });
            setMessages([]);
          }
          setCurrentConversation(conversation);
        } catch (error) {
          console.error('Failed to initialize conversation:', error);
          const errorMessage = error.message || 'Failed to connect to AI assistant.';
          setConnectionError(errorMessage);
          toast({ variant: "destructive", title: "Connection Error", description: errorMessage });
        } finally {
          setIsThinking(false);
        }
      }
    };
    initConversation();
  }, [isOpen, currentConversation, toast]);

  useEffect(() => {
    if (!currentConversation?.id) return;

    const unsubscribe = agentSDK.subscribeToConversation(currentConversation.id, (data) => {
      const currentMessages = data.messages || [];

      // FIX: Only update if messages actually changed
      setMessages((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(currentMessages)) {
          return prev;
        }
        return currentMessages;
      });

      const latestMessage = currentMessages[currentMessages.length - 1];

      let proposalDetected = null;
      if (latestMessage?.role === 'assistant' && latestMessage?.content) {
        proposalDetected = extractTradeProposal(latestMessage.content);
      }

      if (proposalDetected) {
        setPendingTrade(proposalDetected);
      } else {
        if (latestMessage?.role !== 'user' || !latestMessage?.content?.includes('USER_CONFIRMED_TRADE')) {
          setPendingTrade(null);
        }
      }

      setIsThinking(
        latestMessage?.role === 'user' ||
        latestMessage?.role === 'assistant' && !latestMessage.content && (latestMessage.tool_calls?.length > 0 || latestMessage.stream_delta)
      );

      if (currentMessages.length > 0) {
        setConnectionError(null);
      }
    });

    return () => unsubscribe();
  }, [currentConversation?.id, extractTradeProposal]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingTrade]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className="sm:max-w-2xl h-[80vh] flex flex-col p-0"
          style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>

          <DialogHeader
            className="p-4 border-b flex flex-row items-center justify-between"
            style={{ borderColor: 'var(--border-color)' }}>

            <DialogTitle className="neon-text">NeonTrade AI Assistant</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !isThinking && !connectionError &&
            <div className="text-sm opacity-80" style={{ color: 'var(--text-secondary)' }}>
                This is a large language model AI. Feed it the right information to get the information you need. Or just ask it a question.
              </div>
            }

            {connectionError &&
            <div className="text-center p-4">
                <div className="text-red-500 font-medium mb-2">❌ Connection Failed</div>
                <div className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  {connectionError}
                </div>
                <Button
                onClick={() => {
                  setCurrentConversation(null);
                  setMessages([]);
                }}
                variant="outline">

                  Retry Connection
                </Button>
              </div>
            }

            <AnimatePresence>
              {messages.map((msg, index) => {
                const containsHiddenProposal = msg.role === 'assistant' && msg.content && extractTradeProposal(msg.content);
                if (containsHiddenProposal && pendingTrade) return null;

                return (
                  <motion.div
                    key={msg.id || index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}>

                    <MessageBubble message={msg} />
                  </motion.div>);

              })}
            </AnimatePresence>

            {isThinking && !connectionError &&
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-center">

                <div className="flex items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-green-500" />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    AI is thinking...
                  </span>
                </div>
              </motion.div>
            }
            <div ref={messagesEndRef} />

            {thinkingText &&
            <div className="mt-2">
                <TypingIndicator text={thinkingText} />
              </div>
            }
          </div>

          {pendingTrade &&
          <div className="px-4 pb-4">
              <TradeConfirmation
              proposal={pendingTrade}
              onConfirm={() => handleTradeConfirmation(pendingTrade.trade_details)}
              onCancel={handleTradeCancel} />

            </div>
          }

          <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage(inputText)}
                placeholder="Ask the AI to trade for you..."
                className="flex-1 text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-800" />

              <Button size="icon" onClick={() => handleSendMessage(inputText)}>
                <Send className="w-5 h-5" />
              </Button>
            </div>

            {/* Mic controls */}
            <div className="flex items-center justify-between gap-2">
              {isSupported &&
              <Button
                type="button"
                onClick={isListening ? stop : start}
                variant={isListening ? "destructive" : "outline"}
                size="sm" className="bg-lime-500 px-3 text-sm font-medium rounded-md justify-center whitespace-nowrap ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input hover:bg-accent hover:text-accent-foreground h-9 flex items-center gap-2">


                  {isListening ?
                <>
                      <MicOff className="w-4 h-4" />
                      Stop Listening
                    </> :

                <>
                      <Mic className="w-4 h-4" />
                      Start Mic
                    </>
                }
                </Button>
              }
              {isSpeaking &&
              <Button
                type="button"
                onClick={stopSpeaking}
                variant="outline"
                size="sm"
                className="ml-auto inline-flex items-center gap-1">

                  <Square className="w-3.5 h-3.5" />
                  Stop Speaking
                </Button>
              }
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showTutorial &&
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}>

          <div
          className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl p-5"
          style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }}
          onClick={(e) => e.stopPropagation()}>

            <button
            className="absolute top-4 right-4 rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={(e) => {
              e.stopPropagation();
              closeTutorial();
            }}
            aria-label="Close tutorial">

              <Square className="w-5 h-5" />
            </button>

            <div className="space-y-4 pr-2">
              <h2 className="text-xl font-bold neon-text">Meet Neo</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>I'm your personalized trading copilot. From "what is a ticker?" to executing hundreds of orders an hour — I've got you.

              </p>
              <div className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Explain complex ideas simply, or go full quant trading — your call.</li>
                  <li>Place trades, set stop-loss/take-profit, manage conditional orders.</li>
                  <li>Build a personalized roadmap for your goals — house, retirement, or moonshots.</li>
                  <li>Respect privacy. No drama. Your data stays yours.</li>
                </ul>
              </div>
              <div className="rounded-lg p-3 border"
            style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}>
                <p className="text-sm">"Help, I'm trapped in a tutorial! Click the green button to set me free." — Neo, probably.

                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Jokes aside, privacy and confidentiality are non‑negotiable here. We mean business when it comes to your information.
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 pt-2">
                <label
                className="flex items-center gap-2 select-none cursor-pointer"
                onClick={(e) => e.stopPropagation()}>

                  <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)} />

                  <span className="text-sm">Don't need the tutorial anymore</span>
                </label>

                <button
                className="px-4 py-2 rounded-md text-white bg-green-600 hover:bg-green-700"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTutorial();
                }}>

                  Get started
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </>);
}