/**
 * Shared hedge types used by AutoHedgingService and CentralizedHedgeManager.
 * Extracted to avoid circular imports between the two services.
 */

export interface AutoHedgeConfig {
  portfolioId: number;
  walletAddress: string;
  enabled: boolean;
  riskThreshold: number; // 1-10 scale
  maxLeverage: number;
  allowedAssets: string[];
}

export interface RiskAssessment {
  portfolioId: number;
  totalValue: number;
  drawdownPercent: number;
  volatility: number;
  riskScore: number; // 1-10
  recommendations: HedgeRecommendation[];
  aggregatedPrediction?: {
    direction: string;
    confidence: number;
    consensus: number;
    recommendation: string;
    sizeMultiplier: number;
    sources: Array<{
      name: string;
      available: boolean;
      weight: number;
      direction?: string;
      confidence?: number;
    }>;
  } | null;
  timestamp: number;
}

export interface HedgeRecommendation {
  asset: string;
  side: 'LONG' | 'SHORT';
  reason: string;
  suggestedSize: number;
  leverage: number;
  confidence: number; // 0-1
}
