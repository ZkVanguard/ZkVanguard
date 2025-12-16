/**
 * Agent API Integration
 * Frontend interface to AI agents
 */

import { AgentTask as SharedAgentTask } from '@/shared/types/agent';

// Re-export for backward compatibility
export type AgentTask = SharedAgentTask;

/**
 * Simulated agent responses for demo
 */
const DEMO_MODE = true;

async function simulateAgentCall<T>(fn: () => T): Promise<T> {
  await new Promise(resolve => setTimeout(resolve, 300));
  return fn();
}

/**
 * Get portfolio risk assessment
 */
export async function assessPortfolioRisk(address: string) {
  if (DEMO_MODE) {
    return simulateAgentCall(() => ({
      var: 0.15 + Math.random() * 0.1,
      volatility: 0.24 + Math.random() * 0.05,
      sharpeRatio: 1.8 + Math.random() * 0.4,
      liquidationRisk: 0.05 + Math.random() * 0.03,
      healthScore: 80 + Math.random() * 15,
      recommendations: [
        'Portfolio shows moderate risk exposure',
        'Consider hedging positions with >10x leverage',
        'Current volatility within acceptable range'
      ]
    }));
  }
  
  const response = await fetch(`/api/agents/risk/assess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  });
  return response.json();
}

/**
 * Get hedging recommendations
 */
export async function getHedgingRecommendations(address: string, positions: unknown[]) {
  if (DEMO_MODE) {
    return simulateAgentCall(() => [
      {
        action: 'SHORT',
        asset: 'BTC-PERP',
        size: 0.5,
        leverage: 5,
        reason: 'Hedge against long BTC exposure',
        expectedGasSavings: 0.67
      },
      {
        action: 'LONG',
        asset: 'ETH-PERP',
        size: 1.0,
        leverage: 3,
        reason: 'Counter-hedge ETH shorts',
        expectedGasSavings: 0.65
      }
    ]);
  }
  
  const response = await fetch(`/api/agents/hedging/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, positions })
  });
  return response.json();
}

/**
 * Execute settlement batch
 */
export async function executeSettlementBatch(transactions: unknown[]) {
  if (DEMO_MODE) {
    return simulateAgentCall(() => ({
      batchId: `batch-${Date.now()}`,
      transactionCount: transactions.length,
      gasSaved: 0.67,
      estimatedCost: `${(transactions.length * 0.0001).toFixed(4)} CRO`,
      status: 'completed' as const,
      zkProofGenerated: true
    }));
  }
  
  const response = await fetch(`/api/agents/settlement/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions })
  });
  return response.json();
}

/**
 * Generate portfolio report
 */
export async function generatePortfolioReport(address: string, period: string) {
  if (DEMO_MODE) {
    return simulateAgentCall(() => ({
      period,
      totalValue: 50000 + Math.random() * 50000,
      profitLoss: -5000 + Math.random() * 10000,
      performance: {
        daily: 2.5,
        weekly: 8.3,
        monthly: 15.7
      },
      topPositions: [
        { asset: 'CRO', value: 25000, pnl: 5.2 },
        { asset: 'USDC', value: 15000, pnl: 0.1 },
        { asset: 'ETH', value: 10000, pnl: 8.5 }
      ]
    }));
  }
  
  const response = await fetch(`/api/agents/reporting/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, period })
  });
  return response.json();
}

/**
 * Send natural language command
 */
export async function sendAgentCommand(command: string) {
  const response = await fetch('/api/agents/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  });
  return response.json();
}

/**
 * Get agent activity
 */
export async function getAgentActivity(_address: string) {
  if (DEMO_MODE) {
    return simulateAgentCall(() => [
      {
        id: '1',
        agentName: 'Risk Agent',
        agentType: 'risk',
        action: 'Portfolio Analysis',
        description: 'Assessed risk metrics for portfolio',
        status: 'completed' as const,
        timestamp: new Date(Date.now() - 120000),
        type: 'risk_assessment',
        priority: 1,
        createdAt: new Date(Date.now() - 120000)
      },
      {
        id: '2',
        agentName: 'Hedging Agent',
        agentType: 'hedging',
        action: 'Generate Hedges',
        description: 'Created 3 hedge recommendations',
        status: 'completed' as const,
        timestamp: new Date(Date.now() - 60000),
        type: 'hedging',
        priority: 2,
        createdAt: new Date(Date.now() - 60000)
      },
      {
        id: '3',
        agentName: 'Settlement Agent',
        agentType: 'settlement',
        action: 'Batch Settlement',
        description: 'Processing 5 transactions',
        status: 'in-progress' as const,
        timestamp: new Date(),
        type: 'settlement',
        priority: 1,
        createdAt: new Date()
      }
    ]);
  }
  
  return [];
}

/**
 * Format agent message for display
 */
export function formatAgentMessage(msg: Record<string, unknown>): string {
  if (msg.type === 'RISK_ALERT') {
    return `⚠️ Risk Alert: ${msg.payload?.message}`;
  }
  if (msg.type === 'HEDGE_RECOMMENDATION') {
    return `Hedge: ${msg.payload?.action} ${msg.payload?.asset} ${msg.payload?.size}x`;
  }
  if (msg.type === 'SETTLEMENT_BATCH') {
    return `Batch settlement: ${msg.payload?.count || 0} transactions`;
  }
  if (msg.type === 'REPORT_GENERATED') {
    return `${msg.payload?.period || 'Portfolio'} report generated`;
  }
  return msg.type;
}
