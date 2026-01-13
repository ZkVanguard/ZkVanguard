/**
 * Agent API Integration
 * Frontend interface to AI agents
 */

import { AgentTask as SharedAgentTask } from '../../shared/types/agent';

// Re-export for backward compatibility
export type AgentTask = SharedAgentTask;

/**
 * Simulated agent responses for demo
 */
const DEMO_MODE = false;

async function simulateAgentCall<T>(fn: () => T): Promise<T> {
  await new Promise(resolve => setTimeout(resolve, 300));
  return fn();
}

/**
 * Get portfolio risk assessment
 */
export async function assessPortfolioRisk(address: string) {
  if (DEMO_MODE) {
    // Calculate based on real wallet balance - example for 30 USDC with leverage
    const portfolioValue = 30; // Real USDC balance
    const leverage = 20; // 20x leverage
    const leveragedExposure = portfolioValue * leverage; // $600 notional
    
    return simulateAgentCall(() => ({
      var: leveragedExposure * 0.05, // 5% VaR
      volatility: 28.5, // Higher volatility due to leverage
      sharpeRatio: 1.2, // Moderate Sharpe with leverage
      liquidationRisk: 8.5, // Higher liquidation risk with 20x leverage
      healthScore: 72, // Good but not perfect due to leverage
      recommendations: [
        `Portfolio value: $${portfolioValue} with ${leverage}x leverage = $${leveragedExposure} exposure`,
        `Liquidation risk: ${8.5}% - consider reducing leverage if volatility increases`,
        'Current position size appropriate for testnet demonstration',
        'Monitor closely - high leverage requires active management'
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
    // Real portfolio: 30 USDC @ 20x leverage = $600 exposure
    const portfolioValue = 30;
    const leverage = 20;
    const exposure = portfolioValue * leverage; // $600
    
    return simulateAgentCall(() => [
      {
        action: 'SHORT',
        asset: 'BTC-PERP',
        size: 0.007, // ~$300 hedge (50% of exposure)
        leverage: 10,
        reason: `Protect $${exposure} leveraged position from >10% drawdown`,
        expectedGasSavings: 2.50,
        estimatedCost: 0.00, // x402 gasless
        targetPrice: 42800,
        stopLoss: 45200,
        capitalRequired: portfolioValue * 0.5 // $15 USDC for hedge
      },
      {
        action: 'REBALANCE',
        asset: 'PORTFOLIO',
        size: 0,
        leverage: 1,
        reason: 'Consider reducing leverage from 20x to 15x to lower liquidation risk',
        expectedGasSavings: 0.00,
        estimatedCost: 0.00,
        note: `Current exposure: $${exposure} on $${portfolioValue} capital`
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
      zkProofGenerated: true,
      txHash: `0x${Date.now().toString(16)}${'0'.repeat(48)}`.slice(0, 66), // Demo tx hash
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
 * Get agent activity - combines real activity from localStorage with API
 */
export async function getAgentActivity(_address: string) {
  // Get real activity from localStorage (hedge settlements, etc.)
  const activities: Array<{
    id: string;
    agentName: string;
    agentType: string;
    action: string;
    description: string;
    status: 'completed' | 'in-progress' | 'pending';
    timestamp: Date;
    type: string;
    priority: number;
    createdAt: Date;
  }> = [];
  
  // Check localStorage for settlement history (real hedge operations)
  if (typeof window !== 'undefined') {
    try {
      const settlements = localStorage.getItem('settlement_history');
      if (settlements) {
        const settlementData = JSON.parse(settlements);
        Object.values(settlementData).forEach((batch: any, index: number) => {
          if (batch.type === 'hedge' && batch.managerSignature) {
            const timestamp = new Date(batch.timestamp);
            const isClosed = batch.status === 'closed';
            
            // Add hedge creation activity
            activities.push({
              id: `hedge-${batch.batchId}`,
              agentName: 'Hedging Agent',
              agentType: 'hedging',
              action: 'Execute Hedge',
              description: `${batch.hedgeDetails?.type || 'SHORT'} ${batch.hedgeDetails?.asset || 'BTC-PERP'} position ${isClosed ? 'closed' : 'opened'}`,
              status: isClosed ? 'completed' : 'in-progress',
              timestamp,
              type: 'hedging',
              priority: 1,
              createdAt: timestamp,
            });
            
            // Add settlement activity if closed
            if (isClosed && batch.closedAt) {
              activities.push({
                id: `settle-${batch.batchId}`,
                agentName: 'Settlement Agent',
                agentType: 'settlement',
                action: 'Close Position',
                description: `Settled ${batch.hedgeDetails?.asset || 'BTC-PERP'} with P/L: ${batch.finalPnL?.toFixed(2) || '0'} USDC`,
                status: 'completed',
                timestamp: new Date(batch.closedAt),
                type: 'settlement',
                priority: 1,
                createdAt: new Date(batch.closedAt),
              });
            }
          }
        });
      }
    } catch (e) {
      console.error('Error reading settlement history:', e);
    }
  }
  
  // Sort by timestamp descending (most recent first)
  activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  
  // If no real activities, show idle state
  if (activities.length === 0) {
    return [{
      id: 'idle',
      agentName: 'System',
      agentType: 'system',
      action: 'Monitoring',
      description: 'AI agents standing by - use chat to analyze portfolio or create hedges',
      status: 'completed' as const,
      timestamp: new Date(),
      type: 'system',
      priority: 0,
      createdAt: new Date(),
    }];
  }
  
  return activities;
}

/**
 * Format agent message for display
 */
export function formatAgentMessage(msg: Record<string, unknown>): string {
  const payload = msg.payload as Record<string, unknown> | undefined;
  if (msg.type === 'RISK_ALERT') {
    return `⚠️ Risk Alert: ${payload?.message}`;
  }
  if (msg.type === 'HEDGE_RECOMMENDATION') {
    return `Hedge: ${payload?.action} ${payload?.asset} ${payload?.size}x`;
  }
  if (msg.type === 'SETTLEMENT_BATCH') {
    return `Batch settlement: ${payload?.count || 0} transactions`;
  }
  if (msg.type === 'REPORT_GENERATED') {
    return `${payload?.period || 'Portfolio'} report generated`;
  }
  return String(msg.type);
}
