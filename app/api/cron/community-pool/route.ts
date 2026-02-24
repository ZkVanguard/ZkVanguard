/**
 * Vercel Cron Job: Community Pool AI Management
 * 
 * This endpoint is invoked by Vercel Cron Jobs to:
 * 1. Check community pool risk metrics
 * 2. Execute AI allocation decisions
 * 3. Trigger auto-hedging when needed
 * 
 * Schedule: Every 4 hours (cron: 0 0,4,8,12,16,20 * * *)
 * Configured in: vercel.json
 * 
 * Security: Protected by CRON_SECRET environment variable
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { autoHedgingService } from '@/lib/services/AutoHedgingService';
import { recordNavSnapshot, initCommunityPoolTables } from '@/lib/db/community-pool';
import { ethers } from 'ethers';

// CommunityPool contract details
const COMMUNITY_POOL_ADDRESS = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
const COMMUNITY_POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function setTargetAllocation(uint256[4] newAllocationBps, string reasoning)',
];

interface CronResult {
  success: boolean;
  poolStats?: {
    totalNAV: string;
    memberCount: number;
    sharePrice: string;
    allocations: { BTC: number; ETH: number; SUI: number; CRO: number };
  };
  riskAssessment?: {
    riskScore: number;
    drawdownPercent: number;
    volatility: number;
    recommendations: number;
  };
  aiDecision?: {
    action: string;
    reasoning: string;
    executed: boolean;
  };
  hedgesExecuted?: number;
  duration: number;
  error?: string;
}

/**
 * Vercel Cron Job Handler
 * Invoked automatically every 4 hours
 */
export async function GET(request: NextRequest): Promise<NextResponse<CronResult>> {
  const startTime = Date.now();
  
  // Security: Verify request is from Vercel Cron
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('[CommunityPool Cron] Unauthorized request');
    return NextResponse.json(
      { success: false, error: 'Unauthorized', duration: Date.now() - startTime },
      { status: 401 }
    );
  }
  
  logger.info('[CommunityPool Cron] Starting scheduled pool management');
  
  try {
    // Step 1: Fetch on-chain pool stats
    const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
    const poolContract = new ethers.Contract(COMMUNITY_POOL_ADDRESS, COMMUNITY_POOL_ABI, provider);
    
    const stats = await poolContract.getPoolStats();
    const poolStats = {
      totalNAV: ethers.formatUnits(stats._totalNAV, 6),
      memberCount: Number(stats._memberCount),
      sharePrice: ethers.formatUnits(stats._sharePrice, 18),
      allocations: {
        BTC: Number(stats._allocations[0]) / 100,
        ETH: Number(stats._allocations[1]) / 100,
        SUI: Number(stats._allocations[2]) / 100,
        CRO: Number(stats._allocations[3]) / 100,
      },
    };
    
    logger.info('[CommunityPool Cron] Pool stats fetched', {
      totalNAV: `$${poolStats.totalNAV}`,
      memberCount: poolStats.memberCount,
      allocations: poolStats.allocations,
    });
    
    // Step 1.5: Record NAV snapshot for risk metrics history
    try {
      // Ensure tables exist (idempotent)
      await initCommunityPoolTables();
      
      await recordNavSnapshot({
        sharePrice: parseFloat(poolStats.sharePrice),
        totalNav: parseFloat(poolStats.totalNAV),
        totalShares: parseFloat(ethers.formatUnits(stats._totalShares, 18)),
        memberCount: poolStats.memberCount,
        allocations: poolStats.allocations,
        source: 'on-chain',
      });
      logger.info('[CommunityPool Cron] NAV snapshot recorded for risk metrics');
    } catch (navError) {
      logger.warn('[CommunityPool Cron] Failed to record NAV snapshot (non-critical)', { error: navError });
    }
    
    // Step 2: Run risk assessment via AutoHedgingService
    const riskAssessment = await autoHedgingService.triggerRiskAssessment(0, COMMUNITY_POOL_ADDRESS);
    
    logger.info('[CommunityPool Cron] Risk assessment complete', {
      riskScore: riskAssessment.riskScore,
      recommendations: riskAssessment.recommendations.length,
    });
    
    // Step 3: Get AI allocation decision
    let aiDecision = {
      action: 'HOLD',
      reasoning: 'Risk within acceptable parameters, no rebalancing needed',
      executed: false,
    };
    
    // Only trigger AI decision if risk is elevated
    if (riskAssessment.riskScore >= 4) {
      try {
        const aiResponse = await fetch(`${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/community-pool/ai-decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generateAllocation',
            marketConditions: {
              riskScore: riskAssessment.riskScore,
              drawdownPercent: riskAssessment.drawdownPercent,
              volatility: riskAssessment.volatility,
              currentAllocations: poolStats.allocations,
            },
          }),
        });
        
        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          
          // Check if AI recommends rebalancing
          if (aiData.recommendation?.shouldRebalance) {
            aiDecision = {
              action: 'REBALANCE',
              reasoning: aiData.recommendation.reasoning || 'AI recommends allocation adjustment',
              executed: false,
            };
            
            // Execute rebalancing if auto-approval is enabled
            const autoApprovalEnabled = process.env.COMMUNITY_POOL_AUTO_REBALANCE === 'true';
            const navThreshold = parseFloat(process.env.COMMUNITY_POOL_NAV_THRESHOLD || '100000');
            const currentNAV = parseFloat(poolStats.totalNAV);
            
            if (autoApprovalEnabled && currentNAV <= navThreshold) {
              logger.info('[CommunityPool Cron] Auto-executing rebalance', {
                newAllocations: aiData.recommendation.allocations,
              });
              
              // Note: On-chain execution requires signer - would need agent wallet
              // For now, log the recommendation
              aiDecision.executed = false;
              aiDecision.reasoning += ' (Manual execution required - no agent signer configured)';
            }
          }
        }
      } catch (aiError) {
        logger.warn('[CommunityPool Cron] AI decision fetch failed', { error: aiError });
      }
    }
    
    // Step 4: Count hedges executed by AutoHedgingService
    const hedgesExecuted = riskAssessment.recommendations.filter(r => r.confidence >= 0.7).length;
    
    const result: CronResult = {
      success: true,
      poolStats,
      riskAssessment: {
        riskScore: riskAssessment.riskScore,
        drawdownPercent: riskAssessment.drawdownPercent,
        volatility: riskAssessment.volatility,
        recommendations: riskAssessment.recommendations.length,
      },
      aiDecision,
      hedgesExecuted,
      duration: Date.now() - startTime,
    };
    
    logger.info('[CommunityPool Cron] Completed successfully', { 
      success: result.success,
      duration: result.duration,
      hedgesExecuted: result.hedgesExecuted,
      riskScore: result.riskAssessment?.riskScore,
    });
    
    return NextResponse.json(result);
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[CommunityPool Cron] Fatal error:', { error: errorMessage });
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Manual trigger for testing (POST)
 */
export async function POST(request: NextRequest): Promise<NextResponse<CronResult>> {
  logger.info('[CommunityPool Cron] Manual trigger via POST');
  return GET(request);
}
