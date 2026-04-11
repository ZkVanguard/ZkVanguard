import type { ZKProofData } from '@/components/ZKVerificationBadge';

export interface RealPriceData {
  symbol: string;
  price: number;
  change24h?: number;
  source: string;
}

export interface RealRiskAssessment {
  var: number;
  volatility: number;
  sharpeRatio: number;
  riskScore: number;
  overallRisk: string;
  realAgent: boolean;
}

export interface RealZKProof {
  proof_hash: string;
  merkle_root: string;
  timestamp: number;
  verified: boolean;
  protocol: string;
  security_level: number;
  cuda_acceleration: boolean;
  fallback_mode?: boolean;
}

export interface AgentStatus {
  orchestrator: { initialized: boolean; signerAvailable: boolean };
  agents: Record<string, { available: boolean }>;
  integrations: Record<string, { enabled: boolean }>;
}

export interface PortfolioState {
  totalValue: number;
  cash: number;
  positions: {
    symbol: string;
    amount: number;
    value: number;
    price: number;
    pnl: number;
    pnlPercent: number;
  }[];
  riskScore: number;
  volatility: number;
}

export interface AgentAction {
  id: string;
  timestamp: Date;
  agent: 'Lead' | 'Risk' | 'Hedging' | 'Settlement' | 'Reporting';
  action: string;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  zkProof?: ZKProofData;
  impact?: {
    metric: string;
    before: number;
    after: number;
  };
}

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  type: 'crash' | 'volatility' | 'recovery' | 'stress' | 'tariff';
  duration: number;
  priceChanges: { symbol: string; change: number }[];
  eventData?: {
    date: string;
    headline: string;
    source: string;
    marketContext: string;
    liquidations: string;
    priceAtEvent: { symbol: string; price: number }[];
    predictionData?: {
      polymarket: { question: string; before: number; after: number; volume: number };
      kalshi: { question: string; before: number; after: number; volume: number };
      predictit: { question: string; before: number; after: number; volume: number };
      consensus: number;
    };
  };
}
