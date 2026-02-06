/* eslint-disable no-console */
/**
 * Transaction Cache Utility
 * Store and retrieve transactions from localStorage for persistent history
 */

export interface CachedTransaction {
  hash: string;
  type: 'swap' | 'deposit' | 'withdraw' | 'approve' | 'rebalance' | 'gasless' | 'unknown';
  status: 'pending' | 'success' | 'failed';
  timestamp: number;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  gasUsed?: string;
  blockNumber?: number;
  description?: string;
}

const CACHE_KEY = 'recent-transactions';
const MAX_CACHED_TXS = 50;

/**
 * Add a transaction to the cache
 */
export function addTransactionToCache(tx: CachedTransaction): void {
  try {
    const cached = getTransactionsFromCache();
    
    // Check if already exists
    const existingIndex = cached.findIndex(t => t.hash === tx.hash);
    if (existingIndex >= 0) {
      // Update existing transaction
      cached[existingIndex] = { ...cached[existingIndex], ...tx };
    } else {
      // Add new transaction
      cached.unshift(tx);
    }
    
    // Keep only recent transactions
    const trimmed = cached.slice(0, MAX_CACHED_TXS);
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
    console.log(`📝 Cached transaction: ${tx.hash} (${tx.type})`);
  } catch (e) {
    console.error('Failed to cache transaction:', e);
  }
}

/**
 * Get all cached transactions
 */
export function getTransactionsFromCache(): CachedTransaction[] {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return [];
    
    return JSON.parse(cached);
  } catch (e) {
    console.error('Failed to read transaction cache:', e);
    return [];
  }
}

/**
 * Update transaction status (e.g., pending -> success)
 */
export function updateTransactionStatus(
  hash: string,
  status: 'pending' | 'success' | 'failed',
  additionalData?: Partial<CachedTransaction>
): void {
  try {
    const cached = getTransactionsFromCache();
    const index = cached.findIndex(t => t.hash === hash);
    
    if (index >= 0) {
      cached[index] = {
        ...cached[index],
        status,
        ...additionalData,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
      console.log(`✅ Updated transaction ${hash}: ${status}`);
    }
  } catch (e) {
    console.error('Failed to update transaction status:', e);
  }
}

/**
 * Clear old transactions (older than 30 days)
 */
export function clearOldTransactions(): void {
  try {
    const cached = getTransactionsFromCache();
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    const filtered = cached.filter(tx => tx.timestamp > thirtyDaysAgo);
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(filtered));
    console.log(`🧹 Cleared ${cached.length - filtered.length} old transactions`);
  } catch (e) {
    console.error('Failed to clear old transactions:', e);
  }
}
