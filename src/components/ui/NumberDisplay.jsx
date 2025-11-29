
import React from "react";

/**
 * NumberDisplay
 * - Formats numbers with thousands separators and fixed decimals
 * - Auto-shrinks font size to keep content inside its container on all screens
 */
export default function NumberDisplay({
  value,
  prefix = "",
  suffix = "",
  decimals = 2,
  className = "",
  maxFontSize = 40,
  minFontSize = 16,
  locale = "en-US",
  title, // optional tooltip title
  // New: color tone control
  tone, // 'positive' | 'negative' | 'neutral' | undefined
  positiveClass = "text-green-500",
  negativeClass = "text-red-500",
  neutralClass = ""
}) {
  const containerRef = React.useRef(null);
  const textRef = React.useRef(null);
  const [fontSize, setFontSize] = React.useState(maxFontSize);

  const formatted = React.useMemo(() => {
    const num = typeof value === "number" ? value : Number(value || 0);
    const fixed = num.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return `${prefix}${fixed}${suffix}`;
  }, [value, prefix, suffix, decimals, locale]);

  React.useEffect(() => {
    if (!containerRef.current || !textRef.current) return;
    const container = containerRef.current;
    const text = textRef.current;

    const fit = () => {
      // Start at max and shrink down as needed
      let currentSize = maxFontSize;
      text.style.fontSize = `${currentSize}px`;
      // Small padding tolerance
      const padding = 8;

      // Prevent infinite loops; cap iterations
      let guard = 0;
      while (guard < 20) {
        const cWidth = container.clientWidth - padding;
        const tWidth = text.scrollWidth;
        if (tWidth <= cWidth || currentSize <= minFontSize) break;
        currentSize = Math.max(minFontSize, Math.floor(currentSize * 0.9));
        text.style.fontSize = `${currentSize}px`;
        guard += 1;
      }
      setFontSize(currentSize);
    };

    fit();

    const ro = new ResizeObserver(() => {
      fit();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [formatted, maxFontSize, minFontSize]);

  // New: determine inner text color by tone if provided
  const toneClass = tone === 'positive'
    ? positiveClass
    : tone === 'negative'
      ? negativeClass
      : neutralClass;

  return (
    <div ref={containerRef} className={`w-full overflow-hidden ${className}`} title={title || formatted}>
      <span
        ref={textRef}
        className={toneClass}
        style={{ fontSize: `${fontSize}px`, lineHeight: 1.1, display: "inline-block", whiteSpace: "nowrap" }}
      >
        {formatted}
      </span>
    </div>
  );
}
