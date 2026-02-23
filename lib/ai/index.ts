/**
 * AI Decisions - Unified Exports
 * ===============================
 * Single import point for all AI decision-related functionality.
 * 
 * Usage:
 * ```tsx
 * // Context hooks
 * import { useAIDecisions, useRiskAnalysis, useHedgeRecommendations } from '@/lib/ai';
 * 
 * // Service functions
 * import { AIDecisions } from '@/lib/ai';
 * 
 * // Types
 * import type { RiskAnalysis, HedgeRecommendation, InsightSummary } from '@/lib/ai';
 * ```
 */

// ============================================================================
// Service Layer - Direct API access with caching
// ============================================================================
export { 
  AIDecisions,
  fetchRiskAnalysis,
  fetchHedgeRecommendations,
  fetchInsightSummary,
  fetchPortfolioAction,
  fetchAllAIDecisions,
  invalidateAllCache,
  invalidateCache,
  getCacheStatus,
  onAIEvent,
} from '@/lib/services/ai-decisions';

// ============================================================================
// Types
// ============================================================================
export type {
  RiskAnalysis,
  HedgeRecommendation,
  InsightSummary,
  PortfolioAction,
  TokenDirection,
  LeverageRecommendation,
  AIDecisionsState,
  AIEvent,
  FetchAllResult,
} from '@/lib/services/ai-decisions';

// ============================================================================
// Context & Hooks - React integration
// ============================================================================
export {
  AIDecisionsProvider,
  useAIDecisions,
  useRiskAnalysis,
  useHedgeRecommendations,
  useMarketInsights,
  usePortfolioAction,
} from '@/contexts/AIDecisionsContext';

export type {
  AIDecisionsContextType,
} from '@/contexts/AIDecisionsContext';
