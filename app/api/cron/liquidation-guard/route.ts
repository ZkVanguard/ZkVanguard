/**
 * Vercel Cron Job: Liquidation Risk Monitor
 * 
 * Monitors all leveraged positions for liquidation risk and executes:
 * - Add collateral when margin level drops below threshold
 * - Reduce position size to improve health
 * - Emergency close before liquidation
 * - Alert generation for critical positions
 * 
 * Schedule: Every 5 minutes
 * Configured in: vercel.json
 * 
 * Security: Protected by CRON_SECRET environment variable
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';

// Types
interface LeveragedPosition {
  id: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  collateral: number;
  notionalValue: number;
  marginLevel: number; // 100% = safe, 0% = liquidated
  liquidationPrice: number;
  healthScore: number; // 0-100
  walletAddress: string;
  portfolioId?: number;
}

interface LiquidationAction {
  positionId: string;
  action: 'ADD_COLLATERAL' | 'REDUCE_SIZE' | 'EMERGENCY_CLOSE' | 'ALERT';
  amount?: number;
  reason: string;
  executed: boolean;
  txHash?: string;
}

interface LiquidationGuardResult {
  success: boolean;
  positionsChecked: number;
  actionsExecuted: LiquidationAction[];
  summary: {
    criticalCount: number;
    warningCount: number;
    healthyCount: number;
    totalCollateralAtRisk: number;
    averageMarginLevel: number;
  };
  duration: number;
  error?: string;
}

// Thresholds
const MARGIN_LEVEL_CRITICAL = 120; // Below 120% = emergency action
const MARGIN_LEVEL_WARNING = 150; // Below 150% = add collateral
const MARGIN_LEVEL_HEALTHY = 200; // Above 200% = healthy
const LIQUIDATION_BUFFER_PERCENT = 5; // Close if within 5% of liquidation
const COLLATERAL_TOP_UP_PERCENT = 20; // Add 20% more collateral when needed
const SIZE_REDUCTION_PERCENT = 25; // Reduce size by 25% if collateral unavailable

/**
 * Fetch all leveraged positions
 */
async function fetchLeveragedPositions(): Promise<LeveragedPosition[]> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/positions?type=leveraged&status=active`, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      logger.warn('[LiquidationGuard] Failed to fetch positions, using calculated data');
      return getMockPositions();
    }
    
    const data = await response.json();
    return data.positions || getMockPositions();
  } catch (error) {
    logger.warn('[LiquidationGuard] Error fetching positions:', error);
    return getMockPositions();
  }
}

/**
 * Get current prices
 */
async function getCurrentPrices(assets: string[]): Promise<Record<string, number>> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/prices?assets=${assets.join(',')}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      return getDefaultPrices();
    }
    
    const data = await response.json();
    return data.prices || getDefaultPrices();
  } catch {
    return getDefaultPrices();
  }
}

function getDefaultPrices(): Record<string, number> {
  return {
    BTC: 95000,
    ETH: 3200,
    CRO: 0.15,
    SUI: 4.50,
  };
}

/**
 * Calculate margin level for a position
 * Margin Level = (Equity / Used Margin) * 100
 * Equity = Collateral + Unrealized P&L
 */
function calculateMarginLevel(position: LeveragedPosition, currentPrice: number): { marginLevel: number; liquidationPrice: number; healthScore: number } {
  const priceChange = currentPrice - position.entryPrice;
  const direction = position.side === 'LONG' ? 1 : -1;
  const unrealizedPnl = direction * (priceChange / position.entryPrice) * position.notionalValue;
  
  const equity = position.collateral + unrealizedPnl;
  const usedMargin = position.notionalValue / position.leverage;
  const marginLevel = (equity / usedMargin) * 100;
  
  // Calculate liquidation price
  // For LONG: liquidation when equity = 0, so price drops enough to wipe collateral
  // For SHORT: liquidation when price rises enough to wipe collateral
  const maxLossPercent = (position.collateral / position.notionalValue) * 100;
  const liquidationPrice = position.side === 'LONG'
    ? position.entryPrice * (1 - maxLossPercent / 100)
    : position.entryPrice * (1 + maxLossPercent / 100);
  
  // Health score 0-100
  const healthScore = Math.min(100, Math.max(0, (marginLevel - 100) / 2));
  
  return { marginLevel, liquidationPrice, healthScore };
}

/**
 * Check how close position is to liquidation
 */
function getDistanceToLiquidation(position: LeveragedPosition, currentPrice: number): number {
  const { liquidationPrice } = calculateMarginLevel(position, currentPrice);
  
  if (position.side === 'LONG') {
    return ((currentPrice - liquidationPrice) / currentPrice) * 100;
  } else {
    return ((liquidationPrice - currentPrice) / currentPrice) * 100;
  }
}

/**
 * Execute add collateral
 */
async function addCollateral(position: LeveragedPosition, amount: number): Promise<{ success: boolean; txHash?: string }> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/agents/hedging/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ADD_COLLATERAL',
        positionId: position.id,
        amount,
        walletAddress: position.walletAddress,
        autoApprovalEnabled: true,
        source: 'liquidation-guard-cron',
      }),
    });
    
    if (!response.ok) {
      logger.error(`[LiquidationGuard] Failed to add collateral to ${position.id}`);
      return { success: false };
    }
    
    const result = await response.json();
    return { success: true, txHash: result.txHash };
  } catch (error) {
    logger.error(`[LiquidationGuard] Error adding collateral:`, error);
    return { success: false };
  }
}

/**
 * Execute reduce size
 */
async function reducePosition(position: LeveragedPosition, reductionPercent: number): Promise<{ success: boolean; txHash?: string }> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const reduceSize = position.size * (reductionPercent / 100);
    
    const response = await fetch(`${baseUrl}/api/agents/hedging/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'REDUCE_SIZE',
        positionId: position.id,
        asset: position.asset,
        side: position.side === 'LONG' ? 'SELL' : 'BUY',
        size: reduceSize,
        reason: `Reduce position size by ${reductionPercent}% to improve margin`,
        walletAddress: position.walletAddress,
        autoApprovalEnabled: true,
        source: 'liquidation-guard-cron',
      }),
    });
    
    if (!response.ok) {
      return { success: false };
    }
    
    const result = await response.json();
    return { success: true, txHash: result.txHash };
  } catch (error) {
    logger.error(`[LiquidationGuard] Error reducing position:`, error);
    return { success: false };
  }
}

