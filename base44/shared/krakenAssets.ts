/**
 * Centralized Kraken asset symbol parsing — shared by every function that
 * reads Kraken balances/trades so normalization (XXBT -> BTC, XDG -> DOGE, etc.)
 * and USD trading pairs stay identical everywhere instead of drifting between
 * copy-pasted versions.
 */

const ASSET_MAP = {
  'XXBT': 'BTC', 'XBT': 'BTC',
  'XETH': 'ETH', 'ETH': 'ETH', 'ETH2': 'ETH',
  'XXRP': 'XRP', 'XRP': 'XRP',
  'XXLM': 'XLM', 'XLM': 'XLM',
  'XLTC': 'LTC', 'LTC': 'LTC',
  'XDG': 'DOGE', 'XXDG': 'DOGE', 'DOGE': 'DOGE',
  'ZUSD': 'USD', 'USD': 'USD',
  'SOL': 'SOL', 'ADA': 'ADA', 'DOT': 'DOT',
  'LINK': 'LINK', 'AVAX': 'AVAX', 'ATOM': 'ATOM',
  'UNI': 'UNI', 'MATIC': 'MATIC', 'BCH': 'BCH',
  'TRX': 'TRX', 'PEPE': 'PEPE', 'SHIB': 'SHIB',
  'NEAR': 'NEAR', 'ALGO': 'ALGO', 'ICP': 'ICP',
  'SUI': 'SUI', 'HBAR': 'HBAR', 'TRUMP': 'TRUMP',
  'BONK': 'BONK', 'FLOKI': 'FLOKI', 'BABY': 'BABY',
  'BNB': 'BNB', 'USDT': 'USDT', 'USDC': 'USDC',
};

const PAIR_MAP = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', XRP: 'XXRPZUSD', LTC: 'XLTCZUSD', SOL: 'SOLUSD', ADA: 'ADAUSD',
  DOT: 'DOTUSD', DOGE: 'XDGUSD', LINK: 'LINKUSD', UNI: 'UNIUSD', MATIC: 'MATICUSD', ATOM: 'ATOMUSD',
  AVAX: 'AVAXUSD', BCH: 'BCHUSD', TRX: 'TRXUSD', PEPE: 'PEPEUSD', XLM: 'XXLMZUSD',
  SHIB: 'SHIBUSD', NEAR: 'NEARUSD', ALGO: 'ALGOUSD', ICP: 'ICPUSD', FIL: 'FILUSD',
  SAND: 'SANDUSD', MANA: 'MANAUSD', APE: 'APEUSD', OP: 'OPUSD', ARB: 'ARBUSD',
  INJ: 'INJUSD', SUI: 'SUIUSD', TAO: 'TAOUSD', WIF: 'WIFUSD', FLOKI: 'FLOKIUSD',
  BONK: 'BONKUSD', BABY: 'BABYUSD', HBAR: 'HBARUSD', TRUMP: 'TRUMPUSD',
};

/**
 * Normalize a raw Kraken asset code (e.g. XXBT, XDG, ZUSD) to its standard
 * ticker symbol (BTC, DOGE, USD). Strips staking/reward suffixes like ".S".
 */
export function parseKrakenAsset(krakenCode) {
  const code = String(krakenCode || '').toUpperCase();
  const cleaned = code.replace(/\.\w+$/, '');
  if (ASSET_MAP[cleaned]) return ASSET_MAP[cleaned];
  let symbol = cleaned;
  if (symbol.startsWith('Z') && symbol.length >= 4) symbol = symbol.substring(1);
  if (symbol.startsWith('X') && symbol.length >= 4) symbol = symbol.substring(1);
  if (ASSET_MAP[symbol]) return ASSET_MAP[symbol];
  return symbol;
}

/** True if the raw Kraken asset key is a staking/opt-in-reward position (e.g. "ETH.S"). */
export function isStakingAsset(krakenCode) {
  return /\.[A-Za-z]+$/.test(String(krakenCode || ''));
}

/** Standard Kraken USD trading pair for a normalized symbol (e.g. BTC -> XXBTZUSD). */
export function knownPair(symbol) {
  const sym = String(symbol || '').toUpperCase();
  return PAIR_MAP[sym] || `${sym}USD`;
}

/** Extract the normalized base asset from a Kraken trade pair (e.g. XXBTZUSD -> BTC). */
export function extractBaseAsset(pair) {
  const cleaned = String(pair || '')
    .toUpperCase()
    .replace(/\/USD$|ZUSD$|USD$|EUR$|GBP$/g, '');
  return parseKrakenAsset(cleaned);
}