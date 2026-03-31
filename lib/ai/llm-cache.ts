/**
 * LLM Response Cache - Reduces redundant AI calls for similar queries
 */

import { logger } from '../utils/logger';
import type { LLMResponse } from './llm-types';

interface CachedLLMResponse {
  response: LLMResponse;
  timestamp: number;
  promptHash: string;
}

const LLM_CACHE_TTL = 120000; // 2 minutes TTL for LLM responses
const llmResponseCache = new Map<string, CachedLLMResponse>();

// Keywords that indicate the query should NOT be cached (requires fresh data)
const NO_CACHE_KEYWORDS = [
  'execute', 'swap', 'trade', 'buy', 'sell', 'deposit', 'withdraw',
  'rebalance', 'current', 'now', 'latest', 'live', 'real-time'
];

export function hashPrompt(message: string): string {
  // Simple hash function for prompt comparison
  let hash = 0;
  const normalized = message.toLowerCase().trim().replace(/\s+/g, ' ');
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

export function shouldCacheQuery(message: string): boolean {
  const lower = message.toLowerCase();
  // Don't cache queries that request realtime data or execute actions
  return !NO_CACHE_KEYWORDS.some(keyword => lower.includes(keyword));
}

export function getCachedLLMResponse(promptHash: string): LLMResponse | null {
  const cached = llmResponseCache.get(promptHash);
  if (!cached) return null;
  
  // Check if expired
  if (Date.now() - cached.timestamp > LLM_CACHE_TTL) {
    llmResponseCache.delete(promptHash);
    return null;
  }
  
  logger.debug(`[LLM] Cache HIT for prompt (age: ${Date.now() - cached.timestamp}ms)`);
  return cached.response;
}

export function setCachedLLMResponse(promptHash: string, response: LLMResponse): void {
  llmResponseCache.set(promptHash, {
    response,
    timestamp: Date.now(),
    promptHash,
  });
  
  // Cleanup: limit cache size to prevent memory leaks
  if (llmResponseCache.size > 50) {
    const oldestKey = llmResponseCache.keys().next().value;
    if (oldestKey) llmResponseCache.delete(oldestKey);
  }
}

// Periodic cache cleanup (every 5 minutes)
let _cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;
if (typeof setInterval !== 'undefined') {
  _cacheCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of llmResponseCache.entries()) {
      if (now - entry.timestamp > LLM_CACHE_TTL) {
        llmResponseCache.delete(key);
      }
    }
  }, 300000);
  // Allow Node.js to exit even if timer is running
  if (_cacheCleanupTimer && typeof _cacheCleanupTimer.unref === 'function') {
    _cacheCleanupTimer.unref();
  }
}
