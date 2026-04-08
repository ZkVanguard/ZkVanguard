/**
 * WDK Provider Cache
 *
 * Shared provider pool with TTL eviction for ethers.js JsonRpcProviders.
 * Both wdk-context (browser wallet operations) and wdk-hooks (read-only
 * contract calls) use this single cache to avoid duplicate connections
 * and the memory leak of unbounded provider creation.
 */

import { ethers } from 'ethers';
import { WDK_CHAINS } from '@/lib/config/wdk';

const PROVIDER_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PROVIDERS = 20;

interface CachedProvider {
  provider: ethers.JsonRpcProvider;
  createdAt: number;
}

const _cache = new Map<string, CachedProvider>();

function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (now - entry.createdAt > PROVIDER_TTL_MS) {
      entry.provider.destroy();
      _cache.delete(key);
    }
  }
}

/**
 * Return a cached JsonRpcProvider for the given WDK chain key.
 * Creates one if it doesn't exist or has expired. Uses staticNetwork
 * to skip ethers.js automatic network detection (avoids retry storms).
 */
export function getCachedProvider(chainKey: string): ethers.JsonRpcProvider | null {
  const config = WDK_CHAINS[chainKey];
  if (!config) return null;

  const existing = _cache.get(chainKey);
  if (existing && Date.now() - existing.createdAt < PROVIDER_TTL_MS) {
    return existing.provider;
  }

  // Evict stale entries before adding a new one
  evictStale();
  if (_cache.size >= MAX_PROVIDERS) {
    // Drop the oldest entry
    const oldest = _cache.keys().next().value;
    if (oldest) {
      _cache.get(oldest)?.provider.destroy();
      _cache.delete(oldest);
    }
  }

  const network = new ethers.Network(config.name, config.chainId);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, network, {
    staticNetwork: network,
    batchMaxCount: 1,
  });

  _cache.set(chainKey, { provider, createdAt: Date.now() });
  return provider;
}

/**
 * Async variant that lazy-imports ethers.js (for use in client context
 * where tree-shaking matters).
 */
export async function getProviderAsync(chainKey: string): Promise<ethers.JsonRpcProvider | null> {
  return getCachedProvider(chainKey);
}

/** Drop all cached providers (for use in tests / reset). */
export function clearProviderCache(): void {
  for (const entry of _cache.values()) entry.provider.destroy();
  _cache.clear();
}
