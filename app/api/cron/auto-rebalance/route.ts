/**
 * Vercel Cron Job: Auto-Rebalance & Loss Protection
 * 
 * This endpoint is invoked by Vercel Cron Jobs every hour to:
 * 1. Check and rebalance portfolios based on allocation drift
 * 2. Monitor P&L and trigger protective hedges on significant losses
 * 
 * Schedule: Every hour (0 * * * *)
 * Configured in: vercel.json
 * 
 * Security: Protected by CRON_SECRET environment variable
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { getAutoRebalanceConfigs, saveLastRebalance, getLastRebalance } from '@/lib/storage/auto-rebalance-storage';
import { assessPortfolio, executeRebalance } from '@/lib/services/rebalance-executor';

// Configuration
const DRIFT_THRESHOLD_DEFAULT = 2; // 2% - lowered for more active rebalancing
const COOLDOWN_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOSS_PROTECTION_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours default

// Track last hedge for loss protection
const lastHedgeTime = new Map<number, number>();

interface LossProtectionConfig {
  enabled: boolean;
  lossThresholdPercent: number;
  action: 'hedge' | 'sell_to_stable';
  hedgeRatio: number;
  maxHedgeLeverage: number;
  cooldownHours?: number;
}

interface ProcessingResult {
  portfolioId: number;
  status: 'checked' | 'rebalanced' | 'hedged' | 'skipped' | 'error';
  reason?: string;
  drift?: number;
  pnlPercent?: number;
  txHash?: string;
  error?: string;
}

/**
 * Vercel Cron Job Handler
 * Invoked automatically every hour
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Security: Verify request is from Vercel Cron
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('[AutoRebalance Cron] Unauthorized request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  logger.info('[AutoRebalance Cron] Starting scheduled portfolio check');
  
  try {
    // Load enabled portfolios from persistent storage
    const configs = await getAutoRebalanceConfigs();
    const enabledConfigs = configs.filter(c => c.enabled);
    
    if (enabledConfigs.length === 0) {
      logger.info('[AutoRebalance Cron] No enabled portfolios, skipping');
      return NextResponse.json({
        success: true,
        message: 'No enabled portfolios',
        checked: 0,
        duration: Date.now() - startTime,
      });
    }
    
    logger.info(`[AutoRebalance Cron] Processing ${enabledConfigs.length} portfolios`);
    
    // Process each portfolio
    const results: ProcessingResult[] = [];
    
    for (const config of enabledConfigs) {
      try {
        const result = await processPortfolio(config);
        results.push(result);
      } catch (error: any) {
        logger.error(`[AutoRebalance Cron] Error processing portfolio ${config.portfolioId}:`, error);
        results.push({
          portfolioId: config.portfolioId,
          status: 'error',
          error: error.message,
        });
      }
    }
    
    // Summary
    const summary = {
      total: results.length,
      rebalanced: results.filter(r => r.status === 'rebalanced').length,
      checked: results.filter(r => r.status === 'checked').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
    };
    
    logger.info('[AutoRebalance Cron] Completed', summary);
    
    return NextResponse.json({
      success: true,
      summary,
      results,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    logger.error('[AutoRebalance Cron] Fatal error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Process a single portfolio - handles both rebalancing AND loss protection
 */
