import React, { useRef, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function NumberDisplay({
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  className = '',
  maxFontSize = 32,
  minFontSize = 14,
  tone = 'neutral',
  positiveClass = 'text-green-500',
  negativeClass = 'text-red-500',
  neutralClass = '',
  loading = false,
  showLoadingForZero = false
}) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  // CRITICAL: Show loading indicator if value is 0 and showLoadingForZero is true
  const isLoading = loading || (showLoadingForZero && (value === 0 || value === null || value === undefined));

  const formattedValue = typeof value === 'number' 
    ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '---';

  const fullText = `${prefix}${formattedValue}${suffix}`;

  useEffect(() => {
    const adjustFontSize = () => {
      const container = containerRef.current;
      const text = textRef.current;
      
      if (!container || !text) return;

      let currentSize = maxFontSize;
      text.style.fontSize = `${currentSize}px`;
      
      let attempts = 0;
      while (
        (text.scrollWidth > container.clientWidth || text.scrollHeight > container.clientHeight) &&
        currentSize > minFontSize &&
        attempts < 50
      ) {
        currentSize -= 1;
        text.style.fontSize = `${currentSize}px`;
        attempts++;
      }
      
      setFontSize(currentSize);
    };

    const resizeObserver = new ResizeObserver(adjustFontSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    adjustFontSize();

    return () => {
      resizeObserver.disconnect();
    };
  }, [formattedValue, maxFontSize, minFontSize]);

  const toneClass = tone === 'positive' 
    ? positiveClass 
    : tone === 'negative' 
      ? negativeClass 
      : neutralClass;

  // Show loading spinner instead of $0.00
  if (isLoading) {
    return (
      <div 
        ref={containerRef} 
        className={`overflow-hidden flex items-center gap-2 ${className}`}
        style={{ width: '100%', height: 'auto' }}
      >
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-secondary)' }} />
        <span 
          className="font-bold whitespace-nowrap"
          style={{ fontSize: `${minFontSize}px`, color: 'var(--text-secondary)' }}
        >
          {prefix}---{suffix}
        </span>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className={`overflow-hidden ${className}`}
      style={{ width: '100%', height: 'auto' }}
    >
      <span
        ref={textRef}
        className={`font-bold whitespace-nowrap ${toneClass}`}
        style={{ fontSize: `${fontSize}px`, display: 'inline-block' }}
        title={fullText}
      >
        {fullText}
      </span>
    </div>
  );
}