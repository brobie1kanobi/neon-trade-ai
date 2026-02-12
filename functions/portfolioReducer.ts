import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * DETERMINISTIC PORTFOLIO REDUCER
 * 
 * Pure function that applies trade events to portfolio state.
 * This is the SINGLE SOURCE OF TRUTH for all portfolio calculations.
 * 
 * All financial calculations use fixed-point arithmetic (integers in cents/satoshis)
 * to prevent floating-point precision errors.
 * 
 * PRECISION CONSTANTS:
 * - USD: 2 decimals (cents) - multiply by 100
 * - Crypto: 8 decimals (satoshis) - multiply by 100000000
 */

// Precision constants
const USD_PRECISION = 2;
const CRYPTO_PRECISION = 8;
const USD_MULTIPLIER = Math.pow(10, USD_PRECISION);
const CRYPTO_MULTIPLIER = Math.pow(10, CRYPTO_PRECISION);

/**
 * Convert float to fixed-point integer
 */
function toFixed(value, precision) {
  const multiplier = Math.pow(10, precision);
  return Math.round(value * multiplier);
}

/**
 * Convert fixed-point integer back to float
 */
function fromFixed(value, precision) {
  const multiplier = Math.pow(10, precision);
  return value / multiplier;
}

/**
 * Safe USD arithmetic (2 decimal places)
 */
function usdAdd(a, b) {
  return fromFixed(toFixed(a, USD_PRECISION) + toFixed(b, USD_PRECISION), USD_PRECISION);
}

function usdSubtract(a, b) {
  return fromFixed(toFixed(a, USD_PRECISION) - toFixed(b, USD_PRECISION), USD_PRECISION);
}

function usdMultiply(a, b) {
  // For multiplication, we need to handle precision carefully
  const result = toFixed(a, USD_PRECISION) * toFixed(b, USD_PRECISION);
  return fromFixed(result, USD_PRECISION * 2);
}

/**
 * Safe crypto arithmetic (8 decimal places)
 */
function cryptoAdd(a, b) {
  return fromFixed(toFixed(a, CRYPTO_PRECISION) + toFixed(b, CRYPTO_PRECISION), CRYPTO_PRECISION);
}

function cryptoSubtract(a, b) {
  return fromFixed(toFixed(a, CRYPTO_PRECISION) - toFixed(b, CRYPTO_PRECISION), CRYPTO_PRECISION);
}

/**
 * Round to specific precision
 */
function roundTo(value, precision) {
  return fromFixed(toFixed(value, precision), precision);
}

/**
 * Calculate weighted average cost
 * Formula: (oldQty * oldAvgCost + newQty * newPrice) / (oldQty + newQty)
 */
function calculateWeightedAvgCost(oldQty, oldAvgCost, newQty, newPrice) {
  if (oldQty + newQty <= 0) return 0;
  
  const oldTotal = toFixed(oldQty, CRYPTO_PRECISION) * toFixed(oldAvgCost, USD_PRECISION);
  const newTotal = toFixed(newQty, CRYPTO_PRECISION) * toFixed(newPrice, USD_PRECISION);
  const totalQty = toFixed(oldQty, CRYPTO_PRECISION) + toFixed(newQty, CRYPTO_PRECISION);
  
  if (totalQty === 0) return 0;
  
  // Result in USD precision
  return fromFixed(Math.round((oldTotal + newTotal) / totalQty), USD_PRECISION);
}

/**
 * CORE REDUCER: Apply a single trade event to portfolio state
 * 
 * @param {Object} currentState - Current portfolio state
 * @param {Object} tradeEvent - Trade event to apply
 * @returns {Object} New portfolio state (immutable)
 */
function applyTradeEvent(currentState, tradeEvent) {
  // Validate inputs
  if (!tradeEvent || !tradeEvent.type || !tradeEvent.symbol) {
    throw new Error('Invalid trade event: missing required fields');
  }
  
  const {
    type,           // 'buy' or 'sell'
    symbol,
    quantity,
    price,
    total_value,
    fee = 0,
    is_simulation
  } = tradeEvent;
  
  // Deep clone current state to ensure immutability
  const newState = JSON.parse(JSON.stringify(currentState));
  
  // Initialize state structure if needed
  if (!newState.holdings) newState.holdings = {};
  if (!newState.wallet) newState.wallet = { cash_balance: 0, real_cash_balance: 0 };
  
  const cashKey = is_simulation ? 'cash_balance' : 'real_cash_balance';
  const currentCash = newState.wallet[cashKey] || 0;
  
  // Get or initialize holding
  const holdingKey = `${symbol}_${is_simulation ? 'sim' : 'live'}`;
  const currentHolding = newState.holdings[holdingKey] || {
    symbol,
    quantity: 0,
    average_cost_price: 0,
    is_simulation
  };
  
  if (type === 'buy') {
    // BUY: Increase holdings, decrease cash
    const newQuantity = cryptoAdd(currentHolding.quantity, quantity);
    const newAvgCost = calculateWeightedAvgCost(
      currentHolding.quantity,
      currentHolding.average_cost_price,
      quantity,
      price
    );
    
    // Calculate total cost including fees
    const totalCost = usdAdd(total_value, fee);
    const newCash = usdSubtract(currentCash, totalCost);
    
    // Validate: prevent negative cash
    if (newCash < 0) {
      throw new Error(`Insufficient funds: need $${totalCost.toFixed(2)}, have $${currentCash.toFixed(2)}`);
    }
    
    // Update state
    newState.holdings[holdingKey] = {
      ...currentHolding,
      quantity: newQuantity,
      average_cost_price: newAvgCost
    };
    newState.wallet[cashKey] = newCash;
    
  } else if (type === 'sell') {
    // SELL: Decrease holdings, increase cash
    const newQuantity = cryptoSubtract(currentHolding.quantity, quantity);
    
    // Validate: prevent negative holdings
    if (newQuantity < -0.00000001) {
      throw new Error(`Insufficient holdings: trying to sell ${quantity}, have ${currentHolding.quantity}`);
    }
    
    // Calculate net proceeds after fees
    const netProceeds = usdSubtract(total_value, fee);
    const newCash = usdAdd(currentCash, netProceeds);
    
    // Update state
    if (newQuantity <= 0.00000001) {
      // Position fully closed
      delete newState.holdings[holdingKey];
    } else {
      // Partial sell - keep same avg cost
      newState.holdings[holdingKey] = {
        ...currentHolding,
        quantity: roundTo(newQuantity, CRYPTO_PRECISION)
      };
    }
    newState.wallet[cashKey] = newCash;
  }
  
  return newState;
}

