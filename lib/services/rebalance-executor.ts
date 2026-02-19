/**
 * Rebalance Executor
 * 
 * Core logic for assessing portfolios and executing rebalances
 * Extracted from AutoRebalanceService for use in Vercel Cron Jobs
 */

import { logger } from '../utils/logger';
import { generateRebalanceProof } from '@/lib/api/zk';

export interface AllocationDrift {
  asset: string;
  target: number;
  current: number;
  drift: number;
  driftPercent: number;
  shouldRebalance: boolean;
}

export interface RebalanceAssessment {
  portfolioId: number;
  totalValue: number;
  requiresRebalance: boolean;
  drifts: AllocationDrift[];
  proposedActions: {
    asset: string;
    action: 'BUY' | 'SELL';
    amount: number;
    reason: string;
  }[];
  estimatedCost: number;
  timestamp: number;
}

export interface RebalanceResult {
  txHash: string;
  zkProof: {
    proofHash: string;
    verified: boolean;
  };
  actions: any[];
  timestamp: number;
}

/**
 * Assess a portfolio and determine if rebalancing is needed
 */
export async function assessPortfolio(portfolioId: number, walletAddress: string): Promise<RebalanceAssessment | null> {
  try {
    logger.info(`[RebalanceExecutor] Assessing portfolio ${portfolioId}`);
    
    // Fetch portfolio data from API
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/agents/portfolio/${portfolioId}`, {
      method: 'GET',
      headers: {
        'x-wallet-address': walletAddress,
      },
    });
    
    if (!response.ok) {
      logger.error(`[RebalanceExecutor] Failed to fetch portfolio ${portfolioId}: ${response.status}`);
      return null;
    }
    
    const portfolio = await response.json();
    
    if (!portfolio.data) {
      logger.error(`[RebalanceExecutor] No data for portfolio ${portfolioId}`);
      return null;
    }
    
    const { assets, targetAllocations, totalValue } = portfolio.data;
    
    // Calculate drifts
    const drifts: AllocationDrift[] = [];
    const proposedActions: any[] = [];
    
    for (const asset of assets) {
      const target = targetAllocations[asset.symbol] || 0;
      const current = (asset.value / totalValue) * 100;
      const drift = current - target;
      const driftPercent = Math.abs((drift / target) * 100);
      
      drifts.push({
        asset: asset.symbol,
        target,
        current,
        drift,
        driftPercent,
        shouldRebalance: driftPercent > 5, // Will be compared to config threshold by caller
      });
      
      // Generate proposed actions
      if (drift > 0) {
        // Over-allocated, need to sell
        const amountToSell = ((drift / 100) * totalValue);
        proposedActions.push({
          asset: asset.symbol,
          action: 'SELL' as const,
          amount: amountToSell,
          reason: `Reduce from ${current.toFixed(1)}% to ${target}% (drift: +${drift.toFixed(1)}%)`,
        });
      } else if (drift < 0) {
        // Under-allocated, need to buy
        const amountToBuy = ((Math.abs(drift) / 100) * totalValue);
        proposedActions.push({
          asset: asset.symbol,
          action: 'BUY' as const,
          amount: amountToBuy,
          reason: `Increase from ${current.toFixed(1)}% to ${target}% (drift: ${drift.toFixed(1)}%)`,
        });
      }
    }
    
    // Estimate cost (gas + slippage)
    const estimatedGas = proposedActions.length * 0.002; // ~$0.002 per transaction on Cronos
    const estimatedSlippage = proposedActions.reduce((sum, action) => sum + (action.amount * 0.001), 0); // 0.1% slippage
    const estimatedCost = estimatedGas + estimatedSlippage;
    
    const maxDriftPercent = Math.max(...drifts.map(d => Math.abs(d.driftPercent)));
    
    return {
      portfolioId,
      totalValue,
      requiresRebalance: maxDriftPercent > 5, // Will be refined by caller based on config
      drifts,
      proposedActions,
      estimatedCost,
      timestamp: Date.now(),
    };
    
  } catch (error: any) {
    logger.error(`[RebalanceExecutor] Error assessing portfolio ${portfolioId}:`, error);
    return null;
  }
}

/**
 * Execute rebalancing for a portfolio
 */
export async function executeRebalance(
  portfolioId: number,
  walletAddress: string,
  actions: any[]
): Promise<RebalanceResult> {
  try {
    logger.info(`[RebalanceExecutor] Executing rebalance for portfolio ${portfolioId}`, { actions });
    
    // Prepare allocation changes for ZK proof
    const allocationChanges = actions.map(action => ({
      asset: action.asset,
      action: action.action,
      amount: action.amount,
    }));
    
    // Generate ZK proof
    logger.info(`[RebalanceExecutor] Generating ZK proof for portfolio ${portfolioId}`);
    const zkProof = await generateRebalanceProof(
      {
        old_allocations: [], // TODO: fetch current allocations
        new_allocations: [], // TODO: compute new allocations
      },
      portfolioId
    );
    
    // Call rebalance API
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/agents/portfolio/rebalance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': walletAddress,
      },
      body: JSON.stringify({
        portfolioId,
        walletAddress,
        newAllocations: actions.map(a => ({
          asset: a.asset,
          percentage: 0, // Will be calculated by backend
          action: a.action,
          amount: a.amount,
        })),
        zkProof,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Rebalance API error: ${error.error || response.statusText}`);
    }
    
    const result = await response.json();
    
    logger.info(`[RebalanceExecutor] Rebalance successful for portfolio ${portfolioId}: ${result.txHash}`);
    
    // Trigger risk assessment after rebalancing (fire and forget)
    triggerPostRebalanceRiskAssessment(portfolioId, walletAddress).catch(error => {
      logger.error(`[RebalanceExecutor] Failed to trigger post-rebalance risk assessment:`, error);
    });
    
    return {
      txHash: result.txHash,
      zkProof: result.zkProof,
      actions: result.actions,
      timestamp: Date.now(),
    };
    
  } catch (error: any) {
    logger.error(`[RebalanceExecutor] Error executing rebalance for portfolio ${portfolioId}:`, error);
    throw error;
  }
}

/**
 * Trigger risk assessment and auto-hedging after rebalancing
 * This ensures the portfolio is automatically hedged after allocation changes
 */
async function triggerPostRebalanceRiskAssessment(portfolioId: number, walletAddress: string): Promise<void> {
  try {
    logger.info(`[RebalanceExecutor] Triggering post-rebalance risk assessment for portfolio ${portfolioId}`);
    
    // Call auto-hedging service to assess risk
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/agents/auto-hedge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'trigger_assessment',
        portfolioId,
        walletAddress,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      logger.info(`[RebalanceExecutor] Risk assessment triggered for portfolio ${portfolioId}`, {
        riskScore: result.assessment?.riskScore,
        recommendations: result.assessment?.recommendations?.length || 0,
      });
    } else {
      logger.warn(`[RebalanceExecutor] Failed to trigger risk assessment: ${response.status}`);
    }
  } catch (error: any) {
    logger.error(`[RebalanceExecutor] Error triggering risk assessment:`, error);
  }
}

/**
 * Estimate gas cost for rebalancing
 */
export async function estimateRebalanceCost(actions: any[]): Promise<number> {
  // Rough estimates for Cronos network
  const gasPerTx = 0.002; // $0.002 per transaction
  const slippageRate = 0.001; // 0.1% slippage
  
  const gasCost = actions.length * gasPerTx;
  const slippageCost = actions.reduce((sum, action) => sum + (action.amount * slippageRate), 0);
  
  return gasCost + slippageCost;
}
