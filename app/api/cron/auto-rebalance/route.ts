/**
 * Vercel Cron Job: Auto-Rebalance Portfolios
 * 
 * This endpoint is invoked by Vercel Cron Jobs every hour to check
 * and rebalance portfolios. It replaces the setInterval-based approach
 * which doesn't work in serverless environments.
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
const DRIFT_THRESHOLD_DEFAULT = 5; // 5%
const COOLDOWN_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ProcessingResult {
  portfolioId: number;
  status: 'checked' | 'rebalanced' | 'skipped' | 'error';
  reason?: string;
  drift?: number;
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
  const cronSecret = process.env.CRON_SECRET;
  
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
 * Process a single portfolio
 */
async function processPortfolio(config: any): Promise<ProcessingResult> {
  const { portfolioId, threshold = DRIFT_THRESHOLD_DEFAULT, autoApprovalEnabled, autoApprovalThreshold } = config;
  
  // Check cooldown period
  const lastRebalance = await getLastRebalance(portfolioId);
  const now = Date.now();
  
  if (lastRebalance && (now - lastRebalance) < COOLDOWN_PERIOD_MS) {
    const hoursRemaining = ((COOLDOWN_PERIOD_MS - (now - lastRebalance)) / (1000 * 60 * 60)).toFixed(1);
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} in cooldown (${hoursRemaining}h remaining)`);
    return {
      portfolioId,
      status: 'skipped',
      reason: `Cooldown active (${hoursRemaining}h remaining)`,
    };
  }
  
  // Assess portfolio
  logger.info(`[AutoRebalance Cron] Assessing portfolio ${portfolioId}`);
  const assessment = await assessPortfolio(portfolioId, config.walletAddress);
  
  if (!assessment) {
    return {
      portfolioId,
      status: 'skipped',
      reason: 'Unable to fetch portfolio data',
    };
  }
  
  // Check if rebalancing needed
  const maxDrift = Math.max(...assessment.drifts.map(d => Math.abs(d.driftPercent)));
  
  if (maxDrift < threshold) {
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} within threshold (drift: ${maxDrift.toFixed(2)}%)`);
    return {
      portfolioId,
      status: 'checked',
      drift: maxDrift,
      reason: `Drift ${maxDrift.toFixed(2)}% < threshold ${threshold}%`,
    };
  }
  
  // Drift detected
  logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} requires rebalancing (drift: ${maxDrift.toFixed(2)}%)`);
  
  // Check auto-approval
  if (!autoApprovalEnabled) {
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} requires manual approval`);
    // TODO: Send notification to user
    return {
      portfolioId,
      status: 'skipped',
      drift: maxDrift,
      reason: 'Manual approval required',
    };
  }
  
  if (autoApprovalThreshold && assessment.totalValue > autoApprovalThreshold) {
    logger.info(`[AutoRebalance Cron] Portfolio ${portfolioId} exceeds auto-approval threshold ($${assessment.totalValue.toLocaleString()})`);
    // TODO: Send notification to user
    return {
      portfolioId,
      status: 'skipped',
      drift: maxDrift,
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
      drift: maxDrift,
      txHash: result.txHash,
      reason: `Rebalanced (drift: ${maxDrift.toFixed(2)}%)`,
    };
    
  } catch (error: any) {
    logger.error(`[AutoRebalance Cron] Failed to rebalance portfolio ${portfolioId}:`, error);
    return {
      portfolioId,
      status: 'error',
      drift: maxDrift,
      error: error.message,
    };
  }
}

/**
 * Manual trigger for testing (POST)
 * Not invoked by cron, but useful for manual testing
 */
export async function POST(request: NextRequest) {
  logger.info('[AutoRebalance Cron] Manual trigger via POST');
  return GET(request);
}
