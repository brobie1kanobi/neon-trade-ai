/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NEON TRADE AI - KRAKEN API ARCHITECTURE DOCUMENTATION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This document defines the strict separation of concerns between REST and
 * WebSocket APIs when communicating with Kraken.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 
 * ## CORE PRINCIPLE
 * 
 * WebSocket = LIVE DATA (real-time streaming)
 * REST API = ACTIONS & SNAPSHOTS (one-time requests)
 * 
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 
 * ## WEBSOCKET API - REAL-TIME DATA ONLY
 * 
 * Use WebSocket for:
 * ✅ Real-time price updates (ticker channel)
 * ✅ Live balance changes (balances channel)
 * ✅ Order fill notifications (executions channel)
 * ✅ Order status updates (executions channel)
 * 
 * WebSocket endpoints:
 * - Public: wss://ws.kraken.com/v2 (prices, market data)
 * - Private: wss://ws-auth.kraken.com/v2 (balances, executions)
 * 
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 
 * ## REST API - ACTIONS & SNAPSHOTS ONLY
 * 
 * Use REST for:
 * ✅ Initial data load (one-time snapshot on app start)
 * ✅ Placing orders (AddOrder)
 * ✅ Canceling orders (CancelOrder)
 * ✅ Historical data (trades history, OHLC candles)
 * ✅ Recovery after WebSocket disconnect
 * ✅ Post-order verification
 * 
 * NEVER use REST for:
 * ❌ Polling live prices
 * ❌ Polling balance updates
 * ❌ Continuous data refresh while WebSocket is active
 * 
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 
 * ## DATA FLOW
 * 
 * 1. APP START
 *    └─> REST: Fetch initial snapshot (balance, open orders)
 *    └─> WebSocket: Connect and subscribe to channels
 *    └─> State: Populate from snapshot
 * 
 * 2. RUNNING (WebSocket Active)
 *    └─> WebSocket: Receive price updates → Update UI
 *    └─> WebSocket: Receive balance updates → Update UI
 *    └─> WebSocket: Receive order fills → Update UI
 *    └─> REST: NOT USED (WebSocket handles all live data)
 * 
 * 3. ORDER PLACEMENT
 *    └─> REST: Submit order (AddOrder)
 *    └─> WebSocket: Receive order status → Update UI
 *    └─> REST (optional): Verify order was accepted
 * 
 * 4. WEBSOCKET DISCONNECT
 *    └─> REST: Fall back to periodic polling (recovery mode)
 *    └─> WebSocket: Attempt reconnection
 *    └─> On reconnect: REST snapshot → Resume WebSocket updates
 * 
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 
 * ## HOOKS REFERENCE
 * 
 * useKrakenRealtime
 *   Purpose: Access WebSocket data (prices, balances, orders)
 *   Data source: WebSocket ONLY
 *   Never calls REST
 * 
 * useKrakenSnapshot
 *   Purpose: Initial load, recovery, post-action verification
 *   Data source: REST API ONLY
 *   Called once on mount, then on-demand
 * 
 * usePriceData
 *   LIVE mode: WebSocket prices (no REST polling)
 *   SIM mode: REST API with caching
 * 
 * useKrakenData
 *   DEPRECATED for live data
 *   Use for snapshot access only
 * 
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 
 * ## PROVIDER ARCHITECTURE
 * 
 * KrakenWebSocketProvider
 *   - Single source of truth for ALL Kraken data
 *   - Manages WebSocket connections
 *   - Fetches initial REST snapshot (one-time)
 *   - Updates state from WebSocket deltas
 *   - Provides data to all consuming components
 * 
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 
 * ## RATE LIMIT COMPLIANCE
 * 
 * By following this architecture:
 * - REST calls are minimized (initial + actions only)
 * - No duplicate API calls from multiple components
 * - WebSocket handles high-frequency updates
 * - Kraken rate limits (15 calls/3 sec) easily respected
 * 
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const KRAKEN_ARCHITECTURE = {
  websocket: {
    purpose: 'Real-time streaming data',
    channels: ['ticker', 'balances', 'executions'],
    use_for: ['live_prices', 'balance_updates', 'order_fills'],
    never_for: ['placing_orders', 'historical_data']
  },
  rest: {
    purpose: 'Actions and snapshots',
    use_for: ['initial_snapshot', 'place_orders', 'cancel_orders', 'history', 'recovery'],
    never_for: ['live_price_polling', 'balance_polling']
  },
  data_flow: {
    app_start: ['REST snapshot', 'WebSocket connect'],
    running: ['WebSocket only'],
    order_placement: ['REST submit', 'WebSocket track'],
    ws_disconnect: ['REST fallback', 'Reconnect attempt']
  }
};