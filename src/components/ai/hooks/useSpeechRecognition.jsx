import { useCallback, useEffect, useRef, useState } from "react";

export default function useSpeechRecognition({
  language = "en-US",
  silenceMs = 2000,
  onAutoSend
} = {}) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState(null);

  const recRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const accumulatedTextRef = useRef("");

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(Boolean(SR));
  }, []);

  const stop = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    const rec = recRef.current;
    if (rec) {
      try { rec.stop(); } catch (_) {}
    }
    recRef.current = null;
    setIsListening(false);
    setInterim("");
    
    // Send accumulated text if any
    const text = accumulatedTextRef.current.trim();
    if (text && typeof onAutoSend === "function") {
      onAutoSend(text);
    }
    accumulatedTextRef.current = "";
    setFinalText("");
  }, [onAutoSend]);

  const resetSilence = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      stop();
    }, silenceMs);
  }, [silenceMs, stop]);

  const start = useCallback(() => {
    setError(null);
    accumulatedTextRef.current = "";
    setFinalText("");
    setInterim("");
    
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("Speech recognition not supported");
      return;
    }
    
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = language;

      rec.onstart = () => {
        console.log("Speech recognition started");
        setIsListening(true);
        resetSilence();
      };
      
      rec.onresult = (e) => {
        let interimStr = "";
        
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0]?.transcript || "";
          if (e.results[i].isFinal) {
            accumulatedTextRef.current += transcript + " ";
            setFinalText(accumulatedTextRef.current);
          } else {
            interimStr += transcript;
          }
        }
        
        setInterim(interimStr);
        resetSilence();
      };
      
      rec.onaudioend = resetSilence;
      rec.onspeechend = resetSilence;
      
      rec.onerror = (ev) => {
        console.error("Speech recognition error:", ev.error);
        if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
          setError(ev.error || "speech_error");
        }
        // Don't stop on no-speech - let the silence timer handle it
        if (ev.error !== 'no-speech') {
          stop();
        }
      };
      
      rec.onend = () => {
        console.log("Speech recognition ended");
        setIsListening(false);
      };

      recRef.current = rec;
      rec.start();
    } catch (e) {
      console.error("Failed to start speech recognition:", e);
      setError(e?.message || "speech_error");
      stop();
    }
  }, [language, resetSilence, stop]);

  const clear = useCallback(() => {
    setInterim("");
    setFinalText("");
    accumulatedTextRef.current = "";
  }, []);

  return {
    isSupported,
    isListening,
    interim,
    finalText,
    error,
    start,
    stop,
    clear
  };
}