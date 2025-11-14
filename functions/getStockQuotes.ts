import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

const CACHE_TTL_MS = 15000; // 15s soft cache to reduce bursts
const MIN_INTERVAL_MS = 1200; // ~ <1 rps per instance to avoid upstream bans
let lastCallAt = 0;
let cache = new Map(); // symbol -> { ts, data }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function fallback(base44, symbols) {
  try {
    const { data } = await base44.functions.invoke('getStockQuotesSafe', { symbols });
    return Array.isArray(data) ? data : [];
  } catch (_e) {
    return [];
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return json({ error: 'Unauthorized' }, 401);

    const { symbols } = await req.json().catch(() => ({ symbols: [] }));
    const syms = Array.isArray(symbols) ? symbols.map(s => String(s || '').toUpperCase()).filter(Boolean) : [];

    // Serve cached items when available and fresh
    const now = Date.now();
    const out = [];
    const need = [];
    for (const s of syms) {
      const c = cache.get(s);
      if (c && now - c.ts < CACHE_TTL_MS) out.push(c.data);
      else need.push(s);
    }
    if (need.length === 0) {
      return json(out);
    }

    // Enforce minimal interval
    const delta = now - lastCallAt;
    if (delta < MIN_INTERVAL_MS) {
      const wait = MIN_INTERVAL_MS - delta;
      await new Promise(r => setTimeout(r, wait));
    }

    // Try the original provider via safe wrapper (to avoid 429s)
    const rows = await fallback(base44, need);

    // Update cache for received symbols
    const mapped = [];
    for (const r of rows) {
      if (!r || !r.symbol) continue;
      cache.set(r.symbol.toUpperCase(), { ts: Date.now(), data: r });
      mapped.push(r);
    }

    // Merge cached + fresh preserving input order
    const final = [];
    for (const s of syms) {
      const c = cache.get(s);
      if (c) final.push(c.data);
    }

    lastCallAt = Date.now();
    return json(final);
  } catch (error) {
    // Never 500 for rate issues: return empty list gracefully
    return json([], 200);
  }
});