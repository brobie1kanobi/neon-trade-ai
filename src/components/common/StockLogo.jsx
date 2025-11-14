import React from "react";

export default function StockLogo({ symbol, name, domain, srcs = [], size = 20, className = "" }) {
  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || symbol)}&background=111111&color=ffffff&size=${size * 4}`;
  const clearbit = domain ? `https://logo.clearbit.com/${domain}` : null;

  // Build a unique, ordered list of candidate URLs
  const candidates = Array.from(new Set([
    ...srcs.filter(Boolean),
    clearbit,
    fallbackAvatar
  ].filter(Boolean)));

  const [idx, setIdx] = React.useState(0);
  const current = candidates[idx];

  // If no candidates, render letter placeholder
  if (!current) {
    return (
      <div
        className={`rounded ${className}`}
        style={{ width: size, height: size, backgroundColor: "#e5e7eb", display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5 }}
        aria-label={symbol}
        title={name || symbol}
      >
        {(symbol || "?").slice(0, 1)}
      </div>
    );
  }

  return (
    <img
      src={current}
      alt={symbol}
      width={size}
      height={size}
      loading="eager"
      decoding="async"
      onError={() => setIdx((i) => Math.min(i + 1, candidates.length - 1))}
      className={`rounded ${className}`}
      style={{ width: size, height: size, objectFit: "cover", backgroundColor: "#f1f5f9" }}
      title={name || symbol}
    />
  );
}