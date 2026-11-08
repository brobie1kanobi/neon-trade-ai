/**
 * Kraken minimum order sizes (in units of the coin), shared by every function
 * that sizes orders. Kraken changes these from time to time, so the live
 * values are read from Kraken's public AssetPairs endpoint (cached 24 hours);
 * the backup list below (checked against Kraken on 2026-11-08) is used only
 * if Kraken can't be reached.
 */

export const FALLBACK_MIN_ORDER_SIZES: Record<string, number> = {
  BTC: 0.00006, XBT: 0.00006, ETH: 0.002, SOL: 0.05, XRP: 4, ADA: 20, DOT: 3.9,
  DOGE: 50, XDG: 50, LINK: 0.35, UNI: 0.7, POL: 60, MATIC: 60, ATOM: 3.5, AVAX: 0.5,
  BCH: 0.018, LTC: 0.08, TRX: 16, SHIB: 770000, XLM: 25, ALGO: 41, FIL: 6, NEAR: 1,
  APT: 8, ARB: 30, OP: 45, INJ: 0.7, PEPE: 1100000, SUI: 5, HBAR: 55, KAS: 170,
  TAO: 0.022, EIGEN: 30, ENA: 30, GRASS: 9, GOAT: 350, TRUMP: 3, FARTCOIN: 40,
  MOVE: 6, KAITO: 20, TIA: 11, FET: 18, JUP: 20, WIF: 30, BONK: 1800000,
  FLOKI: 220000, BABY: 400, RENDER: 2.5, RNDR: 2.5, GRT: 250, IMX: 40, SAND: 120,
  MANA: 70, AXS: 6, ENS: 1, LDO: 15, RPL: 3.5, CRV: 15, AAVE: 0.03, MKR: 0.0035,
  SNX: 30, COMP: 0.25, YFI: 0.0025, SUSHI: 25, '1INCH': 60, BAL: 40, ZRX: 50,
  ENJ: 200, CHZ: 400, GALA: 3000, APE: 45, BLUR: 700, SEI: 100, PYTH: 80, WLD: 9,
  STRK: 110
};

const KRAKEN_BASE_ALIASES: Record<string, string> = {
  XXBT: 'BTC', XBT: 'BTC', XXDG: 'DOGE', XDG: 'DOGE', XETH: 'ETH',
  XXRP: 'XRP', XLTC: 'LTC', XXLM: 'XLM'
};

const CACHE_MS = 24 * 3600000; // once a day
let cached: Record<string, number> | null = null;
let cachedAt = 0;

export async function getMinOrderSizes(): Promise<Record<string, number>> {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('https://api.kraken.com/0/public/AssetPairs', { signal: controller.signal });
    const data = await res.json();
    const live: Record<string, number> = {};
    for (const p of Object.values(data?.result || {}) as any[]) {
      if (p.quote !== 'ZUSD' && p.quote !== 'USD') continue;
      if (String(p.altname || '').includes('.')) continue;
      const sym = KRAKEN_BASE_ALIASES[p.base] || p.base;
      const min = Number(p.ordermin);
      if (min > 0 && live[sym] == null) live[sym] = min;
    }
    if (live.BTC) live.XBT = live.BTC;
    if (live.DOGE) live.XDG = live.DOGE;
    if (live.POL) live.MATIC = live.POL;
    if (live.RENDER) live.RNDR = live.RENDER;
    cached = { ...FALLBACK_MIN_ORDER_SIZES, ...live };
    cachedAt = Date.now();
    return cached;
  } catch (_e) {
    return cached || FALLBACK_MIN_ORDER_SIZES;
  } finally {
    clearTimeout(timer);
  }
}