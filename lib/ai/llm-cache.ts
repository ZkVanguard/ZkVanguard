/**
 * LLM Response Cache — reduces redundant AI calls for similar queries.
 *
 * Storage layer is the shared CacheManager in lib/utils/cache — this file
 * only owns the LLM-specific concerns: prompt hashing (deterministic key
 * generation) and the skip-list keywords that mark a query as too
 * time-sensitive to cache.
 */

import { cache } from '../utils/cache';
import type { LLMResponse } from './llm-types';

const LLM_CACHE_TTL = 120_000; // 2 min

// Queries containing these words request fresh data or trigger side effects —
// never serve a cached answer for them.
const NO_CACHE_KEYWORDS = [
  'execute', 'swap', 'trade', 'buy', 'sell', 'deposit', 'withdraw',
  'rebalance', 'current', 'now', 'latest', 'live', 'real-time',
];

export function hashPrompt(message: string): string {
  // djb2 — deterministic key derivation only, not a security hash.
  // Changing the algorithm would invalidate every warm cache entry across
  // running instances, so it's frozen.
  let hash = 0;
  const normalized = message.toLowerCase().trim().replace(/\s+/g, ' ');
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(16);
}

export function shouldCacheQuery(message: string): boolean {
  const lower = message.toLowerCase();
  return !NO_CACHE_KEYWORDS.some(keyword => lower.includes(keyword));
}

export function getCachedLLMResponse(promptHash: string): LLMResponse | null {
  return cache.get<LLMResponse>(`llm:${promptHash}`, LLM_CACHE_TTL);
}

export function setCachedLLMResponse(promptHash: string, response: LLMResponse): void {
  cache.set(`llm:${promptHash}`, response, LLM_CACHE_TTL);
}