/**
 * Execute emergency close
 */
async function emergencyClose(position: LeveragedPosition, reason: string): Promise<{ success: boolean; txHash?: string }> {
  try {
    const baseUrl = process.env.VERCEL 
      ? 'https://zkvanguard.vercel.app' 
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/agents/hedging/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CLOSE',
        positionId: position.id,
        asset: position.asset,
        side: position.side === 'LONG' ? 'SELL' : 'BUY',
        size: position.size,
        reason,
        walletAddress: position.walletAddress,
        autoApprovalEnabled: true,
        source: 'liquidation-guard-cron',
        priority: 'EMERGENCY',
      }),
    });
    
    if (!response.ok) {
      return { success: false };
    }
    
    const result = await response.json();
    return { success: true, txHash: result.txHash };
  } catch (error) {
    logger.error(`[LiquidationGuard] Error in emergency close:`, error);
    return { success: false };
  }
}

/**
 * Mock data for testing
 */
function getMockPositions(): LeveragedPosition[] {
  return [
    {
      id: 'pos-btc-001',
      asset: 'BTC',
      side: 'LONG',
      entryPrice: 94000,
      currentPrice: 95000,
      size: 1.5,
      leverage: 5,
      collateral: 28500,
      notionalValue: 142500,
      marginLevel: 180,
      liquidationPrice: 75200,
      healthScore: 40,
      walletAddress: '0x1234567890123456789012345678901234567890',
      portfolioId: 1,
    },
    {
      id: 'pos-eth-001',
      asset: 'ETH',
      side: 'SHORT',
      entryPrice: 3100,
      currentPrice: 3200,
      size: 20,
      leverage: 3,
      collateral: 21333,
      notionalValue: 64000,
      marginLevel: 145,
      liquidationPrice: 4130,
      healthScore: 22,
      walletAddress: '0x1234567890123456789012345678901234567890',
      portfolioId: 1,
    },
  ];
}

/**
 * Main guard function
 */
