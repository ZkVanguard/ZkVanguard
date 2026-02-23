/**
 * AI Decisions Service
 * =====================
 * Centralized service for ALL AI-powered decisions and recommendations.
 * This is the single source of truth for AI data across the entire application.
 * 
 * Architecture:
 * - All AI API calls go through this service
 * - Caching and deduplication handled here
 * - Events emitted for real-time sync across components
 * - Type-safe interfaces for all AI decision types
 */

import { logger } from '@/lib/utils/logger';
import { dedupedFetch } from '@/lib/utils/request-deduplication';

// ============================================================================
// Types - Unified AI Decision Types
// ============================================================================

/** Risk analysis from RiskAgent */
export interface RiskAnalysis {
  totalRisk: number;         // 0-100 risk score
  volatility: number;        // Portfolio volatility
  var95: number;             // Value at Risk (95% confidence)
  sharpeRatio: number;
  maxDrawdown: number;
  marketSentiment: 'bullish' | 'bearish' | 'neutral';
  recommendations: string[];
  analyzedAt: number;
}

/** Individual hedge recommendation */
export interface HedgeRecommendation {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  size?: number;
  reason: string;
  confidence: number;        // 0-100
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
  source: 'risk-agent' | 'hedging-agent' | 'ai-sdk' | 'prediction-market';
  generatedAt: number;
}

/** Token direction prediction */
export interface TokenDirection {
  symbol: string;
  direction: 'up' | 'down' | 'sideways';
  confidence: number;        // 0-100
  shortTake: string;         // Brief explanation
  priceTarget?: number;
  timeframe?: string;
}

/** Leverage recommendation */
export interface LeverageRecommendation {
  symbol: string;
  direction: 'long' | 'short' | 'neutral';
  leverage: string;          // e.g., "2x", "3x"
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
  rationale: string;
  confidence: number;
  allocation: number;        // % of portfolio
}

/** Market insight summary */
export interface InsightSummary {
  overview: string;
  riskAgent: string;
  hedgingAgent: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  tokenDirections: TokenDirection[];
  leverageRecommendations: LeverageRecommendation[];
  hedgeAlerts: number;
  leadAgentApproved: boolean;
  analyzedAt: number;
}

/** Portfolio action recommendation */
export interface PortfolioAction {
  action: 'BUY' | 'SELL' | 'HOLD' | 'HEDGE' | 'REBALANCE';
  confidence: number;
  reasoning: string;
  suggestedAssets?: string[];
  urgency: 'low' | 'medium' | 'high';
  estimatedImpact?: string;
}

/** Complete AI decisions state */
export interface AIDecisionsState {
  // Risk Analysis
  riskAnalysis: RiskAnalysis | null;
  riskLoading: boolean;
  riskError: string | null;
  riskLastUpdated: number;

  // Hedge Recommendations
  hedgeRecommendations: HedgeRecommendation[];
  hedgesLoading: boolean;
  hedgesError: string | null;
  hedgesLastUpdated: number;

  // Market Insights
  insightSummary: InsightSummary | null;
  insightsLoading: boolean;
  insightsError: string | null;
  insightsLastUpdated: number;

  // Portfolio Actions
  portfolioAction: PortfolioAction | null;
  actionLoading: boolean;
  actionError: string | null;
  actionLastUpdated: number;

  // Global state
  isInitialized: boolean;
  lastGlobalUpdate: number;
}

// ============================================================================
// Events - For cross-component synchronization
// ============================================================================

type AIEventType = 
  | 'ai:risk:updated'
  | 'ai:hedges:updated'
  | 'ai:insights:updated'
  | 'ai:action:updated'
  | 'ai:all:updated'
  | 'ai:cache:invalidated';

export interface AIEvent {
  type: AIEventType;
  timestamp: number;
  data?: unknown;
}

const eventListeners = new Map<AIEventType, Set<(event: AIEvent) => void>>();

