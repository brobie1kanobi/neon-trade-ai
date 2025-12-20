/**
 * KRAKEN TRADING SYSTEM - FULL DIAGNOSTIC REPORT
 * Generated: Dec 20, 2024
 * Updated: Dec 20, 2024 - Added full trailing stop support
 * 
 * ============================================================
 * KRAKEN PRO ORDER FORM ANALYSIS (from screenshots)
 * ============================================================
 * 
 * SUPPORTED ORDER TYPES:
 * 1. Limit - Execute at specific price or better
 * 2. Market - Execute immediately at best available price  
 * 3. Stop Loss - Market order triggered when price drops to level
 * 4. Stop Loss Limit - Limit order triggered when price drops
 * 5. Take Profit - Market order triggered when price rises to level
 * 6. Take Profit Limit - Limit order triggered when price rises
 * 7. Iceberg - Large order split into smaller visible portions
 * 8. Trailing Stop - Market order triggered when price reverts from peak
 * 9. Trailing Stop Limit - Limit order triggered when price reverts
 * 
 * KEY FEATURES FROM SCREENSHOTS:
 * - TP/SL (Take Profit/Stop Loss) can be attached to BUY orders
 * - Entry distance shown as percentage (e.g., +3% TP, -1% SL)
 * - Trigger signal can be "Index" or "Last" price
 * - Time in force: GTC (Good till canceled)
 * - Post only option for limit orders
 * - Margin (10x) toggle available
 * 
 * ============================================================
 * CURRENT IMPLEMENTATION STATUS
 * ============================================================
 * 
 * ✅ WORKING:
 * - WebSocket v2 connection and authentication
 * - Market orders (immediate execution)
 * - Limit orders (price specified)
 * - Stop-loss orders (trigger-based sell)
 * - Take-profit orders (trigger-based sell)
 * - Cancel orders
 * - Bracket orders (TP + SL placed sequentially)
 * 
 * ⚠️ NEEDS IMPROVEMENT:
 * - OTO orders (One-Triggers-Other) - Kraken supports attaching TP/SL
 *   to the INITIAL buy order via "conditional" parameter
 * - This means we can place a single BUY order that automatically
 *   creates TP and SL when the buy fills!
 * 
 * ✅ NOW FULLY IMPLEMENTED:
 * - Stop-loss-limit orders
 * - Take-profit-limit orders  
 * - Trailing-stop orders (with pct or quote offset)
 * - Trailing-stop-limit orders (with configurable limit offset)
 * - Iceberg orders
 * - Percentage-based triggers (price_type: 'pct')
 * - Quote offset triggers (price_type: 'quote')
 * - Trigger reference selection ('last' or 'index')
 * 
 * ============================================================
 * KRAKEN API PARAMETER MAPPING
 * ============================================================
 * 
 * For OTO (One-Triggers-Other) orders via WebSocket v2:
 * 
 * {
 *   "method": "add_order",
 *   "params": {
 *     "order_type": "limit",        // or "market"
 *     "side": "buy",
 *     "order_qty": 0.00005,
 *     "symbol": "BTC/USD",
 *     "limit_price": 88315.8,       // Entry price
 *     "time_in_force": "gtc",
 *     
 *     // THIS IS THE KEY - conditional close orders!
 *     "conditional": {
 *       "order_type": "take-profit",   // or "stop-loss"
 *       "trigger_price": 90965.3,       // +3% from entry
 *       "trigger_price_type": "static"
 *     }
 *   }
 * }
 * 
 * IMPORTANT: Kraken's "conditional" only supports ONE close order.
 * For both TP AND SL, we need to:
 * 1. Place the buy order first
 * 2. After fill, place separate TP and SL sell orders
 * 
 * OR use REST API which supports close[ordertype] and close[price]
 * 
 * ============================================================
 * ISSUES FOUND & FIXES NEEDED
 * ============================================================
 * 
 * ISSUE 1: OTO Not Implemented
 * - Current: We place buy, then separately place TP/SL
 * - Better: Use Kraken's conditional parameter for cleaner execution
 * - Note: Conditional only supports 1 close order, not both TP+SL
 * 
 * ISSUE 2: Percentage-Based Triggers
 * - Current: Only static prices supported
 * - Need: Support price_type: "pct" for relative triggers
 * - Example: TP at +3%, SL at -1% from entry
 * 
 * ISSUE 3: Bracket Order Timing
 * - Current: 4 second delay between TP and SL orders
 * - Risk: Position could move significantly in that time
 * - Solution: Use parallel WebSocket connections
 * 
 * ISSUE 4: Order Monitoring
 * - Current: ConditionalOrder entity tracks orders
 * - Need: Better sync with Kraken's actual order status
 * - Solution: Poll open orders and sync state
 * 
 * ============================================================
 * RECOMMENDED TRADING FLOW
 * ============================================================
 * 
 * For AutoTrader prospects:
 * 
 * 1. User configures assets in Portfolio (AutoBuyPreference)
 *    - Symbol, allocation %, enabled status
 *    
 * 2. AI analyzes market conditions (getAutoTraderProspects)
 *    - Fetches current prices
 *    - Runs AI analysis for buy signals
 *    - Calculates optimal entry, TP, SL levels
 *    
 * 3. When confidence is high, execute trade:
 *    a. Place LIMIT BUY order at entry price
 *    b. After buy fills, place TP + SL bracket orders
 *    c. Create ConditionalOrder record for tracking
 *    
 * 4. Monitor positions:
 *    - When TP hits → Cancel SL, record profit
 *    - When SL hits → Cancel TP, record loss
 *    - Trailing stop updates highest price seen
 * 
 * ============================================================
 * API PARAMETERS REFERENCE
 * ============================================================
 * 
 * Required for all orders:
 * - order_type: "market" | "limit" | "stop-loss" | etc.
 * - side: "buy" | "sell"
 * - order_qty: number (quantity in base asset)
 * - symbol: "BTC/USD" | "ETH/USD" | etc.
 * 
 * For limit orders:
 * - limit_price: number (USD price)
 * - time_in_force: "gtc" | "ioc" | "gtd"
 * - post_only: boolean (maker only)
 * 
 * For triggered orders (stop-loss, take-profit):
 * - triggers.reference: "last" | "index"
 * - triggers.price: number (trigger price)
 * - triggers.price_type: "static" | "pct" | "quote"
 * 
 * For trailing stops:
 * - triggers.price: number (reversion amount)
 * - triggers.price_type: "pct" (e.g., 5 = 5%) or "quote" (e.g., 100 = $100)
 * 
 * For conditional/OTO:
 * - conditional.order_type: "take-profit" | "stop-loss" | etc.
 * - conditional.trigger_price: number
 * - conditional.trigger_price_type: "static" | "pct"
 * - conditional.limit_price: number (if limit type)
 * 
 * ============================================================
 */

