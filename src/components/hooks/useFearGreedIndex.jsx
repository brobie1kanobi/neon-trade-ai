import { useState, useEffect } from "react";

const CACHE_KEY = "fearGreedIndex";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCached() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed._ts < CACHE_TTL_MS) return parsed;
  } catch (_) {}
  return null;
}

function setCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _ts: Date.now() }));
  } catch (_) {}
}

export default function useFearGreedIndex() {
  const [data, setData] = useState(() => getCached());

  useEffect(() => {
    const cached = getCached();
    if (cached) {
      setData(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch("https://api.alternative.me/fng/?limit=1", {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return;
        const json = await res.json();
        const entry = json?.data?.[0];
        if (!entry) return;
        const result = {
          score: parseInt(entry.value, 10),
          label: entry.value_classification,
          timestamp: entry.timestamp,
        };
        if (!cancelled) {
          setData(result);
          setCache(result);
        }
      } catch (_) {
        // Silent fail — gauge just won't show or uses LLM fallback
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return data;
}