function emitAIEvent(type: AIEventType, data?: unknown): void {
  const event: AIEvent = { type, timestamp: Date.now(), data };
  const listeners = eventListeners.get(type);
  if (listeners) {
    listeners.forEach(listener => {
      try {
        listener(event);
      } catch (e) {
        logger.error('AI event listener error', e instanceof Error ? e : undefined);
      }
    });
  }
  // Also emit to 'all' listeners
  if (type !== 'ai:all:updated') {
    emitAIEvent('ai:all:updated', data);
  }
}

export function onAIEvent(type: AIEventType, callback: (event: AIEvent) => void): () => void {
  if (!eventListeners.has(type)) {
    eventListeners.set(type, new Set());
  }
  eventListeners.get(type)!.add(callback);
  
  // Return unsubscribe function
  return () => {
    eventListeners.get(type)?.delete(callback);
  };
}

// ============================================================================
// Cache - Smart caching with TTL and invalidation
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hash: string;
}

const CACHE_TTL = {
  risk: 60000,      // 60 seconds
  hedges: 45000,    // 45 seconds
  insights: 60000,  // 60 seconds
  action: 30000,    // 30 seconds
};

const cache = {
  risk: null as CacheEntry<RiskAnalysis> | null,
  hedges: null as CacheEntry<HedgeRecommendation[]> | null,
  insights: null as CacheEntry<InsightSummary> | null,
  action: null as CacheEntry<PortfolioAction> | null,
};

function isCacheValid<T>(entry: CacheEntry<T> | null, ttl: number, currentHash?: string): boolean {
  if (!entry) return false;
  if (Date.now() - entry.timestamp > ttl) return false;
  if (currentHash && entry.hash !== currentHash) return false;
  return true;
}

function createHash(data: unknown): string {
  try {
    return JSON.stringify(data).substring(0, 100);
  } catch {
    return String(Date.now());
  }
}

// ============================================================================
// API Calls - Centralized fetch functions
// ============================================================================

export async function fetchRiskAnalysis(address: string, force = false): Promise<RiskAnalysis> {
  const hash = `risk-${address}`;
  
  if (!force && isCacheValid(cache.risk, CACHE_TTL.risk, hash)) {
    logger.debug('[AIDecisions] Using cached risk analysis');
    return cache.risk!.data;
  }

  logger.info('[AIDecisions] Fetching risk analysis', { address });
  
  try {
    const response = await dedupedFetch(`/api/agents/risk/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    
    const analysis: RiskAnalysis = {
      totalRisk: data.riskScore || data.totalRisk || 50,
      volatility: data.volatility || 0.25,
      var95: data.var95 || data.valueAtRisk || 0,
      sharpeRatio: data.sharpeRatio || 1.0,
      maxDrawdown: data.maxDrawdown || 0,
      marketSentiment: data.sentiment || data.marketSentiment || 'neutral',
      recommendations: data.recommendations || [],
      analyzedAt: Date.now(),
    };

    cache.risk = { data: analysis, timestamp: Date.now(), hash };
    emitAIEvent('ai:risk:updated', analysis);
    
    return analysis;
  } catch (error) {
    logger.error('[AIDecisions] Risk analysis failed', error instanceof Error ? error : undefined);
    throw error;
  }
}

export async function fetchHedgeRecommendations(
  address: string, 
  force = false
): Promise<HedgeRecommendation[]> {
  const hash = `hedges-${address}`;
  
  if (!force && isCacheValid(cache.hedges, CACHE_TTL.hedges, hash)) {
    logger.debug('[AIDecisions] Using cached hedge recommendations');
    return cache.hedges!.data;
  }

  logger.info('[AIDecisions] Fetching hedge recommendations', { address });
  
  try {
    const response = await dedupedFetch(`/api/agents/hedging/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, force }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    
    const recommendations: HedgeRecommendation[] = (data.recommendations || []).map((rec: {
      id?: string;
      asset?: string;
      symbol?: string;
      side?: string;
      direction?: string;
      leverage?: number;
      size?: number;
      reason?: string;
      description?: string;
      confidence?: number;
      entryPrice?: number;
      targetPrice?: number;
      stopLoss?: number;
      riskLevel?: string;
      agentSource?: string;
    }, idx: number) => ({
      id: rec.id || `rec-${Date.now()}-${idx}`,
      asset: rec.asset || rec.symbol || 'UNKNOWN',
      side: (rec.side || rec.direction?.toUpperCase() || 'SHORT') as 'LONG' | 'SHORT',
      leverage: rec.leverage || 1,
      size: rec.size,
      reason: rec.reason || rec.description || 'AI recommendation',
      confidence: rec.confidence || 75,
      entryPrice: rec.entryPrice,
      targetPrice: rec.targetPrice,
      stopLoss: rec.stopLoss,
      riskLevel: (rec.riskLevel || 'moderate') as 'conservative' | 'moderate' | 'aggressive',
      source: (rec.agentSource?.includes('Risk') ? 'risk-agent' : 'hedging-agent') as HedgeRecommendation['source'],
      generatedAt: Date.now(),
    }));

    cache.hedges = { data: recommendations, timestamp: Date.now(), hash };
    emitAIEvent('ai:hedges:updated', recommendations);
    
    return recommendations;
  } catch (error) {
    logger.error('[AIDecisions] Hedge recommendations failed', error instanceof Error ? error : undefined);
    throw error;
  }
}

