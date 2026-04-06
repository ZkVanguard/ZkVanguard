/**
 * Cron Job: WDK Community Pool Cross-Chain Management
 *
 * Manages the Tether WDK cross-chain USDT pool:
 * 1. Aggregates USDT balances across Sepolia, Cronos, Hedera, Plasma, Stable
 * 2. Records cross-chain NAV snapshot
 * 3. Monitors bridge health and gas reserves
 * 4. Triggers cross-chain rebalancing when allocation drifts
 *
 * The WDK pool uses USD₮/USD₮0 tokens across multiple EVM chains,
 * unified via the Tether Wallet Development Kit.
 *
 * Security: QStash signature verification + CRON_SECRET fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { errMsg } from '@/lib/utils/error-handler';
import {
  initCommunityPoolTables,
  recordNavSnapshot,
  savePoolStateToDb,
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { getWdkBridgeService, type WdkChainKey, type ChainBalance } from '@/lib/services/WdkBridgeService';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============================================
// TYPES
// ============================================

interface WdkCronResult {
  success: boolean;
  chain: 'wdk';
  crossChainState?: {
    totalUsdtAcrossChains: number;
    chainBalances: Array<{
      chain: string;
      usdtBalance: string;
      nativeBalance: string;
      hasGas: boolean;
    }>;
  };
  healthCheck?: {
    chainsOnline: number;
    chainsTotal: number;
    chainsWithGas: number;
    chainsWithUsdt: number;
    warnings: string[];
  };
  rebalance?: {
    needed: boolean;
    reason?: string;
    actions?: Array<{
      from: string;
      to: string;
      amount: string;
      status: string;
    }>;
  };
  duration: number;
  error?: string;
}

// Target allocation across chains (percentage of total USDT)
const CHAIN_ALLOCATION_TARGETS: Partial<Record<WdkChainKey, number>> = {
  'sepolia': 30,         // WDK primary testnet
  'cronos-mainnet': 30,  // Production chain
  'hedera-mainnet': 20,  // Hedera ecosystem
  'plasma': 10,          // USD₮0 bridge reserve
  'stable': 10,          // USD₮0 bridge reserve
};

const DRIFT_THRESHOLD = 15; // Rebalance if allocation drifts >15% from target

// ============================================
// HANDLER
// ============================================

export async function GET(request: NextRequest): Promise<NextResponse<WdkCronResult>> {
  const startTime = Date.now();

  const authResult = await verifyCronRequest(request, 'WDK CommunityPool Cron');
  if (authResult !== true) {
    return NextResponse.json(
      { success: false, chain: 'wdk' as const, error: 'Unauthorized', duration: Date.now() - startTime },
      { status: 401 },
    );
  }

  logger.info('[WDK Cron] Starting WDK cross-chain pool management');

  const bridge = getWdkBridgeService();
  if (!bridge) {
    return NextResponse.json({
      success: false,
      chain: 'wdk' as const,
      error: 'WDK Bridge service not configured (TREASURY_PRIVATE_KEY missing)',
      duration: Date.now() - startTime,
    });
  }

  try {
    await initCommunityPoolTables();

    // Step 1: Aggregate cross-chain balances
    const crossChainState = await bridge.getCrossChainBalances();

    logger.info('[WDK Cron] Cross-chain balances', {
      total: crossChainState.totalUsdtAcrossChains.toFixed(2),
      chains: crossChainState.chainBalances.map(b => `${b.chain}: $${b.usdtBalance}`),
    });

    // Step 2: Health check
    const warnings: string[] = [];
    const chainsOnline = crossChainState.chainBalances.length;
    const chainsWithGas = crossChainState.chainBalances.filter(b => b.hasGas).length;
    const chainsWithUsdt = crossChainState.chainBalances.filter(b => parseFloat(b.usdtBalance) > 0).length;

    for (const balance of crossChainState.chainBalances) {
      if (!balance.hasGas && balance.usdtConfigured) {
        warnings.push(`${balance.chainName}: Low gas — cannot execute transactions`);
      }
      if (!balance.usdtConfigured) {
        warnings.push(`${balance.chainName}: USDT not deployed yet`);
      }
    }

    const healthCheck = {
      chainsOnline,
      chainsTotal: 5,
      chainsWithGas,
      chainsWithUsdt,
      warnings,
    };

    // Step 3: Record NAV snapshot
    try {
      await recordNavSnapshot({
        sharePrice: 1, // USDT ≈ $1
        totalNav: crossChainState.totalUsdtAcrossChains,
        totalShares: crossChainState.totalUsdtAcrossChains, // 1:1 USDT
        memberCount: 0,
        allocations: Object.fromEntries(
          crossChainState.chainBalances.map(b => [
            b.chain,
            crossChainState.totalUsdtAcrossChains > 0
              ? (parseFloat(b.usdtBalance) / crossChainState.totalUsdtAcrossChains) * 100
              : 0,
          ]),
        ),
        source: 'wdk-cross-chain',
        chain: 'wdk',
      });
    } catch (navErr) {
      logger.warn('[WDK Cron] NAV snapshot failed (non-critical)', { error: errMsg(navErr) });
    }

    // Step 4: Check if cross-chain rebalancing is needed
    let rebalance: WdkCronResult['rebalance'] = { needed: false };

    if (crossChainState.totalUsdtAcrossChains > 10) { // Only rebalance if meaningful balance
      const currentAllocations: Partial<Record<WdkChainKey, number>> = {};
      for (const balance of crossChainState.chainBalances) {
        currentAllocations[balance.chain] = crossChainState.totalUsdtAcrossChains > 0
          ? (parseFloat(balance.usdtBalance) / crossChainState.totalUsdtAcrossChains) * 100
          : 0;
      }

      // Check drift
      let maxDrift = 0;
      let driftReason = '';
      for (const [chain, target] of Object.entries(CHAIN_ALLOCATION_TARGETS)) {
        const current = currentAllocations[chain as WdkChainKey] || 0;
        const drift = Math.abs(current - target);
        if (drift > maxDrift) {
          maxDrift = drift;
          driftReason = `${chain}: ${current.toFixed(1)}% vs target ${target}%`;
        }
      }

      if (maxDrift > DRIFT_THRESHOLD) {
        rebalance = {
          needed: true,
          reason: `Max drift ${maxDrift.toFixed(1)}% exceeds threshold ${DRIFT_THRESHOLD}% — ${driftReason}`,
          actions: [],
        };

        logger.info('[WDK Cron] Cross-chain rebalance triggered', { maxDrift, driftReason });

        // Plan rebalance transfers
        // Find overweight and underweight chains
        const overweight: Array<{ chain: WdkChainKey; excess: number }> = [];
        const underweight: Array<{ chain: WdkChainKey; deficit: number }> = [];

        for (const [chain, target] of Object.entries(CHAIN_ALLOCATION_TARGETS)) {
          const current = currentAllocations[chain as WdkChainKey] || 0;
          const diff = current - target;
          const diffUsdt = (diff / 100) * crossChainState.totalUsdtAcrossChains;

          if (diff > DRIFT_THRESHOLD && diffUsdt > 5) {
            overweight.push({ chain: chain as WdkChainKey, excess: diffUsdt });
          } else if (diff < -DRIFT_THRESHOLD && Math.abs(diffUsdt) > 5) {
            underweight.push({ chain: chain as WdkChainKey, deficit: Math.abs(diffUsdt) });
          }
        }

        // Execute bridges from overweight → underweight
        for (const over of overweight) {
          for (const under of underweight) {
            if (over.excess <= 0 || under.deficit <= 0) continue;

            const transferAmount = Math.min(over.excess, under.deficit);
            const amountStr = transferAmount.toFixed(2);

            try {
              const result = await bridge.bridgeUsdt(over.chain, under.chain, amountStr);
              rebalance.actions!.push({
                from: over.chain,
                to: under.chain,
                amount: amountStr,
                status: result.success ? 'executed' : `failed: ${result.error}`,
              });

              if (result.success) {
                over.excess -= transferAmount;
                under.deficit -= transferAmount;
              }
            } catch (err) {
              rebalance.actions!.push({
                from: over.chain,
                to: under.chain,
                amount: amountStr,
                status: `error: ${errMsg(err)}`,
              });
            }
          }
        }
      }
    }

    // Step 5: Log to DB
    try {
      const decisionId = `wdk_cron_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await addPoolTransactionToDb({
        id: decisionId,
        type: 'AI_DECISION',
        chain: 'wdk',
        details: {
          action: rebalance.needed ? 'CROSS_CHAIN_REBALANCE' : 'MONITOR',
          crossChainState: {
            total: crossChainState.totalUsdtAcrossChains,
            chains: crossChainState.chainBalances.map(b => ({
              chain: b.chain, usdt: b.usdtBalance,
            })),
          },
          healthCheck,
          rebalance,
        },
      });

      await savePoolStateToDb({
        totalValueUSD: crossChainState.totalUsdtAcrossChains,
        totalShares: crossChainState.totalUsdtAcrossChains,
        sharePrice: 1,
        allocations: Object.fromEntries(
          crossChainState.chainBalances.map(b => [b.chain, {
            percentage: crossChainState.totalUsdtAcrossChains > 0
              ? (parseFloat(b.usdtBalance) / crossChainState.totalUsdtAcrossChains) * 100
              : 0,
            valueUSD: parseFloat(b.usdtBalance),
            amount: parseFloat(b.usdtBalance),
            price: 1,
          }]),
        ),
        lastRebalance: Date.now(),
        lastAIDecision: {
          timestamp: Date.now(),
          reasoning: rebalance.needed
            ? `Cross-chain rebalance: ${rebalance.reason}`
            : 'All chains within allocation targets',
          allocations: CHAIN_ALLOCATION_TARGETS as Record<string, number>,
        },
        chain: 'wdk',
      });
    } catch (dbErr) {
      logger.warn('[WDK Cron] DB save failed (non-critical)', { error: errMsg(dbErr) });
    }

    const result: WdkCronResult = {
      success: true,
      chain: 'wdk',
      crossChainState: {
        totalUsdtAcrossChains: crossChainState.totalUsdtAcrossChains,
        chainBalances: crossChainState.chainBalances.map(b => ({
          chain: b.chain,
          usdtBalance: b.usdtBalance,
          nativeBalance: b.nativeBalance,
          hasGas: b.hasGas,
        })),
      },
      healthCheck,
      rebalance,
      duration: Date.now() - startTime,
    };

    logger.info('[WDK Cron] Complete', {
      totalUsdt: crossChainState.totalUsdtAcrossChains.toFixed(2),
      chainsOnline,
      rebalanceNeeded: rebalance.needed,
      duration: result.duration,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    logger.error('[WDK Cron] Fatal error', { error: errMsg(error) });
    return NextResponse.json({
      success: false,
      chain: 'wdk' as const,
      error: errMsg(error),
      duration: Date.now() - startTime,
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<WdkCronResult>> {
  return GET(request);
}
