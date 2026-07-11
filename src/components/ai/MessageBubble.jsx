import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from "@/components/ui/button";
import { Copy, Zap, CheckCircle2, AlertCircle, Loader2, ChevronRight, Clock } from 'lucide-react';
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSettings } from "@/components/utils/SettingsContext";

const FunctionDisplay = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const name = toolCall?.name || 'Function';
  const status = toolCall?.status || 'pending';
  const results = toolCall?.results;

  // Function to check if a tool call should be hidden and return friendly message
  const getToolMessage = (toolName) => {
    // Hide all web search variations
    if (toolName.toLowerCase().includes('web_search') || toolName.toLowerCase().includes('search')) {
      return 'Checking current market prices...';
    }

    // Hide all trade-related operations
    if (toolName.toLowerCase().includes('trade') && (toolName.includes('create') || toolName.includes('Create'))) {
      return 'Recording your trade...';
    }

    // Hide all holding-related operations
    if (toolName.toLowerCase().includes('holding') || toolName.includes('Holding')) {
      if (toolName.includes('read') || toolName.includes('Read')) {
        return 'Checking your portfolio...';
      }
      if (toolName.includes('create') || toolName.includes('Create')) {
        return 'Updating your portfolio...';
      }
      if (toolName.includes('update') || toolName.includes('Update')) {
        return 'Updating your portfolio...';
      }
    }

    // Hide all wallet-related operations
    if (toolName.toLowerCase().includes('wallet') || toolName.includes('Wallet')) {
      if (toolName.includes('read') || toolName.includes('Read')) {
        return 'Checking your wallet balance...';
      }
      if (toolName.includes('update') || toolName.includes('Update')) {
        return 'Updating your wallet balance...';
      }
    }

    // Hide all user settings operations
    if (toolName.toLowerCase().includes('usersettings') || toolName.includes('UserSettings')) {
      return 'Checking your settings...';
    }

    // Hide any other entity operations (generic fallback)
    if (toolName.includes('read_') || toolName.includes('create_') || toolName.includes('update_') ||
    toolName.includes('.read') || toolName.includes('.create') || toolName.includes('.update')) {
      return 'Processing your request...';
    }

    return null; // Not a hidden tool
  };

  const friendlyMessage = getToolMessage(name);

  if (friendlyMessage) {
    const isRunning = status === 'pending' || status === 'running' || status === 'in_progress';

    return (
      <div className="mt-2 text-xs">
        <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border",
          isRunning ? "bg-blue-900/50 border-blue-700" : "bg-slate-800 border-slate-700"
        )}>
          {isRunning ? 
            <Loader2 className="h-3 w-3 text-blue-400 animate-spin" /> : 
            <CheckCircle2 className="h-3 w-3 text-green-400" />
          }
          <span className={cn(isRunning ? "text-blue-300" : "text-slate-300")}>{friendlyMessage}</span>
        </div>
      </div>
    );
  }

  // Parse and check for errors
  const parsedResults = (() => {
    if (!results) return null;
    try {
      return typeof results === 'string' ? JSON.parse(results) : results;
    } catch {
      return results;
    }
  })();

  const isError = results && (
    (typeof results === 'string' && /error|failed/i.test(results)) ||
    (parsedResults?.success === false)
  );

  // Status configuration
  const statusConfig = {
    pending: { icon: Clock, color: 'text-slate-400', text: 'Pending' },
    running: { icon: Loader2, color: 'text-slate-400', text: 'Running...', spin: true },
    in_progress: { icon: Loader2, color: 'text-slate-400', text: 'Running...', spin: true },
    completed: isError ? 
      { icon: AlertCircle, color: 'text-red-400', text: 'Failed' } : 
      { icon: CheckCircle2, color: 'text-green-400', text: 'Success' },
    success: { icon: CheckCircle2, color: 'text-green-400', text: 'Success' },
    failed: { icon: AlertCircle, color: 'text-red-400', text: 'Failed' },
    error: { icon: AlertCircle, color: 'text-red-400', text: 'Failed' }
  }[status] || { icon: Zap, color: 'text-slate-400', text: '' };

  const Icon = statusConfig.icon;
  const formattedName = name.split('.').reverse().join(' ').toLowerCase();

  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all",
          "hover:bg-slate-800",
          expanded ? "bg-slate-800 border-slate-600" : "bg-slate-900 border-slate-700"
        )}
      >
        <Icon className={cn("h-3 w-3", statusConfig.color, statusConfig.spin && "animate-spin")} />
        <span className="text-slate-300">{formattedName}</span>
        {statusConfig.text && (
          <span className={cn("text-slate-400", isError && "text-red-400")}>
            • {statusConfig.text}
          </span>
        )}
        {!statusConfig.spin && (toolCall.arguments_string || results) && (
          <ChevronRight className={cn("h-3 w-3 text-slate-500 transition-transform ml-auto", 
            expanded && "rotate-90")} />
        )}
      </button>
      
      {expanded && !statusConfig.spin && (
        <div className="mt-1.5 ml-3 pl-3 border-l-2 border-slate-700 space-y-2">
          {toolCall.arguments_string && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Parameters:</div>
              <pre className="bg-slate-900 rounded-md p-2 text-xs text-slate-300 whitespace-pre-wrap">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(toolCall.arguments_string), null, 2);
                  } catch {
                    return toolCall.arguments_string;
                  }
                })()}
              </pre>
            </div>
          )}
          {parsedResults && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Result:</div>
              <pre className="bg-slate-900 rounded-md p-2 text-xs text-slate-300 whitespace-pre-wrap max-h-48 overflow-auto">
                {typeof parsedResults === 'object' ? 
                  JSON.stringify(parsedResults, null, 2) : parsedResults}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  // Voice talk-back for assistant messages
  const spokenRef = useRef(false);
  const voicesLoadedRef = useRef(false);
  const { settings } = useSettings?.() || {};

  // Simple stable hash for caching spoken messages
  const hashContent = (str) => {
    let h = 0, i, chr;
    if (!str) return '0';
    for (i = 0; i < str.length; i++) {
      chr = str.charCodeAt(i);
      h = ((h << 5) - h) + chr;
      h |= 0;
    }
    return String(h);
  };

  useEffect(() => {
    if (!message || isUser) return;
    if (!settings || settings.tts_enabled === false) return;
    if (spokenRef.current) return;

    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) return;

    // Prevent repeating last assistant line when modal reopens
    const key = `assistant_spoken_${hashContent(content)}`;
    try {
      if (sessionStorage.getItem(key)) {
        return; // already spoken this exact content
      }
    } catch {}

    // Check if SpeechSynthesisUtterance is available in the current environment
    if (!('SpeechSynthesisUtterance' in window)) {
      console.warn("SpeechSynthesisUtterance not supported in this browser.");
      return;
    }

    const synth = window.speechSynthesis;
    if (!synth) return;

    // CRITICAL FIX: Properly handle voice loading
    const speakMessage = () => {
      // Cancel any ongoing speech first
      synth.cancel();

      const voices = synth.getVoices();
      console.log('[TTS] Available voices:', voices.length);

      const rateMap = { slow: 0.8, normal: 1.0, fast: 1.25 };
      const pitchMap = { slow: 0.9, normal: 1.0, fast: 1.2 };

      const rate = rateMap[settings.tts_speech_rate || 'normal'] ?? 1.0;
      const pitch = pitchMap[settings.tts_speech_pitch || 'normal'] ?? 1.0;

      const utterance = new SpeechSynthesisUtterance(content);
      
      // Set voice if specified
      if (settings.tts_voice_uri && voices.length > 0) {
        const selectedVoice = voices.find(v => v.voiceURI === settings.tts_voice_uri);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          console.log('[TTS] Using voice:', selectedVoice.name);
        }
      }
      
      utterance.rate = rate;
      utterance.pitch = pitch;

      // CRITICAL: Add event listeners to track completion
      utterance.onstart = () => {
        console.log('[TTS] ✅ Started speaking:', content.substring(0, 50) + '...');
      };

      utterance.onend = () => {
        console.log('[TTS] ✅ Finished speaking');
        spokenRef.current = true;
        try { sessionStorage.setItem(key, '1'); } catch {}
      };

      utterance.onerror = (event) => {
        console.error('[TTS] ❌ Error speaking:', event.error);
        spokenRef.current = true; // Mark as spoken to prevent retry
      };

      // CRITICAL: Speak the message
      console.log('[TTS] Speaking message length:', content.length, 'chars');
      synth.speak(utterance);
    };

    // CRITICAL FIX: Wait for voices to load before speaking
    const voices = synth.getVoices();
    
    if (voices.length > 0) {
      // Voices already loaded
      console.log('[TTS] Voices already loaded, speaking immediately');
      speakMessage();
    } else {
      // Wait for voices to load
      console.log('[TTS] Waiting for voices to load...');
      const handleVoicesChanged = () => {
        const loadedVoices = synth.getVoices();
        if (loadedVoices.length > 0 && !voicesLoadedRef.current) {
          console.log('[TTS] Voices loaded, now speaking');
          voicesLoadedRef.current = true;
          speakMessage();
        }
      };

      synth.addEventListener('voiceschanged', handleVoicesChanged);

      // Fallback: speak after 500ms even if voiceschanged doesn't fire
      const fallbackTimer = setTimeout(() => {
        if (!spokenRef.current) {
          console.log('[TTS] Fallback: speaking without waiting for voices');
          speakMessage();
        }
      }, 500);

      return () => {
        synth.removeEventListener('voiceschanged', handleVoicesChanged);
        clearTimeout(fallbackTimer);
      };
    }

  }, [message, isUser, settings]);

  // Enhanced trade proposal detection - hide any message containing trade proposals
  const containsTradeProposal = message.role === 'assistant' && message.content && (
    message.content.includes('TRADE_PROPOSAL:') ||
    message.content.includes('"action": "propose_trade"') ||
    message.content.includes('"action":"propose_trade"') ||
    (message.content.includes('propose_trade') && message.content.includes('trade_details'))
  );

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center mt-0.5">
          <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        </div>
      ) : null}

      <div className={cn("max-w-[85%]", isUser && "flex flex-col items-end")}>
        {message.content && !containsTradeProposal ? (
          <div className="bg-slate-600 px-4 py-2.5 rounded-2xl border border-slate-200">
            {isUser ? (
              <p className="text-sm leading-relaxed">{message.content}</p>
            ) : (
              <ReactMarkdown
                className="text-sm prose prose-sm prose-slate max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                disallowedElements={['script', 'iframe', 'object', 'embed', 'form', 'input', 'style']}
                unwrapDisallowed={true}
                components={{
                  code: ({ inline, className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const codeContent = String(children).replace(/\n$/, '');
                    return !inline && match ? (
                      <div className="relative group/code">
                        <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto my-2">
                          <code className={className} {...props}>{children}</code>
                        </pre>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover/code:opacity-100 bg-slate-800 hover:bg-slate-700"
                          onClick={() => {
                            navigator.clipboard.writeText(codeContent);
                            toast.success('Code copied');
                          }}
                        >
                          <Copy className="h-3 w-3 text-slate-400" />
                        </Button>
                      </div>
                    ) : (
                      <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">
                        {children}
                      </code>
                    );
                  },
                  a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
                  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
                  ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
                  ol: ({ children }) => <ol className="my-1 ml-4 list-decimal">{children}</ol>,
                  li: ({ children }) => <li className="my-0.5">{children}</li>,
                  h1: ({ children }) => <h1 className="text-lg font-semibold my-2">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-base font-semibold my-2">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold my-2">{children}</h3>,
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-slate-300 pl-3 my-2 text-slate-600">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </div>
        ) : null}
        
        {containsTradeProposal ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Trade proposal ready - please say or click confirm</span>
            </div>
          </div>
        ) : null}
        
        {message.tool_calls?.length > 0 ? (
          <div className="space-y-1">
            {message.tool_calls.map((toolCall, idx) => (
              <FunctionDisplay key={idx} toolCall={toolCall} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}