export async function fetchInsightSummary(
  predictions: Array<{ id: string; probability: number; [key: string]: unknown }>,
  force = false
): Promise<InsightSummary> {
  const hash = createHash(predictions.slice(0, 5).map(p => `${p.id}:${p.probability}`));
  
  if (!force && isCacheValid(cache.insights, CACHE_TTL.insights, hash)) {
    logger.debug('[AIDecisions] Using cached insight summary');
    return cache.insights!.data;
  }

  logger.info('[AIDecisions] Fetching insight summary');
  
  try {
    const response = await fetch(`/api/agents/insight-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ predictions }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    
    const summary: InsightSummary = data.summary || {
      overview: 'Analysis unavailable',
      riskAgent: '',
      hedgingAgent: '',
      sentiment: 'neutral',
      tokenDirections: [],
      leverageRecommendations: [],
      hedgeAlerts: 0,
      leadAgentApproved: false,
      analyzedAt: Date.now(),
    };

    cache.insights = { data: summary, timestamp: Date.now(), hash };
    emitAIEvent('ai:insights:updated', summary);
    
    return summary;
  } catch (error) {
    logger.error('[AIDecisions] Insight summary failed', error instanceof Error ? error : undefined);
    throw error;
  }
}

export async function fetchPortfolioAction(
  address: string,
  portfolioData: { totalValue: number; positions: unknown[] },
  force = false
): Promise<PortfolioAction> {
  const hash = `action-${address}-${portfolioData.totalValue}`;
  
  if (!force && isCacheValid(cache.action, CACHE_TTL.action, hash)) {
    logger.debug('[AIDecisions] Using cached portfolio action');
    return cache.action!.data;
  }

  logger.info('[AIDecisions] Fetching portfolio action');
  
  try {
    const response = await dedupedFetch(`/api/agents/portfolio-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        address, 
        portfolioId: 1,
        currentValue: portfolioData.totalValue,
        assets: portfolioData.positions,
      }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    
    const action: PortfolioAction = {
      action: data.recommendation || data.action?.type || 'HOLD',
      confidence: data.confidence || 75,
      reasoning: data.reasoning || data.rationale || 'AI analysis complete',
      suggestedAssets: data.suggestedAssets || data.assets,
      urgency: data.urgency || 'medium',
      estimatedImpact: data.estimatedImpact,
    };

    cache.action = { data: action, timestamp: Date.now(), hash };
    emitAIEvent('ai:action:updated', action);
    
    return action;
  } catch (error) {
    logger.error('[AIDecisions] Portfolio action failed', error instanceof Error ? error : undefined);
    throw error;
  }
}

// ============================================================================
// Batch Operations - Fetch multiple AI decisions efficiently
// ============================================================================

