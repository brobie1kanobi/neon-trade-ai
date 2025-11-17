import React from "react";

export default function TypingIndicator({ text = "Thinking..." }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{ backgroundColor: 'var(--secondary-bg)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-center justify-center">
        <span className="relative flex h-6 w-10">
          <span className="absolute inline-flex h-2 w-2 rounded-full bg-gray-400 animate-bounce left-0 top-2" />
          <span className="absolute inline-flex h-2 w-2 rounded-full bg-gray-400 animate-bounce left-3 top-2" style={{ animationDelay: '0.15s' }} />
          <span className="absolute inline-flex h-2 w-2 rounded-full bg-gray-400 animate-bounce left-6 top-2" style={{ animationDelay: '0.3s' }} />
        </span>
      </div>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {text}
      </div>
    </div>
  );
}