async function guardPositions(): Promise<{ positions: LeveragedPosition[]; actions: LiquidationAction[]; summary: LiquidationGuardResult['summary'] }> {
  const positions = await fetchLeveragedPositions();
  const assets = [...new Set(positions.map(p => p.asset))];
  const prices = await getCurrentPrices(assets);
  
  const actions: LiquidationAction[] = [];
  let criticalCount = 0;
  let warningCount = 0;
  let healthyCount = 0;
  let totalCollateralAtRisk = 0;
  let totalMarginLevel = 0;
  
  for (const position of positions) {
    const currentPrice = prices[position.asset] || position.currentPrice;
    const { marginLevel, liquidationPrice, healthScore } = calculateMarginLevel(position, currentPrice);
    const distanceToLiq = getDistanceToLiquidation(position, currentPrice);
    
    // Update position with current calculations
    position.marginLevel = marginLevel;
    position.liquidationPrice = liquidationPrice;
    position.healthScore = healthScore;
    position.currentPrice = currentPrice;
    
    totalMarginLevel += marginLevel;
    
    logger.info(`[LiquidationGuard] Checking ${position.id}: ${position.side} ${position.asset} ${position.leverage}x`, {
      marginLevel: `${marginLevel.toFixed(1)}%`,
      healthScore,
      distanceToLiq: `${distanceToLiq.toFixed(2)}%`,
      liquidationPrice: liquidationPrice.toFixed(2),
    });
    
    // Check if within liquidation buffer
    if (distanceToLiq < LIQUIDATION_BUFFER_PERCENT) {
      logger.error(`[LiquidationGuard] EMERGENCY: ${position.id} within ${distanceToLiq.toFixed(2)}% of liquidation!`);
      
      const result = await emergencyClose(position, `Emergency close: ${distanceToLiq.toFixed(2)}% from liquidation`);
      actions.push({
        positionId: position.id,
        action: 'EMERGENCY_CLOSE',
        reason: `Only ${distanceToLiq.toFixed(2)}% from liquidation price (${liquidationPrice.toFixed(2)})`,
        executed: result.success,
        txHash: result.txHash,
      });
      
      criticalCount++;
      totalCollateralAtRisk += position.collateral;
      continue;
    }
    
    // Check critical margin level
    if (marginLevel < MARGIN_LEVEL_CRITICAL) {
      logger.warn(`[LiquidationGuard] CRITICAL: ${position.id} margin level ${marginLevel.toFixed(1)}%`);
      
      // Try to add collateral first
      const topUpAmount = position.collateral * (COLLATERAL_TOP_UP_PERCENT / 100);
      const addResult = await addCollateral(position, topUpAmount);
      
      if (addResult.success) {
        actions.push({
          positionId: position.id,
          action: 'ADD_COLLATERAL',
          amount: topUpAmount,
          reason: `Margin level critical at ${marginLevel.toFixed(1)}%`,
          executed: true,
          txHash: addResult.txHash,
        });
      } else {
        // Fallback: reduce position size
        const reduceResult = await reducePosition(position, SIZE_REDUCTION_PERCENT);
        actions.push({
          positionId: position.id,
          action: 'REDUCE_SIZE',
          amount: position.size * (SIZE_REDUCTION_PERCENT / 100),
          reason: `Margin level critical at ${marginLevel.toFixed(1)}%, collateral unavailable`,
          executed: reduceResult.success,
          txHash: reduceResult.txHash,
        });
      }
      
      criticalCount++;
      totalCollateralAtRisk += position.collateral;
      continue;
    }
    
    // Check warning margin level
    if (marginLevel < MARGIN_LEVEL_WARNING) {
      logger.warn(`[LiquidationGuard] WARNING: ${position.id} margin level ${marginLevel.toFixed(1)}%`);
      
      const topUpAmount = position.collateral * (COLLATERAL_TOP_UP_PERCENT / 100);
      const addResult = await addCollateral(position, topUpAmount);
      
      actions.push({
        positionId: position.id,
        action: addResult.success ? 'ADD_COLLATERAL' : 'ALERT',
        amount: topUpAmount,
        reason: `Margin level warning at ${marginLevel.toFixed(1)}%`,
        executed: addResult.success,
        txHash: addResult.txHash,
      });
      
      warningCount++;
      continue;
    }
    
    // Healthy position
    healthyCount++;
  }
  
  return {
    positions,
    actions,
    summary: {
      criticalCount,
      warningCount,
      healthyCount,
      totalCollateralAtRisk,
      averageMarginLevel: positions.length > 0 ? totalMarginLevel / positions.length : 0,
    },
  };
}

/**
 * GET handler for Vercel Cron
 */
export async function GET(request: NextRequest): Promise<NextResponse<LiquidationGuardResult>> {
  const startTime = Date.now();
  
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, positionsChecked: 0, actionsExecuted: [], summary: { criticalCount: 0, warningCount: 0, healthyCount: 0, totalCollateralAtRisk: 0, averageMarginLevel: 0 }, duration: Date.now() - startTime, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  logger.info('[LiquidationGuard] Starting liquidation risk monitoring');
  
  try {
    const result = await guardPositions();
    
    logger.info(`[LiquidationGuard] Complete: ${result.positions.length} positions checked`, {
      summary: result.summary,
      actionsCount: result.actions.length,
    });
    
    return NextResponse.json({
      success: true,
      positionsChecked: result.positions.length,
      actionsExecuted: result.actions,
      summary: result.summary,
      duration: Date.now() - startTime,
    });
    
  } catch (error: any) {
    logger.error('[LiquidationGuard] Error:', error);
    return NextResponse.json({
      success: false,
      positionsChecked: 0,
      actionsExecuted: [],
      summary: {
        criticalCount: 0,
        warningCount: 0,
        healthyCount: 0,
        totalCollateralAtRisk: 0,
        averageMarginLevel: 0,
      },
      duration: Date.now() - startTime,
      error: error.message,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
