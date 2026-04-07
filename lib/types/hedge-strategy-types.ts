/**
 * Hedging Agent Strategy Types
 *
 * Extracted from HedgingAgent.ts to reduce file size
 * and allow shared imports without pulling in the full agent.
 */

export interface HedgeStrategy {
  strategyId: string;
  portfolioId: string;
  targetMarket: string;
  hedgeRatio: number;
  rebalanceThreshold: number;
  stopLoss?: number;
  takeProfit?: number;
  maxLeverage: number;
  active: boolean;
}

export interface HedgeAnalysis {
  portfolioId: string;
  exposure: {
    asset: string;
    notionalValue: string;
    currentPrice: string;
    volatility: number;
  };
  recommendation: {
    action: 'OPEN' | 'CLOSE' | 'REBALANCE' | 'HOLD';
    market: string;
    side: 'LONG' | 'SHORT';
    size: string;
    leverage: number;
    reason: string;
  };
  riskMetrics: {
    portfolioVar: number;
    hedgeEffectiveness: number;
    basisRisk: number;
    fundingCost: number;
  };
  timestamp: number;
}