/**
 * Apply multiple trade events in sequence
 */
function applyTradeEvents(initialState, tradeEvents) {
  return tradeEvents.reduce((state, event) => applyTradeEvent(state, event), initialState);
}

/**
 * Generate ledger entry from trade event
 */
function generateLedgerEntry(tradeEvent, userId) {
  const {
    type,
    symbol,
    quantity,
    price,
    total_value,
    fee = 0,
    is_simulation,
    kraken_txid,
    idempotency_key
  } = tradeEvent;
  
  const entries = [];
  
  // Main trade entry
  entries.push({
    asset_symbol: symbol,
    entry_type: type === 'buy' ? 'trade_buy' : 'trade_sell',
    quantity_delta: type === 'buy' ? quantity : -quantity,
    cash_delta: type === 'buy' ? -total_value : total_value,
    unit_price: price,
    reference_type: 'trade',
    idempotency_key: `${idempotency_key}_trade`,
    kraken_txid,
    is_simulation,
    created_by: userId
  });
  
  // Fee entry if applicable
  if (fee > 0) {
    entries.push({
      asset_symbol: 'USD',
      entry_type: 'fee',
      quantity_delta: 0,
      cash_delta: -fee,
      unit_price: 1,
      reference_type: 'fee',
      idempotency_key: `${idempotency_key}_fee`,
      kraken_txid,
      is_simulation,
      created_by: userId
    });
  }
  
  return entries;
}

/**
 * Derive current portfolio state from ledger entries
 */
function deriveStateFromLedger(ledgerEntries, isSimulation) {
  const state = {
    holdings: {},
    wallet: {
      cash_balance: 0,
      real_cash_balance: 0
    }
  };
  
  const cashKey = isSimulation ? 'cash_balance' : 'real_cash_balance';
  
  for (const entry of ledgerEntries) {
    if (entry.is_simulation !== isSimulation) continue;
    
    // Update cash
    if (entry.cash_delta) {
      state.wallet[cashKey] = usdAdd(state.wallet[cashKey], entry.cash_delta);
    }
    
    // Update holdings (skip USD entries)
    if (entry.asset_symbol !== 'USD' && entry.quantity_delta) {
      const holdingKey = `${entry.asset_symbol}_${isSimulation ? 'sim' : 'live'}`;
      if (!state.holdings[holdingKey]) {
        state.holdings[holdingKey] = {
          symbol: entry.asset_symbol,
          quantity: 0,
          average_cost_price: 0,
          is_simulation: isSimulation
        };
      }
      
      const holding = state.holdings[holdingKey];
      
      if (entry.quantity_delta > 0) {
        // Buy - update avg cost
        const newAvgCost = calculateWeightedAvgCost(
          holding.quantity,
          holding.average_cost_price,
          entry.quantity_delta,
          entry.unit_price || 0
        );
        holding.quantity = cryptoAdd(holding.quantity, entry.quantity_delta);
        holding.average_cost_price = newAvgCost;
      } else {
        // Sell - reduce quantity
        holding.quantity = cryptoAdd(holding.quantity, entry.quantity_delta);
        if (holding.quantity <= 0.00000001) {
          delete state.holdings[holdingKey];
        }
      }
    }
  }
  
  return state;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json();
    const { action, payload } = body;
    
    switch (action) {
      case 'applyTradeEvent': {
        const { currentState, tradeEvent } = payload;
        const newState = applyTradeEvent(currentState, tradeEvent);
        return Response.json({ success: true, newState });
      }
      
      case 'applyTradeEvents': {
        const { initialState, tradeEvents } = payload;
        const finalState = applyTradeEvents(initialState, tradeEvents);
        return Response.json({ success: true, finalState });
      }
      
      case 'generateLedgerEntry': {
        const { tradeEvent } = payload;
        const entries = generateLedgerEntry(tradeEvent, user.email);
        return Response.json({ success: true, entries });
      }
      
      case 'deriveStateFromLedger': {
        const { isSimulation } = payload;
        
        // Fetch all ledger entries for user
        const ledgerEntries = await base44.entities.LedgerEntry.filter({
          created_by: user.email,
          is_simulation: isSimulation
        });
        
        const state = deriveStateFromLedger(ledgerEntries, isSimulation);
        return Response.json({ success: true, state });
      }
      
      case 'validateTrade': {
        const { currentState, tradeEvent } = payload;
        try {
          applyTradeEvent(currentState, tradeEvent);
          return Response.json({ success: true, valid: true });
        } catch (error) {
          return Response.json({ success: true, valid: false, reason: error.message });
        }
      }
      
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('[portfolioReducer] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});