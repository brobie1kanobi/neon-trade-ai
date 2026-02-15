// Core data fetching utilities with retry, caching, and rate limit handling

// Global cache for all data
const cache = new Map();

// Track in-flight requests to prevent duplicate fetches
const inflightRequests = new Map();

/**
 * Fetch with exponential backoff retry logic
 * Handles transient failures and rate limits gracefully
 */
export async function fetchWithRetry(fn, maxRetries = 5, initialDelay = 2000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        throw error;
      }
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const isRateLimit = error?.response?.status === 429 || 
                         error?.message?.includes('429') ||
                         error?.message?.includes('rate limit');
      
      const isTimeout = error?.message?.includes('timed out') ||
                       error?.message?.includes('timeout') ||
                       error?.code === 'ETIMEDOUT';
      
      // More aggressive delays for timeouts and rate limits
      let delay;
      if (isTimeout) {
        delay = initialDelay * Math.pow(2, attempt) * 2; // Double the backoff for timeouts
      } else if (isRateLimit) {
        delay = initialDelay * Math.pow(3, attempt); // Triple backoff for rate limits
      } else {
        delay = initialDelay * Math.pow(2, attempt);
      }
      
      console.log(`[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${delay}ms...`, error.message);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Get cached data or fetch with TTL support
 * Prevents duplicate requests and serves stale data on errors
 */
export async function getCached(key, fetchFn, ttl = 5 * 60 * 1000) {
  const now = Date.now();
  const localCacheKey = `nt_cache_${key}`;
  
  // Check memory cache first
  const cached = cache.get(key);
  if (cached && (now - cached.timestamp) < ttl) {
    return cached.data;
  }
  
  // Check localStorage cache for persistence across sessions
  try {
    const localCached = localStorage.getItem(localCacheKey);
    if (localCached) {
      const parsed = JSON.parse(localCached);
      if (parsed && (now - parsed.timestamp) < ttl) {
        // Update memory cache
        cache.set(key, parsed);
        return parsed.data;
      }
    }
  } catch (e) {
    // localStorage might be full or unavailable
  }
  
  // Check if there's already a request in flight for this key
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }
  
  // Start new fetch
  const fetchPromise = (async () => {
    try {
      const data = await fetchFn();
      const cacheEntry = { data, timestamp: now };
      
      // Update memory cache
      cache.set(key, cacheEntry);
      
      // Update localStorage cache
      try {
        localStorage.setItem(localCacheKey, JSON.stringify(cacheEntry));
      } catch (e) {
        // localStorage might be full - clean old entries
        try {
          const keys = Object.keys(localStorage);
          const ntKeys = keys.filter(k => k.startsWith('nt_cache_'));
          // Remove oldest half of cache entries
          ntKeys.slice(0, Math.floor(ntKeys.length / 2)).forEach(k => {
            try { localStorage.removeItem(k); } catch (_) {}
          });
          // Try again
          localStorage.setItem(localCacheKey, JSON.stringify(cacheEntry));
        } catch (_) {
          // Give up on localStorage
        }
      }
      
      return data;
    } catch (error) {
      console.error(`[getCached] Error fetching ${key}:`, error);
      
      // For financial data, never return stale cache – it causes wrong balance display
      const isFinancialKey = /wallet|holding|balance|kraken/i.test(key);
      
      if (!isFinancialKey) {
        // Non-financial: stale cache is acceptable fallback
        const staleCache = cache.get(key);
        if (staleCache) {
          console.log(`[getCached] Returning stale cache for ${key}`);
          return staleCache.data;
        }
        try {
          const localCached = localStorage.getItem(localCacheKey);
          if (localCached) {
            const parsed = JSON.parse(localCached);
            if (parsed?.data) return parsed.data;
          }
        } catch (_) {}
      }
      
      throw error;
    } finally {
      inflightRequests.delete(key);
    }
  })();
  
  inflightRequests.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Invalidate cached data by key or all if no key provided
 */
export function invalidateCache(key = null) {
  if (key) {
    cache.delete(key);
    try {
      localStorage.removeItem(`nt_cache_${key}`);
    } catch (_) {}
  } else {
    cache.clear();
    // Clear all nt_cache_ entries from localStorage
    try {
      const keys = Object.keys(localStorage);
      keys.filter(k => k.startsWith('nt_cache_')).forEach(k => {
        try { localStorage.removeItem(k); } catch (_) {}
      });
    } catch (_) {}
  }
}

/**
 * Debounce function calls
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function calls
 */
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}