async function processPortfolio(config: any): Promise<ProcessingResult> {
  const { portfolioId, threshold = DRIFT_THRESHOLD_DEFAULT, autoApprovalEnabled, autoApprovalThreshold, lossProtection } = config;
  const now = Date.now();
  
  // Assess portfolio
  logger.info(`[AutoRebalance Cron] Assessing portfolio ${portfolioId}`);
  const assessment = await assessPortfolio(portfolioId, config.walletAddress);
  
  if (!assessment) {
    logger.warn(`[AutoRebalance Cron] Unable to fetch portfolio data for portfolio ${portfolioId}`);
    return {
      portfolioId,
      status: 'skipped',
      reason: 'Unable to fetch portfolio data',
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // LOSS PROTECTION CHECK (runs before rebalancing)
  // ════════════════════════════════════════════════════════════════════════
  if (lossProtection?.enabled && assessment.pnlPercent !== undefined) {
    const lossConfig = lossProtection as LossProtectionConfig;
    const cooldownMs = (lossConfig.cooldownHours || 4) * 60 * 60 * 1000;
    const lastHedge = lastHedgeTime.get(portfolioId) || 0;
    
    // Check if loss exceeds threshold (pnlPercent is negative for losses)
    if (assessment.pnlPercent < -lossConfig.lossThresholdPercent) {
      logger.warn(`[LossProtection] Portfolio ${portfolioId} P&L ${assessment.pnlPercent.toFixed(2)}% breached -${lossConfig.lossThresholdPercent}% threshold!`);
      
      // Check hedge cooldown
      if (now - lastHedge < cooldownMs) {
        const hoursRemaining = ((cooldownMs - (now - lastHedge)) / (1000 * 60 * 60)).toFixed(1);
        logger.info(`[LossProtection] Hedge cooldown active (${hoursRemaining}h remaining)`);
      } else {
        // Execute protective hedge
        logger.info(`[LossProtection] Executing protective hedge for portfolio ${portfolioId}`);
        
        try {
          const hedgeResult = await executeProtectiveHedge(
            portfolioId,
            config.walletAddress,
            assessment,
            lossConfig
          );
          
          lastHedgeTime.set(portfolioId, now);
          
          return {
            portfolioId,
            status: 'hedged',
            pnlPercent: assessment.pnlPercent,
            txHash: hedgeResult.txHash,
            reason: `Loss protection triggered at ${assessment.pnlPercent.toFixed(2)}% → hedged ${(lossConfig.hedgeRatio * 100).toFixed(0)}% of portfolio`,
          };
        } catch (error: any) {
          logger.error(`[LossProtection] Failed to execute hedge for portfolio ${portfolioId}:`, error);
          return {
            portfolioId,
            status: 'error',
            pnlPercent: assessment.pnlPercent,
            error: `Hedge failed: ${error.message}`,
          };
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // REBALANCING CHECK (allocation drift)
  // ════════════════════════════════════════════════════════════════════════
  
  // Check cooldown period
  const lastRebalance = await getLastRebalance(portfolioId);
  
  if (lastRebalance && (now - lastRebalance) < COOLDOWN_PERIOD_MS) {
    const hoursRemaining = ((COOLDOWN_PERIOD_MS - (now - lastRebalance)) / (1000 * 60 * 60)).toFixed(1);
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} in cooldown (${hoursRemaining}h remaining)`);
    return {
      portfolioId,
      status: 'skipped',
      reason: `Cooldown active (${hoursRemaining}h remaining)`,
    };
  }
  
  // Check if rebalancing needed - use absolute drift % (e.g., 35% → 37% = 2% drift)
  const maxAbsoluteDrift = Math.max(...assessment.drifts.map(d => Math.abs(d.drift)));
  
  if (maxAbsoluteDrift < threshold) {
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} within threshold (max drift: ${maxAbsoluteDrift.toFixed(2)}% < threshold ${threshold}%)`);
    return {
      portfolioId,
      status: 'checked',
      drift: maxAbsoluteDrift,
      pnlPercent: assessment.pnlPercent,
      reason: `Max drift ${maxAbsoluteDrift.toFixed(2)}% < threshold ${threshold}%`,
    };
  }
  
  // Drift detected
  logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} requires rebalancing (max drift: ${maxAbsoluteDrift.toFixed(2)}% > threshold ${threshold}%)`);
  logger.info(`[AutoRebalance Cron] Drift details:`, {
    drifts: assessment.drifts.map(d => ({
      asset: d.asset,
      target: `${d.target}%`,
      current: `${d.current.toFixed(1)}%`,
      drift: `${d.drift > 0 ? '+' : ''}${d.drift.toFixed(1)}%`,
    })),
  });
  
  // Check auto-approval
  if (!autoApprovalEnabled) {
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} requires manual approval`);
    return {
      portfolioId,
      status: 'skipped',
      drift: maxAbsoluteDrift,
      reason: 'Manual approval required',
    };
  }
  
  if (autoApprovalThreshold && assessment.totalValue > autoApprovalThreshold) {
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} exceeds auto-approval threshold ($${assessment.totalValue.toLocaleString()} > $${autoApprovalThreshold.toLocaleString()})`);
    return {
      portfolioId,
      status: 'skipped',
      drift: maxAbsoluteDrift,
      reason: `Value $${assessment.totalValue.toLocaleString()} > threshold $${autoApprovalThreshold.toLocaleString()}`,
    };
  }
  
  // Execute rebalancing
  logger.info(`[AutoRebalance Cron] Executing rebalance for portfolio ${portfolioId}`);
  
  try {
    const result = await executeRebalance(portfolioId, config.walletAddress, assessment.proposedActions);
    
    // Save last rebalance timestamp
    await saveLastRebalance(portfolioId, now);
    
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} rebalanced successfully: ${result.txHash}`);
    
    return {
      portfolioId,
      status: 'rebalanced',
      drift: maxAbsoluteDrift,
      txHash: result.txHash,
      reason: `Rebalanced (max drift: ${maxAbsoluteDrift.toFixed(2)}%)`,
    };
    
  } catch (error: any) {
    logger.error(`[Auto Rebalance Cron] Failed to rebalance portfolio ${portfolioId}:`, error);
    return {
      portfolioId,
      status: 'error',
      drift: maxAbsoluteDrift,
      error: error.message,
    };
  }
}

