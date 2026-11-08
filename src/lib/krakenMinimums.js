// Kraken minimum order sizes (coin units), checked against Kraken on 2026-11-08.
// Keep in sync with base44/shared/krakenMinimums.ts (backend reads live values).
export const MIN_ORDER_SIZES = {
  BTC: 0.00006, XBT: 0.00006, ETH: 0.002, SOL: 0.05, XRP: 4, ADA: 20, DOT: 3.9,
  DOGE: 50, XDG: 50, LINK: 0.35, UNI: 0.7, POL: 60, MATIC: 60, ATOM: 3.5, AVAX: 0.5,
  BCH: 0.018, LTC: 0.08, TRX: 16, SHIB: 770000, XLM: 25, ALGO: 41, FIL: 6, NEAR: 1,
  APT: 8, ARB: 30, OP: 45, INJ: 0.7, PEPE: 1100000, SUI: 5, HBAR: 55, KAS: 170,
  TAO: 0.022, EIGEN: 30, ENA: 30, GRASS: 9, GOAT: 350, TRUMP: 3, FARTCOIN: 40,
  MOVE: 6, KAITO: 20, TIA: 11, FET: 18, JUP: 20, WIF: 30, BONK: 1800000,
  FLOKI: 220000, BABY: 400, RENDER: 2.5
};