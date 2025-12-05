import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mic, Square, Send } from "lucide-react";
import { base44 } from "@/api/base44Client";
import useSpeechRecognition from "./hooks/useSpeechRecognition";

export default function MarketAnalystModal({ isOpen, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const listRef = useRef(null);

  const addMessage = (role, content) => {
    setMessages((prev) => [...prev, { role, content }]);
    // no auto-scroll focus stealing; just gentle scroll
    setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 50);
  };

  // Simple TTS speak function defined before any use (no TDZ issues)
  function speakText(content) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const utter = new SpeechSynthesisUtterance(content);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.lang = "en-US";
      window.speechSynthesis.speak(utter);
    } catch (_) {}
  }
  function stopSpeaking() {
    try {window.speechSynthesis && window.speechSynthesis.cancel();} catch (_) {}
  }

  const isSpeaking = useMemo(() => {
    return typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.speaking;
  }, [isOpen, messages.length]);

  const sendLLM = async (prompt) => {
    const addWeb = /news|headline|today|latest|this week|tweet|twitter|x\.com|reddit|social|predict|prediction|forecast|price target|guidance|earnings|rumor|breaking/i.test(prompt);
    const res = await base44.integrations.Core.InvokeLLM({
      prompt: [
      "You are a market analyst. Answer concisely with clear reasoning.",
      "If asked to predict, provide an educated estimate and your assumptions.",
      "Include any relevant, fresh context when available.",
      `User: ${prompt}`].
      join("\n"),
      add_context_from_internet: addWeb
    });
    const reply = typeof res === "string" ? res : res?.answer || JSON.stringify(res);
    return reply;
  };

  const handleSend = async (val) => {
    const q = (val ?? text).trim();
    if (!q) return;
    addMessage("user", q);
    setText("");
    try {
      const reply = await sendLLM(q);
      addMessage("assistant", reply);
      // Do not auto-speak to avoid surprises; user can press Stop if something else is speaking
      // If you want auto-speak, uncomment:
      // speakText(reply);
    } catch (e) {
      addMessage("assistant", "Sorry, I couldn't fetch the analysis right now.");
    }
  };

  // Voice capture: no focus stealing; auto-sends after 2s silence
  const { isSupported, isListening, interim, start, stop } = useSpeechRecognition({
    silenceMs: 2000,
    onAutoSend: async (captured) => {
      await handleSend(captured);
    }
  });

  // Expose mic controls (optional external usage)
  useEffect(() => {
    window.__analystMic = { start, stop };
    return () => {
      if (window.__analystMic) delete window.__analystMic;
      try {stop();} catch (_) {}
    };
  }, [start, stop]);

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="bg-slate-950 p-6 fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Market Analyst</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div
            ref={listRef} className="bg-neutral-950 p-3 rounded-md h-64 overflow-auto border dark:bg-slate-900">


            {messages.length === 0 &&
            <div className="text-sm text-slate-500">
                Ask about a stock, predictions, or say “latest news about AAPL”.
              </div>
            }
            <div className="space-y-3">
              {messages.map((m, i) =>
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="bg-gray-600 px-3 py-2 text-sm rounded-xl max-w-[80%] dark:bg-slate-800 dark:text-slate-100">






                    {m.content}
                  </div>
                </div>
              )}
              {isListening &&
              <div className="text-xs text-slate-500">Listening… {interim}</div>
              }
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Type your question…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }} />

            <Button onClick={() => handleSend()} className="gap-1">
              <Send className="w-4 h-4" /> Send
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {isSupported &&
            <Button
              variant={isListening ? "destructive" : "secondary"}
              onClick={isListening ? stop : start}
              className="gap-2">

                <Mic className="w-4 h-4" />
                {isListening ? "Stop Listening" : "Start Mic"}
              </Button>
            }
            {isSpeaking &&
            <Button
              variant="secondary"
              onClick={stopSpeaking}
              className="ml-auto gap-2"
              title="Stop speaking"
              aria-label="Stop speaking">

                <Square className="w-4 h-4" />
                Stop
              </Button>
            }
          </div>
        </div>
      </DialogContent>
    </Dialog>);

}