/**
 * Portfolio Type Definitions
 * Shared types for portfolio data across the application
 */

export interface PortfolioToken {
  symbol: string;
  balance: number;
  value: number;
  price: number;
  allocation?: number;
}

export interface PortfolioData {
  address: string;
  tokens: PortfolioToken[];
  totalValue: number;
  lastUpdated?: string;
}

export interface RiskMetrics {
  overallRisk: string;
  riskScore: number;
  volatility: number;
  var95?: number;
  sharpeRatio?: number;
  factors: RiskFactor[];
}

export interface RiskFactor {
  factor: string;
  level: string;
  description: string;
  impact: number;
}

export interface HedgingRecommendation {
  id: string;
  type: 'SHORT' | 'LONG' | 'OPTIONS' | 'STABLECOIN';
  market: string;
  action: string;
  reason: string;
  effectiveness: number;
  estimatedCost?: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AnalysisResult {
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  diversificationScore: number;
}