export interface FetchAllResult {
  risk?: RiskAnalysis;
  hedges?: HedgeRecommendation[];
  insights?: InsightSummary;
  action?: PortfolioAction;
  errors: string[];
}

export async function fetchAllAIDecisions(
  address: string,
  options?: {
    predictions?: Array<{ id: string; probability: number; [key: string]: unknown }>;
    portfolioData?: { totalValue: number; positions: unknown[] };
    force?: boolean;
    skipRisk?: boolean;
    skipHedges?: boolean;
    skipInsights?: boolean;
    skipAction?: boolean;
  }
): Promise<FetchAllResult> {
  const { 
    predictions = [], 
    portfolioData, 
    force = false,
    skipRisk = false,
    skipHedges = false,
    skipInsights = false,
    skipAction = false,
  } = options || {};

  const errors: string[] = [];
  const results: FetchAllResult = { errors };

  // Execute all fetches in parallel
  const promises = [];

  if (!skipRisk) {
    promises.push(
      fetchRiskAnalysis(address, force)
        .then(data => { results.risk = data; })
        .catch(e => { errors.push(`Risk: ${e.message}`); })
    );
  }

  if (!skipHedges) {
    promises.push(
      fetchHedgeRecommendations(address, force)
        .then(data => { results.hedges = data; })
        .catch(e => { errors.push(`Hedges: ${e.message}`); })
    );
  }

  if (!skipInsights && predictions.length > 0) {
    promises.push(
      fetchInsightSummary(predictions, force)
        .then(data => { results.insights = data; })
        .catch(e => { errors.push(`Insights: ${e.message}`); })
    );
  }

  if (!skipAction && portfolioData) {
    promises.push(
      fetchPortfolioAction(address, portfolioData, force)
        .then(data => { results.action = data; })
        .catch(e => { errors.push(`Action: ${e.message}`); })
    );
  }

  await Promise.all(promises);
  
  logger.info('[AIDecisions] Fetched all AI decisions', { 
    hasRisk: !!results.risk,
    hasHedges: !!results.hedges?.length,
    hasInsights: !!results.insights,
    hasAction: !!results.action,
    errorCount: errors.length,
  });

  return results;
}

// ============================================================================
// Cache Management
// ============================================================================

export function invalidateAllCache(): void {
  cache.risk = null;
  cache.hedges = null;
  cache.insights = null;
  cache.action = null;
  logger.info('[AIDecisions] All cache invalidated');
  emitAIEvent('ai:cache:invalidated');
}

export function invalidateCache(type: 'risk' | 'hedges' | 'insights' | 'action'): void {
  cache[type] = null;
  logger.debug(`[AIDecisions] ${type} cache invalidated`);
}

export function getCacheStatus(): Record<string, { valid: boolean; age: number }> {
  const now = Date.now();
  return {
    risk: { 
      valid: isCacheValid(cache.risk, CACHE_TTL.risk), 
      age: cache.risk ? now - cache.risk.timestamp : -1 
    },
    hedges: { 
      valid: isCacheValid(cache.hedges, CACHE_TTL.hedges), 
      age: cache.hedges ? now - cache.hedges.timestamp : -1 
    },
    insights: { 
      valid: isCacheValid(cache.insights, CACHE_TTL.insights), 
      age: cache.insights ? now - cache.insights.timestamp : -1 
    },
    action: { 
      valid: isCacheValid(cache.action, CACHE_TTL.action), 
      age: cache.action ? now - cache.action.timestamp : -1 
    },
  };
}

// ============================================================================
// Exports Summary
// ============================================================================

export const AIDecisions = {
  // Fetch functions
  fetchRisk: fetchRiskAnalysis,
  fetchHedges: fetchHedgeRecommendations,
  fetchInsights: fetchInsightSummary,
  fetchAction: fetchPortfolioAction,
  fetchAll: fetchAllAIDecisions,
  
  // Cache management
  invalidateAll: invalidateAllCache,
  invalidate: invalidateCache,
  getCacheStatus,
  
  // Events
  on: onAIEvent,
};

export default AIDecisions;
