/**
 * Request Deduplication Utility
 * 
 * Prevents duplicate API requests by caching in-flight requests.
 * If the same request is made while one is pending, returns the same promise.
 */

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

class RequestDeduplicator {
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private requestTimeout = 30000; // 30s timeout for pending requests

  /**
   * Execute a request with deduplication
   * @param key Unique identifier for the request
   * @param fetcher Function that performs the actual request
   * @returns Promise that resolves to the request result
   */
  async dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const pending = this.pendingRequests.get(key);

    // Return existing promise if request is still pending and not timed out
    if (pending && (now - pending.timestamp) < this.requestTimeout) {
      console.log(`⚡ [Deduper] Reusing pending request for: ${key}`);
      return pending.promise;
    }

    // Create new request
    console.log(`🔄 [Deduper] Creating new request for: ${key}`);
    const promise = fetcher()
      .then((result) => {
        // Clean up after success
        this.pendingRequests.delete(key);
        return result;
      })
      .catch((error) => {
        // Clean up after error
        this.pendingRequests.delete(key);
        throw error;
      });

    // Store pending request
    this.pendingRequests.set(key, {
      promise,
      timestamp: now,
    });

    return promise;
  }

  /**
   * Clear a specific pending request
   */
  clear(key: string): void {
    this.pendingRequests.delete(key);
  }

  /**
   * Clear all pending requests
   */
  clearAll(): void {
    this.pendingRequests.clear();
  }

  /**
   * Get stats about pending requests
   */
  getStats(): { pending: number; keys: string[] } {
    return {
      pending: this.pendingRequests.size,
      keys: Array.from(this.pendingRequests.keys()),
    };
  }
}

// Global singleton instance
const deduplicator = new RequestDeduplicator();

/**
 * Wrapper for fetch with automatic deduplication
 */
export async function dedupedFetch(url: string, options?: RequestInit): Promise<Response> {
  const key = `${options?.method || 'GET'}:${url}`;
  return deduplicator.dedupe(key, () => fetch(url, options));
}

/**
 * Generic deduplication helper
 */
export function withDeduplication<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  return deduplicator.dedupe(key, fetcher);
}

export { deduplicator };
