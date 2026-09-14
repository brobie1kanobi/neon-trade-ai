/**
 * Shared Kraken private-API caller + symbol normalizer.
 * Used by syncTradesWithKraken and dedupeTradeRecords so both read fills
 * through exactly the same code path (Kraken is the source of truth).
 */

const KRAKEN_API_URL = 'https://api.kraken.com';
const API_TIMEOUT = 15000;

let lastNonce = 0;
function generateNonce() {
  const now = Date.now() * 1000;
  if (now <= lastNonce) lastNonce++;
  else lastNonce = now;
  return lastNonce.toString();
}

export async function callKrakenPrivate(apiKey, apiSecret, endpoint, data = {}) {
  const cleanKey = typeof apiKey === 'string' ? apiKey.trim().replace(/\s+/g, '') : apiKey;
  const cleanSecret = typeof apiSecret === 'string' ? apiSecret.trim().replace(/\s+/g, '') : apiSecret;
  const nonce = generateNonce();
  const postData = new URLSearchParams({ nonce, ...data }).toString();

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce + postData));
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(cleanSecret), c => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );

  const pathBytes = new TextEncoder().encode(endpoint);
  const combined = new Uint8Array(pathBytes.length + hash.byteLength);
  combined.set(pathBytes);
  combined.set(new Uint8Array(hash), pathBytes.length);

  const signature = await crypto.subtle.sign('HMAC', hmacKey, combined);
  const apiSign = btoa(String.fromCharCode(...new Uint8Array(signature)));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const response = await fetch(`${KRAKEN_API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'API-Key': cleanKey,
        'API-Sign': apiSign,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NeonTrade-AI/1.0'
      },
      body: postData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return await response.json();
  } catch (fetchError) {
    clearTimeout(timeoutId);
    throw fetchError;
  }
}

/** Convert any Kraken pair/asset spelling to the app's standard symbol. */
export function normalizeKrakenSymbol(pair) {
  if (!pair) return 'UNKNOWN';
  let s = String(pair).toUpperCase();
  s = s.replace(/USD$/, '').replace(/ZUSD$/, '').replace(/\/USD$/, '');
  s = s.replace(/^XXBT$/, 'BTC').replace(/^XBT$/, 'BTC').replace(/^XBTC$/, 'BTC');
  if (s === 'XBT') s = 'BTC';
  s = s.replace(/^XXRP$/, 'XRP').replace(/^XRPZ$/, 'XRP');
  s = s.replace(/^XETH$/, 'ETH').replace(/^XXDG$/, 'DOGE').replace(/^XDG$/, 'DOGE').replace(/^XLTC$/, 'LTC');
  s = s.replace(/^XXLM$/, 'XLM').replace(/^XXLMZ$/, 'XLM');
  if (s.length > 3 && s.startsWith('X') && /^X[A-Z]/.test(s)) s = s.substring(1);
  if (s.length > 3 && s.endsWith('Z')) s = s.slice(0, -1);
  if (s === 'XBT') s = 'BTC';
  return s;
}