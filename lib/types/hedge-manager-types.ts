/**
 * Centralized Hedge Manager Types
 *
 * Extracted from CentralizedHedgeManager.ts to reduce file size
 * and allow shared imports without pulling in the full service.
 */

import type { AutoHedgeConfig, RiskAssessment } from '../services/hedging/hedge-types';

// ============================================
// TYPES
// ============================================

/** Single snapshot of all market data — fetched ONCE per cycle */
export interface MarketSnapshot {
  prices: Map<string, AssetPrice>;
  timestamp: number;
  source: string;
  fetchDurationMs: number;
}

export interface AssetPrice {
  price: number;
  bid: number;
  ask: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

/** Portfolio context with all data needed for risk assessment */
export interface PortfolioContext {
  portfolioId: number;
  walletAddress: string;
  config: AutoHedgeConfig;
  positions: Position[];
  activeHedges: ActiveHedge[];
  allocations: Record<string, number>;
  totalValue: number;
  isCommunityPool: boolean;
  poolStats?: {
    totalShares: number;
    onChainNAV: number;
    marketNAV: number;
    sharePrice: number;
    peakSharePrice: number;
  };
}

export interface Position {
  symbol: string;
  value: number;
  change24h: number;
  balance: number;
}

export interface ActiveHedge {
  asset: string;
  side: string;
  size: number;
  notionalValue: number;
}

/** Result of a centralized assessment cycle */
export interface CycleResult {
  timestamp: number;
  durationMs: number;
  snapshot: MarketSnapshot;
  portfoliosAssessed: number;
  assessments: Map<number, RiskAssessment>;
  hedgesExecuted: number;
  hedgesFailed: number;
  pnlUpdated: number;
  pnlErrors: number;
}

// ============================================
// CONFIG
// ============================================

export const CENTRAL_CONFIG = {
  TRACKED_SYMBOLS: ['BTC', 'ETH', 'CRO', 'SUI'] as const,
  MAX_PORTFOLIO_DRAWDOWN_PERCENT: 3,
  MAX_ASSET_CONCENTRATION_PERCENT: 40,
  MIN_HEDGE_SIZE_USD: 50,
  DEFAULT_LEVERAGE: 3,
  DEFAULT_STOP_LOSS_PERCENT: 10,
  DEFAULT_TAKE_PROFIT_PERCENT: 20,
  MIN_CONFIDENCE_FOR_EXECUTION: 0.65,
  COMMUNITY_POOL_ADDRESS: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30',
};
