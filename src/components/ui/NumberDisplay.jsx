import React, { useRef, useEffect, useState } from 'react';

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
  neutralClass = ''
}) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  const formattedValue = typeof value === 'number' 
    ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '0.00';

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