export const KRAKEN_ORDER_TYPES = {
  MARKET: 'market',
  LIMIT: 'limit',
  STOP_LOSS: 'stop-loss',
  STOP_LOSS_LIMIT: 'stop-loss-limit',
  TAKE_PROFIT: 'take-profit',
  TAKE_PROFIT_LIMIT: 'take-profit-limit',
  TRAILING_STOP: 'trailing-stop',
  TRAILING_STOP_LIMIT: 'trailing-stop-limit',
  ICEBERG: 'iceberg'
};

export const KRAKEN_TIME_IN_FORCE = {
  GTC: 'gtc',  // Good till canceled
  IOC: 'ioc',  // Immediate or cancel
  GTD: 'gtd'   // Good till date
};

export const KRAKEN_TRIGGER_REFERENCE = {
  LAST: 'last',   // Last traded price
  INDEX: 'index'  // Index price from broader market
};

export const KRAKEN_PRICE_TYPE = {
  STATIC: 'static',  // Absolute USD price
  PCT: 'pct',        // Percentage from reference
  QUOTE: 'quote'     // Notional offset in quote currency
};

// Minimum order sizes (updated Dec 2024)
export const MIN_ORDER_SIZES = {
  'BTC': 0.0001,
  'ETH': 0.005,
  'SOL': 0.1,
  'XRP': 10.0,
  'XLM': 20.0,
  'ADA': 10.0,
  'DOT': 0.5,
  'DOGE': 50.0,
  'LINK': 0.5,
  'AVAX': 0.1,
  'LTC': 0.04
};

export default function KrakenTradingDiagnostics() {
  return (
    <div className="p-4 bg-gray-900 text-gray-100 rounded-lg">
      <h2 className="text-xl font-bold text-green-400 mb-4">
        Kraken Trading System Diagnostics
      </h2>
      <p className="text-sm text-gray-400">
        See source code for full documentation.
      </p>
    </div>
  );
}