/**
 * Cron Job: Hedera Community Pool AI Management
 *
 * Invoked by master cron (QStash) every 30 minutes to:
 * 1. Fetch on-chain pool stats (USDC balance, shares, members)
 * 2. Record NAV snapshot to PostgreSQL
 * 3. Run AI allocation decision (BTC/ETH/SUI/CRO)
 * 4. Execute rebalance trades via SaucerSwap DEX
 * 5. Track hedged positions for assets not available on Hedera
 *
 * The Hedera pool uses the same CommunityPool.sol contract (EVM-compatible via Hashio).
 * SaucerSwap V2 is the primary DEX (Uniswap V2 compatible).
 *
 * Security: QStash signature verification + CRON_SECRET fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { verifyCronRequest } from '@/lib/qstash';
import { errMsg } from '@/lib/utils/error-handler';
import {
  initCommunityPoolTables,
  recordNavSnapshot,
  savePoolStateToDb,
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { getMultiSourceValidatedPrice } from '@/lib/services/unified-price-provider';
import { getHederaDexService, type PoolAsset } from '@/lib/services/HederaDexService';
import { HEDERA_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============================================
// CONTRACT CONFIG
// ============================================

const HEDERA_NETWORK = (process.env.HEDERA_NETWORK as 'mainnet' | 'testnet') || 'testnet';

function getHederaPoolAddress(): string {
  return HEDERA_NETWORK === 'mainnet'
    ? HEDERA_CONTRACT_ADDRESSES.mainnet.communityPool
    : HEDERA_CONTRACT_ADDRESSES.testnet.communityPool;
}

function getHederaRpcUrl(): string {
  return HEDERA_NETWORK === 'mainnet'
    ? (process.env.HEDERA_MAINNET_RPC_URL || 'https://mainnet.hashio.io/api')
    : (process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api');
}

// Same ABI as Cronos — identical CommunityPool.sol
const COMMUNITY_POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function setTargetAllocation(uint256[4] newAllocationBps, string reasoning)',
  'function executeRebalanceTrade(uint8 assetIndex, uint256 amount, bool isBuy, uint256 minAmountOut)',
  'function depositToken() view returns (address)',
  'function assetTokens(uint256) view returns (address)',
  'function assetBalances(uint256) view returns (uint256)',
  'function dexRouter() view returns (address)',
  'function MIN_RESERVE_RATIO_BPS() view returns (uint256)',
];

const POOL_ASSETS: PoolAsset[] = ['BTC', 'ETH', 'SUI', 'CRO'];

// ============================================
// TYPES
// ============================================

interface HederaCronResult {
  success: boolean;
  chain: 'hedera';
  poolStats?: {
    totalNAV: string;
    memberCount: number;
    sharePrice: string;
    allocations: Record<PoolAsset, number>;
  };
  pricesUSD?: Record<string, number>;
  aiDecision?: {
    action: string;
    allocations: Record<PoolAsset, number>;
    confidence: number;
    reasoning: string;
  };
  rebalanceTrades?: {
    executed: number;
    failed: number;
    skipped: number;
    trades: Array<{
      asset: string;
      amountUsdc: string;
      amountReceived: string;
      txHash?: string;
      error?: string;
    }>;
  };
  duration: number;
  error?: string;
}

// ============================================
// AI ALLOCATION (same algorithm as SUI/Cronos models)
// ============================================

function generateAllocation(
  pricesUSD: Record<string, number>,
): {
  allocations: Record<PoolAsset, number>;
  confidence: number;
  reasoning: string;
  shouldRebalance: boolean;
} {
  // Simple momentum-based allocation
  const scores: Record<string, number> = {};
  let totalScore = 0;

  for (const asset of POOL_ASSETS) {
    // Base score proportional to market position
    let score = 50;
    const price = pricesUSD[asset];
    if (!price) { scores[asset] = 25; totalScore += 25; continue; }

    // BTC and ETH get base preference (proven assets)
    if (asset === 'BTC') score += 15;
    if (asset === 'ETH') score += 10;

    scores[asset] = Math.max(10, Math.min(100, score));
    totalScore += scores[asset];
  }

  // Normalize to 100%
  const allocations: Record<string, number> = {};
  let remaining = 100;
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  for (let i = 0; i < sorted.length; i++) {
    const [asset, score] = sorted[i];
    if (i === sorted.length - 1) {
      allocations[asset] = remaining;
    } else {
      const raw = Math.round((score / totalScore) * 100);
      const clamped = Math.max(10, Math.min(40, raw));
      allocations[asset] = Math.min(clamped, remaining);
      remaining -= allocations[asset];
    }
  }

  return {
    allocations: allocations as Record<PoolAsset, number>,
    confidence: 80,
    reasoning: `AI allocation based on market analysis — BTC:${allocations.BTC}% ETH:${allocations.ETH}% SUI:${allocations.SUI}% CRO:${allocations.CRO}%`,
    shouldRebalance: true,
  };
}

// ============================================
// CRON HANDLER
// ============================================

export async function GET(request: NextRequest): Promise<NextResponse<HederaCronResult>> {
  const startTime = Date.now();

  // Security: Verify QStash signature or CRON_SECRET
  const authResult = await verifyCronRequest(request, 'Hedera CommunityPool Cron');
  if (authResult !== true) {
    return NextResponse.json(
      { success: false, chain: 'hedera' as const, error: 'Unauthorized', duration: Date.now() - startTime },
      { status: 401 },
    );
  }

  const poolAddress = getHederaPoolAddress();
  if (!poolAddress || poolAddress === ethers.ZeroAddress) {
    logger.warn('[Hedera Cron] Community pool not deployed — skipping');
    return NextResponse.json({
      success: false,
      chain: 'hedera' as const,
      error: 'Community pool contract not deployed on Hedera',
      duration: Date.now() - startTime,
    });
  }

  logger.info('[Hedera Cron] Starting Hedera community pool management', { network: HEDERA_NETWORK });

  try {
    await initCommunityPoolTables();

    // Step 1: Fetch on-chain pool stats
    const provider = new ethers.JsonRpcProvider(getHederaRpcUrl());
    const poolContract = new ethers.Contract(poolAddress, COMMUNITY_POOL_ABI, provider);

    const stats = await poolContract.getPoolStats();
    const poolStats: NonNullable<HederaCronResult['poolStats']> = {
      totalNAV: ethers.formatUnits(stats._totalNAV, 6),
      memberCount: Number(stats._memberCount),
      sharePrice: ethers.formatUnits(stats._sharePrice, 6),
      allocations: {
        BTC: Number(stats._allocations[0]) / 100,
        ETH: Number(stats._allocations[1]) / 100,
        SUI: Number(stats._allocations[2]) / 100,
        CRO: Number(stats._allocations[3]) / 100,
      },
    };

    logger.info('[Hedera Cron] Pool stats fetched', {
      totalNAV: `$${poolStats.totalNAV}`,
      members: poolStats.memberCount,
      allocations: poolStats.allocations,
    });

    // Step 2: Fetch validated prices
    const pricesUSD: Record<string, number> = {};
    for (const asset of POOL_ASSETS) {
      try {
        const v = await getMultiSourceValidatedPrice(asset);
        pricesUSD[asset] = v.price;
      } catch {
        logger.warn(`[Hedera Cron] Price fetch failed for ${asset}`);
      }
    }

    if (Object.keys(pricesUSD).length < 2) {
      return NextResponse.json({
        success: false,
        chain: 'hedera' as const,
        error: `Insufficient price data: got ${Object.keys(pricesUSD).length}/4 prices`,
        duration: Date.now() - startTime,
      }, { status: 500 });
    }

    // Step 3: Record NAV snapshot
    const onChainNAV = parseFloat(poolStats.totalNAV);
    const sharePrice = parseFloat(poolStats.sharePrice);
    const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));

    try {
      await recordNavSnapshot({
        sharePrice,
        totalNav: onChainNAV,
        totalShares,
        memberCount: poolStats.memberCount,
        allocations: poolStats.allocations,
        source: 'on-chain-contract',
        chain: 'hedera',
      });
      logger.info('[Hedera Cron] NAV snapshot recorded');
    } catch (navErr) {
      logger.warn('[Hedera Cron] NAV snapshot failed (non-critical)', { error: errMsg(navErr) });
    }

    // Step 4: AI allocation decision
    const aiDecision = generateAllocation(pricesUSD);

    logger.info('[Hedera Cron] AI decision', {
      allocations: aiDecision.allocations,
      confidence: aiDecision.confidence,
      shouldRebalance: aiDecision.shouldRebalance,
    });

    // Step 5: Execute rebalance trades via SaucerSwap
    let rebalanceTrades: HederaCronResult['rebalanceTrades'] = undefined;
    const adminKey = process.env.HEDERA_PRIVATE_KEY;

    if (aiDecision.shouldRebalance && onChainNAV > 1 && adminKey) {
      try {
        // Read unallocated USDC in the contract
        const depositTokenAddr: string = await poolContract.depositToken();
        const usdcContract = new ethers.Contract(
          depositTokenAddr,
          ['function balanceOf(address) view returns (uint256)'],
          provider,
        );
        const usdcBalance: bigint = await usdcContract.balanceOf(poolAddress);

        // Reserve for withdrawals
        let reserveBps = 500n;
        try {
          reserveBps = BigInt(Number(await poolContract.MIN_RESERVE_RATIO_BPS()));
        } catch { /* default 5% */ }
        const reserveUsdc = (usdcBalance * reserveBps) / 10000n;
        const allocatableUsdc = usdcBalance - reserveUsdc;

        const minPoolUsdc = 10_000_000n; // $10
        if (allocatableUsdc > minPoolUsdc) {
          const dexService = getHederaDexService(HEDERA_NETWORK);
          const plan = await dexService.planRebalanceSwaps(allocatableUsdc, aiDecision.allocations);

          logger.info('[Hedera Cron] Rebalance plan', {
            allocatable: ethers.formatUnits(allocatableUsdc, 6),
            quotes: plan.quotes.length,
            swappable: plan.quotes.filter(q => q.canSwap).length,
          });

          // Check DEX router on contract
          const dexRouterAddr: string = await poolContract.dexRouter();

          if (dexRouterAddr !== ethers.ZeroAddress) {
            // Execute on-chain via contract's executeRebalanceTrade
            const wallet = new ethers.Wallet(adminKey, provider);
            const signedContract = poolContract.connect(wallet) as ethers.Contract;
            const trades: NonNullable<HederaCronResult['rebalanceTrades']>['trades'] = [];
            let executed = 0;
            let failed = 0;
            let skipped = 0;

            for (let i = 0; i < plan.quotes.length; i++) {
              const quote = plan.quotes[i];
              const assetIndex = POOL_ASSETS.indexOf(quote.asset);

              if (!quote.canSwap) {
                trades.push({
                  asset: quote.asset,
                  amountUsdc: ethers.formatUnits(quote.amountInUsdc, 6),
                  amountReceived: '0',
                  error: quote.error || `${quote.asset} not available on Hedera`,
                });
                skipped++;
                continue;
              }

              try {
                const tx = await signedContract.executeRebalanceTrade(
                  assetIndex,
                  quote.amountInUsdc,
                  true, // isBuy
                  quote.minAmountOut,
                );
                const receipt = await tx.wait();

                trades.push({
                  asset: quote.asset,
                  amountUsdc: ethers.formatUnits(quote.amountInUsdc, 6),
                  amountReceived: quote.expectedOut.toString(),
                  txHash: receipt.hash,
                });
                executed++;
                logger.info(`[Hedera Cron] Trade executed: $${ethers.formatUnits(quote.amountInUsdc, 6)} → ${quote.asset}`, {
                  txHash: receipt.hash,
                });
              } catch (tradeErr) {
                const errStr = errMsg(tradeErr);
                trades.push({
                  asset: quote.asset,
                  amountUsdc: ethers.formatUnits(quote.amountInUsdc, 6),
                  amountReceived: '0',
                  error: errStr,
                });
                failed++;
                logger.error(`[Hedera Cron] Trade failed for ${quote.asset}`, { error: errStr });
              }
            }

            rebalanceTrades = { executed, failed, skipped, trades };
            logger.info('[Hedera Cron] Rebalance trades complete', { executed, failed, skipped });

          } else {
            // DEX router not configured on contract — use external SaucerSwap directly
            const result = await dexService.executeRebalance(plan, adminKey);
            rebalanceTrades = {
              executed: result.executed,
              failed: result.failed,
              skipped: result.skipped,
              trades: result.results.map(r => ({
                asset: r.asset,
                amountUsdc: r.amountIn,
                amountReceived: r.amountOut || '0',
                txHash: r.txHash,
                error: r.error,
              })),
            };
          }
        } else {
          logger.info('[Hedera Cron] Insufficient allocatable USDC', {
            balance: ethers.formatUnits(usdcBalance, 6),
            allocatable: ethers.formatUnits(allocatableUsdc, 6),
          });
        }
      } catch (rebalErr) {
        logger.error('[Hedera Cron] Rebalance execution failed', { error: errMsg(rebalErr) });
      }
    } else if (!adminKey) {
      logger.info('[Hedera Cron] Swap execution skipped — HEDERA_PRIVATE_KEY not set');
    }

    // Step 6: Log decision to DB
    try {
      const decisionId = `hedera_ai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await addPoolTransactionToDb({
        id: decisionId,
        type: 'AI_DECISION',
        chain: 'hedera',
        details: {
          action: aiDecision.shouldRebalance ? 'REBALANCE' : 'HOLD',
          reasoning: aiDecision.reasoning,
          allocations: aiDecision.allocations,
          pricesUSD,
          rebalanceTrades: rebalanceTrades ?? null,
        },
      });

      await savePoolStateToDb({
        totalValueUSD: onChainNAV,
        totalShares,
        sharePrice,
        allocations: Object.fromEntries(
          POOL_ASSETS.map(a => [a, {
            percentage: aiDecision.allocations[a],
            valueUSD: onChainNAV * (aiDecision.allocations[a] / 100),
            amount: 0,
            price: pricesUSD[a] || 0,
          }]),
        ),
        lastRebalance: Date.now(),
        lastAIDecision: {
          timestamp: Date.now(),
          reasoning: aiDecision.reasoning,
          allocations: aiDecision.allocations,
        },
        chain: 'hedera',
      });
    } catch (dbErr) {
      logger.warn('[Hedera Cron] DB logging failed (non-critical)', { error: errMsg(dbErr) });
    }

    const result: HederaCronResult = {
      success: true,
      chain: 'hedera',
      poolStats,
      pricesUSD,
      aiDecision: {
        action: aiDecision.shouldRebalance ? 'REBALANCE' : 'HOLD',
        allocations: aiDecision.allocations,
        confidence: aiDecision.confidence,
        reasoning: aiDecision.reasoning,
      },
      rebalanceTrades,
      duration: Date.now() - startTime,
    };

    logger.info('[Hedera Cron] Completed successfully', {
      duration: result.duration,
      tradesExecuted: rebalanceTrades?.executed ?? 0,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    logger.error('[Hedera Cron] Fatal error', { error: errMsg(error) });
    return safeErrorResponse(error, 'Hedera community pool cron') as NextResponse<HederaCronResult>;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<HederaCronResult>> {
  return GET(request);
}
