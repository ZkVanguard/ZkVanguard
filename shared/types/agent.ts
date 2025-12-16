/**
 * @fileoverview Shared type definitions for AI agents
 * @module shared/types/agent
 */

export type AgentStatus = 'idle' | 'busy' | 'initializing' | 'error' | 'shutdown';

export type AgentType =
  | 'lead'
  | 'risk'
  | 'hedging'
  | 'settlement'
  | 'reporting'
  | 'monitoring';

/**
 * Agent capabilities enum
 */
export enum AgentCapability {
  RISK_ANALYSIS = 'RISK_ANALYSIS',
  PORTFOLIO_MANAGEMENT = 'PORTFOLIO_MANAGEMENT',
  MARKET_INTEGRATION = 'MARKET_INTEGRATION',
  PAYMENT_PROCESSING = 'PAYMENT_PROCESSING',
  SETTLEMENT = 'SETTLEMENT',
  DATA_ANALYSIS = 'DATA_ANALYSIS',
  REPORTING = 'REPORTING'
}

export type TaskStatus = 'queued' | 'in-progress' | 'completed' | 'failed' | 'cancelled';

export type MessageType =
  | 'task-assignment'
  | 'task-result'
  | 'status-update'
  | 'error'
  | 'request'
  | 'response'
  | 'broadcast';

/**
 * Agent configuration
 */
export interface AgentConfig {
  name: string;
  type: AgentType;
  maxRetries?: number;
  timeout?: number;
  apiKeys?: Record<string, string>;
  endpoints?: Record<string, string>;
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Agent task structure
 */
export interface AgentTask {
  id: string;
  type?: string;
  status?: TaskStatus;
  priority: number;
  payload?: unknown;
  assignedTo?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  executionTime?: number;
  result?: unknown;
  error?: Error;
  metadata?: Record<string, unknown>;
  
  // Compatibility aliases for frontend
  agentName?: string;
  agentType?: string;
  action?: string;
  description?: string;
  timestamp?: Date;
  parameters?: Record<string, unknown>;
}

/**
 * Task execution result
 */
export interface TaskResult {
  success: boolean;
  data?: unknown;
  error: string | null;
  executionTime: number;
  agentId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Inter-agent message
 */
export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string; // Agent ID or 'broadcast'
  payload: unknown;
  timestamp: Date;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Agent execution context
 */
export interface AgentContext {
  portfolioId?: number;
  userId?: string;
  strategy?: string;
  constraints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Strategy input from user
 */
export interface StrategyInput {
  naturalLanguage: string;
  portfolioId?: number;
  constraints?: {
    maxRisk?: number;
    targetYield?: number;
    timeframe?: string;
    preferredAssets?: string[];
    blacklistedAssets?: string[];
  };
  metadata?: Record<string, unknown>;
}

/**
 * Parsed strategy intent
 */
export interface StrategyIntent {
  action: 'hedge' | 'rebalance' | 'analyze' | 'optimize';
  targetPortfolio: number;
  objectives: {
    yieldTarget?: number;
    riskLimit?: number;
    hedgeRatio?: number;
  };
  constraints: {
    maxSlippage?: number;
    minLiquidity?: number;
    timeframe?: number;
  };
  requiredAgents: AgentType[];
  estimatedComplexity: 'low' | 'medium' | 'high';
}

/**
 * Risk analysis result
 */
export interface RiskAnalysis {
  portfolioId: number;
  timestamp: Date;
  totalRisk: number; // 0-100 scale
  volatility: number;
  exposures: {
    asset: string;
    exposure: number;
    contribution: number;
  }[];
  recommendations: string[];
  marketSentiment: 'bullish' | 'bearish' | 'neutral';
  zkProofHash?: string;
}

/**
 * Hedging strategy result
 */
export interface HedgingStrategy {
  portfolioId: number;
  timestamp: Date;
  strategy: string;
  instruments: {
    type: 'perpetual' | 'option' | 'spot';
    asset: string;
    size: number;
    leverage?: number;
    entryPrice: number;
  }[];
  estimatedCost: number;
  estimatedYield: number;
  executionStatus: 'pending' | 'executed' | 'failed';
  txHashes?: string[];
}

/**
 * Settlement result
 */
export interface SettlementResult {
  portfolioId: number;
  timestamp: Date;
  payments: {
    from: string;
    to: string;
    token: string;
    amount: number;
    txHash: string;
    isGasless: boolean;
  }[];
  totalGasSaved: number;
  batchId?: number;
}

/**
 * Agent execution report
 */
export interface AgentExecutionReport {
  executionId: string;
  portfolioId: number;
  strategy: string;
  timestamp: Date;
  agents: {
    agentId: string;
    agentType: AgentType;
    taskType: string;
    executionTime: number;
    result: unknown;
  }[];
  riskAnalysis?: RiskAnalysis;
  hedgingStrategy?: HedgingStrategy;
  settlement?: SettlementResult;
  zkProofs: {
    proofType: string;
    proofHash: string;
    verified: boolean;
  }[];
  totalExecutionTime: number;
  status: 'success' | 'partial' | 'failed';
  errors?: Error[];
}
