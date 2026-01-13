/**
 * Transaction Tracker
 * Tracks all user transactions across the platform for display in Recent Transactions
 */

export interface TrackedTransaction {
  hash: string;
  type: 'swap' | 'deposit' | 'withdraw' | 'approve' | 'transfer' | 'hedge' | 'portfolio' | 'unknown';
  status: 'success' | 'pending' | 'failed';
  timestamp: number;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  amountIn?: string;
  amountOut?: string;
  tokenIn?: string;
  tokenOut?: string;
  description?: string;
  blockNumber?: number;
}

const STORAGE_KEY = 'recent-transactions';
const MAX_STORED_TXS = 100;

/**
 * Track a new transaction
 */
export function trackTransaction(tx: TrackedTransaction): void {
  try {
    const existing = getTrackedTransactions();
    
    // Check if transaction already exists
    const existingIndex = existing.findIndex(t => t.hash === tx.hash);
    if (existingIndex >= 0) {
      // Update existing transaction (useful for status changes)
      existing[existingIndex] = { ...existing[existingIndex], ...tx };
    } else {
      // Add new transaction
      existing.unshift(tx); // Add to beginning (most recent first)
    }
    
    // Keep only recent transactions
    const trimmed = existing.slice(0, MAX_STORED_TXS);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    
    // Trigger storage event for other tabs/components
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: JSON.stringify(trimmed),
      storageArea: localStorage,
    }));
    
    console.log('[TxTracker] Tracked transaction:', tx.hash, tx.type);
  } catch (error) {
    console.error('[TxTracker] Failed to track transaction:', error);
  }
}

/**
 * Get all tracked transactions
 */
export function getTrackedTransactions(): TrackedTransaction[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const txs = JSON.parse(stored) as TrackedTransaction[];
    return Array.isArray(txs) ? txs : [];
  } catch (error) {
    console.error('[TxTracker] Failed to read transactions:', error);
    return [];
  }
}

/**
 * Update transaction status (e.g., pending -> success)
 */
export function updateTransactionStatus(
  hash: string,
  status: TrackedTransaction['status'],
  blockNumber?: number
): void {
  try {
    const existing = getTrackedTransactions();
    const index = existing.findIndex(t => t.hash === hash);
    
    if (index >= 0) {
      existing[index].status = status;
      if (blockNumber) existing[index].blockNumber = blockNumber;
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      
      console.log('[TxTracker] Updated transaction status:', hash, status);
    }
  } catch (error) {
    console.error('[TxTracker] Failed to update transaction:', error);
  }
}

/**
 * Clear all tracked transactions
 */
export function clearTrackedTransactions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[TxTracker] Cleared all transactions');
  } catch (error) {
    console.error('[TxTracker] Failed to clear transactions:', error);
  }
}

/**
 * Helper to track a pending transaction
 */
export function trackPendingTransaction(params: {
  hash: string;
  type: TrackedTransaction['type'];
  from: string;
  to: string;
  value?: string;
  tokenSymbol?: string;
  description?: string;
}): void {
  trackTransaction({
    ...params,
    value: params.value || '0',
    status: 'pending',
    timestamp: Date.now(),
  });
}

/**
 * Helper to track a successful transaction
 */
export function trackSuccessfulTransaction(params: {
  hash: string;
  type: TrackedTransaction['type'];
  from: string;
  to: string;
  value?: string;
  tokenSymbol?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  amountOut?: string;
  description?: string;
  blockNumber?: number;
}): void {
  trackTransaction({
    ...params,
    value: params.value || '0',
    status: 'success',
    timestamp: Date.now(),
  });
}