/**
 * Execute a protective hedge when loss threshold is breached
 */
async function executeProtectiveHedge(
  portfolioId: number,
  walletAddress: string,
  assessment: any,
  lossConfig: LossProtectionConfig
): Promise<{ txHash: string }> {
  // Find the largest losing asset to hedge
  const losers = assessment.drifts
    .filter((d: any) => d.pnlPercent < 0)
    .sort((a: any, b: any) => a.pnlPercent - b.pnlPercent);
  
  const assetToHedge = losers[0]?.asset || 'BTC';
  const hedgeSize = assessment.totalValue * lossConfig.hedgeRatio;
  const leverage = Math.min(lossConfig.maxHedgeLeverage, 5);
  
  logger.info(`[LossProtection] Creating SHORT ${assetToHedge} hedge`, {
    portfolioId,
    hedgeSize: `$${hedgeSize.toLocaleString()}`,
    leverage: `${leverage}x`,
    portfolioLoss: `${assessment.pnlPercent.toFixed(2)}%`,
  });
  
  // Call the hedge execution API
  const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/agents/hedging/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset: assetToHedge,
      side: 'SHORT',
      notionalValue: hedgeSize / leverage, // Collateral amount
      leverage,
      reason: `Auto loss protection: portfolio down ${Math.abs(assessment.pnlPercent).toFixed(2)}%`,
      walletAddress,
      autoApprovalEnabled: true,
      source: 'loss-protection-cron',
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Hedge API failed: ${error}`);
  }
  
  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error || 'Hedge execution failed');
  }
  
  logger.info(`[LossProtection] Hedge executed successfully`, {
    txHash: result.txHash,
    hedgeId: result.hedgeId,
  });
  
  return { txHash: result.txHash || result.hedgeId };
}

/**
 * Manual trigger for testing (POST)
 * Not invoked by cron, but useful for manual testing
 */
export async function POST(request: NextRequest) {
  logger.info('[AutoRebalance Cron] Manual trigger via POST');
  return GET(request);
}
