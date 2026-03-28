/**
 * SUI Community Pool API (USDC Deposits, 4-Asset AI-Managed)
 * 
 * Endpoints:
 * - GET  /api/sui/community-pool                          - Get pool summary with 4-asset allocation
 * - GET  /api/sui/community-pool?user=0x...               - Get user's position (USDC-denominated)
 * - GET  /api/sui/community-pool?action=members           - Get all members
 * - GET  /api/sui/community-pool?action=contract          - Get contract info (USDC coin type etc)
 * - GET  /api/sui/community-pool?action=allocation        - Get current 4-asset allocation
 * - GET  /api/sui/community-pool?action=swap-quote        - Get Cetus aggregator swap quote
 * - GET  /api/sui/community-pool?action=admin-wallet      - Check admin wallet status
 * - GET  /api/sui/community-pool?action=user-position     - Get user position from DB
 * - POST /api/sui/community-pool?action=deposit           - Build USDC deposit tx params
 * - POST /api/sui/community-pool?action=withdraw          - Build withdrawal tx params
 * - POST /api/sui/community-pool?action=execute-deposit-swaps   - Swap deposited USDC → 4 assets
 * - POST /api/sui/community-pool?action=execute-withdraw-swaps  - Swap assets → USDC for withdrawal
 * - POST /api/sui/community-pool?action=record-deposit    - Record USDC deposit + execute swaps + mint shares
 * - POST /api/sui/community-pool?action=record-withdraw   - Burn shares + execute reverse swaps + record withdrawal
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { getSuiUsdcPoolService } from '@/lib/services/SuiCommunityPoolService';
import { getCetusAggregatorService, type PoolAsset } from '@/lib/services/CetusAggregatorService';
import { readLimiter, mutationLimiter } from '@/lib/security/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type NetworkType = 'testnet' | 'mainnet';

function getNetwork(request: NextRequest): NetworkType {
  const url = new URL(request.url);
  const network = url.searchParams.get('network');
  if (network === 'mainnet' || network === 'testnet') return network;
  // Default to env var, then testnet as safe fallback
  return (process.env.SUI_NETWORK as NetworkType) || 'testnet';
}

/** JSON response with CDN cache headers */
function cachedJsonResponse(data: unknown, cdnTtlSeconds: number = 30) {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `s-maxage=${cdnTtlSeconds}, stale-while-revalidate=${cdnTtlSeconds * 2}`,
    },
  });
}

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(request: NextRequest) {
  // Rate limit
  const limited = readLimiter.check(request);
  if (limited) return limited;

  const startTime = Date.now();
  
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const user = url.searchParams.get('user');
    const network = getNetwork(request);
    
    logger.info('[SUI-API] Request', { action, user, network });
    
    const service = getSuiUsdcPoolService(network);
    
    // Get Cetus aggregator swap quote
    if (action === 'swap-quote') {
      const asset = (url.searchParams.get('asset') || 'BTC').toUpperCase() as PoolAsset;
      const amountStr = url.searchParams.get('amount') || '100';
      const amount = parseFloat(amountStr);
      
      if (!['BTC', 'ETH', 'SUI', 'CRO'].includes(asset)) {
        return NextResponse.json(
          { success: false, error: 'Invalid asset. Use BTC, ETH, SUI, or CRO' },
          { status: 400 }
        );
      }
      if (isNaN(amount) || amount <= 0 || amount > 1_000_000) {
        return NextResponse.json(
          { success: false, error: 'Invalid amount (1-1000000 USDC)' },
          { status: 400 }
        );
      }

      const aggregator = getCetusAggregatorService(network);
      const quote = await aggregator.getSwapQuote(asset, amount);

      return cachedJsonResponse({
        success: true,
        data: {
          asset: quote.asset,
          fromCoinType: quote.fromCoinType,
          toCoinType: quote.toCoinType,
          amountInUsdc: (Number(quote.amountIn) / 1e6).toFixed(2),
          expectedAmountOut: quote.expectedAmountOut,
          priceImpact: quote.priceImpact,
          route: quote.route,
          canSwapOnChain: quote.canSwapOnChain,
          isSimulated: quote.isSimulated,
          hedgeVia: quote.hedgeVia,
        },
        chain: 'sui',
        network,
        duration: Date.now() - startTime,
      }, 15);
    }

    // Check admin wallet status (for swap execution readiness)
    if (action === 'admin-wallet') {
      const aggregator = getCetusAggregatorService(network);
      const wallet = await aggregator.checkAdminWallet();
      return NextResponse.json({
        success: true,
        data: {
          configured: wallet.configured,
          address: wallet.address,
          suiBalance: wallet.suiBalance,
          hasGas: wallet.hasGas,
          swapsEnabled: wallet.configured && wallet.hasGas,
        },
        chain: 'sui',
      });
    }

    // Get user position from database (for USDC pool)
    if (action === 'user-position') {
      const wallet = url.searchParams.get('wallet');
      if (!wallet || !/^0x[a-fA-F0-9]{64}$/.test(wallet)) {
        return NextResponse.json(
          { success: false, error: 'Valid SUI wallet address required (0x + 64 hex chars)' },
          { status: 400 }
        );
      }

      const { getUserSharesFromDb, getUserTransactionCounts } = await import('@/lib/db/community-pool');
      const userShares = await getUserSharesFromDb(wallet, 'sui');
      const txCounts = await getUserTransactionCounts(wallet);

      if (!userShares) {
        return NextResponse.json({
          success: true,
          data: {
            isMember: false,
            wallet,
            shares: 0,
            valueUsdc: 0,
            costBasisUsd: 0,
            depositCount: txCounts.depositCount,
            withdrawalCount: txCounts.withdrawalCount,
          },
          chain: 'sui',
          network,
        });
      }

      // 1 share = 1 USDC for USDC pool
      const valueUsdc = userShares.shares;

      return NextResponse.json({
        success: true,
        data: {
          isMember: true,
          wallet,
          shares: userShares.shares,
          valueUsdc,
          costBasisUsd: userShares.cost_basis_usd,
          joinedAt: userShares.joined_at,
          lastActionAt: userShares.last_action_at,
          depositCount: txCounts.depositCount,
          withdrawalCount: txCounts.withdrawalCount,
        },
        chain: 'sui',
        network,
      });
    }

    // Get contract info
    if (action === 'contract') {
      const info = service.getContractInfo();
      // Also include the deployed SUI-native pool contract info
      const { getSuiCommunityPoolService } = await import('@/lib/services/SuiCommunityPoolService');
      const nativeInfo = getSuiCommunityPoolService(network).getContractInfo();
      
      // Check BlueFin hedging status
      const bluefinConfigured = !!process.env.BLUEFIN_PRIVATE_KEY;
      
      return NextResponse.json({
        success: true,
        data: {
          ...info,
          // If USDC pool not deployed, show native pool contract as deployed reference
          deployedPackageId: info.packageId || nativeInfo.packageId,
          nativePoolPackageId: nativeInfo.packageId,
          nativePoolStateId: nativeInfo.poolStateId,
          hedgeExecutorStateId: bluefinConfigured ? 'bluefin-perps' : undefined,
          bluefinConfigured,
        },
        chain: 'sui',
        network,
      });
    }

    // Get current 4-asset allocation (AI-managed)
    if (action === 'allocation') {
      // Use SuiPoolAgent for dynamic AI allocation when possible
      try {
        const { getSuiPoolAgent } = await import('@/agents/specialized/SuiPoolAgent');
        const agent = getSuiPoolAgent(network);
        const indicators = await agent.analyzeMarket();
        const decision = agent.generateAllocation(indicators);
        
        return NextResponse.json({
          success: true,
          data: {
            allocation: decision.allocations,
            description: '4-asset AI-managed allocation for USDC deposits',
            assets: ['BTC', 'ETH', 'SUI', 'CRO'],
            rebalanceFrequency: 'daily',
            confidence: decision.confidence,
            reasoning: decision.reasoning,
            shouldRebalance: decision.shouldRebalance,
            swappableAssets: decision.swappableAssets,
            hedgedAssets: decision.hedgedAssets,
            riskScore: decision.riskScore,
            source: 'ai-agent',
          },
          chain: 'sui',
          network,
          duration: Date.now() - startTime,
        });
      } catch (err) {
        // Fallback to static allocation if agent fails
        logger.warn('[SUI-API] SuiPoolAgent failed, using static allocation', {
          error: err instanceof Error ? err.message : err,
          stack: err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
        });
        const allocation = {
          BTC: 30,
          ETH: 30,
          SUI: 25,
          CRO: 15,
        };
        return NextResponse.json({
          success: true,
          data: {
            allocation,
            description: '4-asset AI-managed allocation for USDC deposits',
            assets: ['BTC', 'ETH', 'SUI', 'CRO'],
            rebalanceFrequency: 'daily',
            source: 'static-fallback',
          },
          chain: 'sui',
          network,
          duration: Date.now() - startTime,
        });
      }
    }
    
    // Get all members (cached 2m)
    if (action === 'members') {
      const members = await service.getAllMembers();
      return cachedJsonResponse({
        success: true,
        data: {
          members,
          count: members.length,
        },
        chain: 'sui',
        network,
      }, 60);
    }
    
    // Get specific user's position — single getPoolStats() call shared
    if (user) {
      const [position, stats] = await Promise.all([
        service.getMemberPosition(user),
        service.getPoolStats(),
      ]);
      
      // Calculate percentage of pool
      const percentage = stats.totalShares > 0 && position.shares > 0
        ? (position.shares / stats.totalShares) * 100
        : 0;
      
      return cachedJsonResponse({
        success: true,
        data: {
          address: position.address,
          shares: position.shares.toFixed(4),
          valueSui: position.valueSui.toFixed(4),
          valueUsd: position.valueUsd.toFixed(2),
          percentage: percentage.toFixed(4),
          joinedAt: position.joinedAt,
          depositedSui: position.depositedSui.toFixed(4),
          withdrawnSui: position.withdrawnSui.toFixed(4),
          isMember: position.isMember,
        },
        pool: {
          totalShares: stats.totalShares.toFixed(4),
          totalNAV: stats.totalNAV.toFixed(4),
          totalNAVUsd: stats.totalNAVUsd.toFixed(2),
          memberCount: stats.memberCount,
          sharePrice: stats.sharePrice.toFixed(6),
        },
        chain: 'sui',
        network,
        duration: Date.now() - startTime,
      }, 15);
    }
    
    // Default: Get pool summary (cached 30s)
    const stats = await service.getPoolStats();
    
    return cachedJsonResponse({
      success: true,
      data: {
        totalShares: stats.totalShares.toFixed(4),
        totalNAV: stats.totalNAV.toFixed(4),
        totalNAVUsd: stats.totalNAVUsd.toFixed(2),
        sharePrice: stats.sharePrice.toFixed(6),
        sharePriceUsd: stats.sharePriceUsd.toFixed(6),
        memberCount: stats.memberCount,
        managementFeeBps: stats.managementFeeBps,
        performanceFeeBps: stats.performanceFeeBps,
        paused: stats.paused,
        poolStateId: stats.poolStateId,
      },
      chain: 'sui',
      network,
      duration: Date.now() - startTime,
    }, 30);
    
  } catch (error) {
    logger.error('[SUI-API] Error', { error });
    
    return NextResponse.json(
      {
        success: false,
        error: 'Service temporarily unavailable',
        chain: 'sui',
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST Handler - Deposit/Withdraw params
// ============================================================================

export async function POST(request: NextRequest) {
  // Rate limit mutations
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const network = getNetwork(request);
    
    const body = await request.json();
    const service = getSuiUsdcPoolService(network);
    
    logger.info('[SUI-API] POST request', { action, network, body });
    
    // Build deposit transaction params
    if (action === 'deposit') {
      const { amount } = body;
      if (!amount) {
        return NextResponse.json(
          { success: false, error: 'Amount required (in MIST or SUI)' },
          { status: 400 }
        );
      }
      
      // Fetch pool stats first to ensure poolStateId is cached
      await service.getPoolStats();
      
      // For USDC pool: amount is in USDC atomic units (6 decimals)
      // 1 USDC = 1,000,000 (6 decimals)
      const amountRaw = BigInt(amount);
      const amountUsdc = Number(amountRaw) / 1_000_000;
      
      const params = service.buildDepositParams(amountUsdc);

      // Clear caches so next poll returns fresh data
      service.clearCaches();

      return NextResponse.json({
        success: true,
        data: {
          target: params.target,
          poolStateId: params.poolStateId,
          amountRaw: params.amountRaw.toString(),
          clockId: params.clockId,
          usdcCoinType: params.usdcCoinType,
          typeArg: params.typeArg,
        },
        chain: 'sui',
        network,
      });
    }
    
    // Build withdraw transaction params
    if (action === 'withdraw') {
      const { shares } = body;
      if (!shares) {
        return NextResponse.json(
          { success: false, error: 'Shares required (scaled by 10^18)' },
          { status: 400 }
        );
      }
      
      // Fetch pool stats first to ensure poolStateId is cached
      await service.getPoolStats();
      
      // USDC pool uses 6 decimals for shares
      const sharesScaled = BigInt(shares);
      const sharesNum = Number(sharesScaled) / 1e6;
      
      const params = service.buildWithdrawParams(sharesNum);

      // Clear caches so next poll returns fresh data
      service.clearCaches();

      return NextResponse.json({
        success: true,
        data: {
          target: params.target,
          poolStateId: params.poolStateId,
          sharesScaled: params.sharesScaled.toString(),
          clockId: params.clockId,
          typeArg: params.typeArg,
        },
        chain: 'sui',
        network,
      });
    }
    
    // Execute post-deposit swaps: USDC → 4 assets per AI allocation
    if (action === 'execute-deposit-swaps') {
      const { amountUsdc, allocations } = body;

      if (!amountUsdc || typeof amountUsdc !== 'number' || amountUsdc <= 0) {
        return NextResponse.json(
          { success: false, error: 'amountUsdc required (positive number)' },
          { status: 400 }
        );
      }
      if (!allocations || typeof allocations !== 'object') {
        return NextResponse.json(
          { success: false, error: 'allocations required (e.g. { BTC: 30, ETH: 30, SUI: 25, CRO: 15 })' },
          { status: 400 }
        );
      }

      const aggregator = getCetusAggregatorService(network);

      // Verify admin wallet first
      const wallet = await aggregator.checkAdminWallet();
      if (!wallet.configured || !wallet.hasGas) {
        return NextResponse.json(
          { success: false, error: 'Admin wallet not configured or insufficient gas' },
          { status: 503 }
        );
      }

      // Plan swaps based on deposit amount + allocations
      const plan = await aggregator.planRebalanceSwaps(
        amountUsdc,
        allocations as Record<import('@/lib/services/CetusAggregatorService').PoolAsset, number>,
      );

      const onChainSwaps = plan.swaps.filter(s => s.canSwapOnChain && s.routerData);
      const simulatedSwaps = plan.swaps.filter(s => s.isSimulated || !s.canSwapOnChain);

      if (onChainSwaps.length === 0) {
        // No real on-chain swaps, but still return simulated positions for tracking
        return NextResponse.json({
          success: true,
          data: {
            message: 'No on-chain swaps available — positions tracked by price',
            plan,
            simulatedPositions: simulatedSwaps.map(s => ({
              asset: s.asset,
              usdcAllocated: (Number(s.amountIn) / 1e6).toFixed(2),
              estimatedQty: s.expectedAmountOut,
              method: s.hedgeVia || 'price-tracked',
              route: s.route,
            })),
          },
          chain: 'sui',
        });
      }

      // Execute on-chain swaps (1% slippage for direct deposits)
      const result = await aggregator.executeRebalance(plan, 0.01);

      logger.info('[SUI-API] Deposit swaps executed', {
        amountUsdc,
        executed: result.totalExecuted,
        failed: result.totalFailed,
        hedged: simulatedSwaps.length,
        digests: result.results.filter(r => r.txDigest).map(r => `${r.asset}:${r.txDigest}`),
      });

      return NextResponse.json({
        success: result.success,
        data: {
          executed: result.totalExecuted,
          failed: result.totalFailed,
          results: result.results.map(r => ({
            asset: r.asset,
            success: r.success,
            txDigest: r.txDigest,
            amountIn: r.amountIn,
            amountOut: r.amountOut,
            error: r.error,
          })),
          simulatedPositions: simulatedSwaps.map(s => ({
            asset: s.asset,
            usdcAllocated: (Number(s.amountIn) / 1e6).toFixed(2),
            estimatedQty: s.expectedAmountOut,
            method: s.hedgeVia || 'price-tracked',
            route: s.route,
          })),
        },
        chain: 'sui',
      });
    }

    // Execute pre-withdraw swaps: assets → USDC
    if (action === 'execute-withdraw-swaps') {
      const { withdrawUsdc, allocations } = body;

      if (!withdrawUsdc || typeof withdrawUsdc !== 'number' || withdrawUsdc <= 0) {
        return NextResponse.json(
          { success: false, error: 'withdrawUsdc required (USDC amount to return)' },
          { status: 400 }
        );
      }
      if (!allocations || typeof allocations !== 'object') {
        return NextResponse.json(
          { success: false, error: 'allocations required (current pool allocations)' },
          { status: 400 }
        );
      }

      const aggregator = getCetusAggregatorService(network);

      const wallet = await aggregator.checkAdminWallet();
      if (!wallet.configured || !wallet.hasGas) {
        return NextResponse.json(
          { success: false, error: 'Admin wallet not configured or insufficient gas' },
          { status: 503 }
        );
      }

      // For each asset, calculate how much to sell back to USDC
      const assets: Array<import('@/lib/services/CetusAggregatorService').PoolAsset> = ['BTC', 'ETH', 'SUI', 'CRO'];
      const results: Array<import('@/lib/services/CetusAggregatorService').SwapExecutionResult> = [];
      const hedgedPositions: Array<{ asset: string; usdcValue: number; assetAmount: string; method: string; route: string }> = [];

      // Phase 1: Get ALL forward + reverse quotes in parallel (price discovery)
      const assetQuotes = await Promise.allSettled(
        assets.filter(asset => (allocations[asset] || 0) > 0).map(async (asset) => {
          const pct = (allocations[asset] || 0) / 100;
          const assetUsdValue = withdrawUsdc * pct;
          const forwardQuote = await aggregator.getSwapQuote(asset, assetUsdValue);
          if (!forwardQuote.expectedAmountOut || forwardQuote.expectedAmountOut === '0') {
            return { asset, assetUsdValue, forwardQuote, reverseQuote: null, error: `No price data for ${asset}` };
          }
          const assetAmountRaw = Number(forwardQuote.expectedAmountOut);
          const decimals = asset === 'SUI' ? 9 : 8;
          const assetAmount = assetAmountRaw / Math.pow(10, decimals);
          const reverseQuote = await aggregator.getReverseSwapQuote(asset, assetAmount);
          return { asset, assetUsdValue, forwardQuote, reverseQuote, error: null };
        })
      );

      // Phase 2: Execute swaps sequentially (on-chain txs need sequential nonces)
      for (const settled of assetQuotes) {
        if (settled.status !== 'fulfilled' || !settled.value) continue;
        const { asset, assetUsdValue, forwardQuote, reverseQuote, error } = settled.value;

        if (error || !reverseQuote) {
          results.push({ asset, success: false, amountIn: '0', error: error || `No reverse quote for ${asset}` });
          continue;
        }

        // On-chain reverse swap (mainnet with liquidity)
        if (reverseQuote.canSwapOnChain && reverseQuote.routerData) {
          const execResult = await aggregator.executeSwap(reverseQuote, 0.01);
          results.push(execResult);
          if (execResult.success) {
            await new Promise(r => setTimeout(r, 1500));
          }
        } else if (reverseQuote.hedgeVia || forwardQuote.hedgeVia) {
          // Hedged position (testnet or CRO): close the hedge / mark for settlement
          hedgedPositions.push({
            asset,
            usdcValue: assetUsdValue,
            assetAmount: forwardQuote.expectedAmountOut,
            method: reverseQuote.hedgeVia || forwardQuote.hedgeVia || 'price-tracked',
            route: reverseQuote.route || `${asset} → USDC (close hedge)`,
          });
          results.push({
            asset,
            success: true,
            amountIn: forwardQuote.expectedAmountOut,
            amountOut: Math.floor(assetUsdValue * 1e6).toString(),
            error: `Hedged via ${reverseQuote.hedgeVia || 'BlueFin'} (no on-chain swap)`,
          });
        } else {
          results.push({
            asset,
            success: false,
            amountIn: reverseQuote.amountIn || '0',
            error: `No route for ${asset} → USDC: ${reverseQuote.route}`,
          });
        }
      }

      const totalExecuted = results.filter(r => r.success).length;
      const totalFailed = results.filter(r => !r.success).length;

      logger.info('[SUI-API] Withdrawal swaps executed', {
        withdrawUsdc,
        executed: totalExecuted,
        failed: totalFailed,
        hedged: hedgedPositions.length,
        digests: results.filter(r => r.txDigest).map(r => `${r.asset}:${r.txDigest}`),
      });

      return NextResponse.json({
        success: totalFailed === 0,
        data: {
          executed: totalExecuted,
          failed: totalFailed,
          results: results.map(r => ({
            asset: r.asset,
            success: r.success,
            txDigest: r.txDigest,
            amountIn: r.amountIn,
            amountOut: r.amountOut,
            error: r.error,
          })),
          hedgedPositions: hedgedPositions.length > 0 ? hedgedPositions : undefined,
        },
        chain: 'sui',
      });
    }

    // Record USDC deposit: record on-chain deposit to DB, optionally execute server-side swaps
    if (action === 'record-deposit') {
      const { walletAddress, amountUsdc, allocations, txDigest } = body;
      
      // Validate inputs
      if (!walletAddress || typeof walletAddress !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(walletAddress)) {
        return NextResponse.json(
          { success: false, error: 'Valid SUI wallet address required (0x + 64 hex chars)' },
          { status: 400 }
        );
      }
      if (!amountUsdc || typeof amountUsdc !== 'number' || amountUsdc <= 0) {
        return NextResponse.json(
          { success: false, error: 'amountUsdc required (positive number)' },
          { status: 400 }
        );
      }

      // Dynamically import DB functions to avoid edge runtime issues
      const { getUserSharesFromDb, saveUserSharesToDb, addPoolTransactionToDb, txHashExists } = await import('@/lib/db/community-pool');

      // Idempotency check: prevent double-minting on retried requests
      if (txDigest) {
        const alreadyRecorded = await txHashExists(txDigest);
        if (alreadyRecorded) {
          const existingShares = await getUserSharesFromDb(walletAddress, 'sui');
          return NextResponse.json({
            success: true,
            data: {
              walletAddress,
              amountUsdc,
              sharesMinted: 0,
              totalShares: existingShares?.shares || 0,
              message: 'Transaction already recorded (idempotent)',
            },
            chain: 'sui',
            network,
          });
        }
      }

      // Determine if deposit was already executed on-chain (real txDigest from wallet signing)
      const isOnChainDeposit = txDigest && !txDigest.startsWith('usdc-deposit-');

      let swapResult = { totalExecuted: 0, totalFailed: 0, results: [] as Array<{ asset: string; success: boolean; txDigest?: string; amountIn?: string; amountOut?: string; error?: string }> };
      const hedgeResults: Array<{ asset: string; success: boolean; hedgeId?: string; method: string; error?: string }> = [];

      // Only attempt server-side swaps for legacy API-only deposits (no on-chain tx)
      if (!isOnChainDeposit && allocations && typeof allocations === 'object') {
        const aggregator = getCetusAggregatorService(network);
        const wallet = await aggregator.checkAdminWallet();

        if (wallet.configured && wallet.hasGas) {
          // Use AI agent for dynamic allocation if frontend sent the default static values
          let finalAllocations = allocations as Record<PoolAsset, number>;
          const isStaticDefault = allocations.BTC === 30 && allocations.ETH === 30 && allocations.SUI === 25 && allocations.CRO === 15;
          if (isStaticDefault) {
            try {
              const { getSuiPoolAgent } = await import('@/agents/specialized/SuiPoolAgent');
              const agent = getSuiPoolAgent(network);
              const indicators = await agent.analyzeMarket();
              const decision = agent.generateAllocation(indicators);
              finalAllocations = decision.allocations;
            } catch {
              // Keep static allocation on failure
            }
          }

          const plan = await aggregator.planRebalanceSwaps(amountUsdc, finalAllocations);
          swapResult = await aggregator.executeRebalance(plan, 0.01);
        } else {
          logger.info('[SUI-API] Admin wallet not configured — deposit recorded to DB only (on-chain deposit handled by user wallet)');
        }
      } else if (isOnChainDeposit) {
        logger.info('[SUI-API] On-chain deposit detected, skipping server-side swaps', { txDigest });
      }

      // Calculate shares to mint (1 share = 1 USDC for simplicity)
      const sharesToMint = amountUsdc;

      // Get existing user shares
      const existingShares = await getUserSharesFromDb(walletAddress, 'sui');
      const newTotalShares = (existingShares?.shares || 0) + sharesToMint;
      const newCostBasis = (existingShares?.cost_basis_usd || 0) + amountUsdc;

      // Save updated shares to database
      await saveUserSharesToDb({
        walletAddress,
        shares: newTotalShares,
        costBasisUSD: newCostBasis,
        chain: 'sui',
      });

      // Record transaction
      await addPoolTransactionToDb({
        id: `sui-deposit-${Date.now()}-${walletAddress.slice(-8)}`,
        type: 'DEPOSIT',
        walletAddress,
        amountUSD: amountUsdc,
        shares: sharesToMint,
        sharePrice: 1.0,
        details: {
          network,
          txDigest,
          swapResults: swapResult.results,
          allocations,
        },
        txHash: txDigest || undefined,
      });

      logger.info('[SUI-API] USDC deposit recorded', {
        wallet: walletAddress.slice(0, 10) + '...',
        amountUsdc,
        sharesTotal: newTotalShares,
        swapsExecuted: swapResult.totalExecuted,
        hedgesAttempted: hedgeResults.length,
      });

      return NextResponse.json({
        success: true,
        data: {
          walletAddress,
          amountUsdc,
          sharesMinted: sharesToMint,
          totalShares: newTotalShares,
          swaps: {
            executed: swapResult.totalExecuted,
            failed: swapResult.totalFailed,
            results: swapResult.results,
          },
          hedges: hedgeResults.length > 0 ? hedgeResults : undefined,
        },
        chain: 'sui',
        network,
      });
    }

    // Record withdrawal: update DB shares (on-chain withdrawal already handled by user wallet)
    if (action === 'record-withdraw') {
      const { walletAddress, sharesToBurn, txDigest } = body;

      // Validate inputs
      if (!walletAddress || typeof walletAddress !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(walletAddress)) {
        return NextResponse.json(
          { success: false, error: 'Valid SUI wallet address required (0x + 64 hex chars)' },
          { status: 400 }
        );
      }
      if (!sharesToBurn || typeof sharesToBurn !== 'number' || sharesToBurn <= 0) {
        return NextResponse.json(
          { success: false, error: 'sharesToBurn required (positive number)' },
          { status: 400 }
        );
      }

      // Import DB functions
      const { getUserSharesFromDb, saveUserSharesToDb, deleteUserSharesFromDb, addPoolTransactionToDb } = await import('@/lib/db/community-pool');

      // Get user's current shares
      const userShares = await getUserSharesFromDb(walletAddress, 'sui');
      if (!userShares || userShares.shares < sharesToBurn) {
        return NextResponse.json(
          { success: false, error: `Insufficient shares. Have: ${userShares?.shares || 0}, Need: ${sharesToBurn}` },
          { status: 400 }
        );
      }

      // Calculate USDC equivalent (1 share = 1 USDC)
      const withdrawUsdc = sharesToBurn;

      // Update user shares in DB
      const remainingShares = userShares.shares - sharesToBurn;
      if (remainingShares <= 0.0001) {
        await deleteUserSharesFromDb(walletAddress, 'sui');
      } else {
        const remainingCostBasis = userShares.cost_basis_usd * (remainingShares / userShares.shares);
        await saveUserSharesToDb({
          walletAddress,
          shares: remainingShares,
          costBasisUSD: remainingCostBasis,
          chain: 'sui',
        });
      }

      // Record transaction
      await addPoolTransactionToDb({
        id: `sui-withdraw-${Date.now()}-${walletAddress.slice(-8)}`,
        type: 'WITHDRAWAL',
        walletAddress,
        amountUSD: withdrawUsdc,
        shares: sharesToBurn,
        sharePrice: 1.0,
        details: {
          network,
          onChain: true,
        },
        txHash: txDigest || undefined,
      });

      logger.info('[SUI-API] Withdrawal recorded', {
        wallet: walletAddress.slice(0, 10) + '...',
        sharesBurned: sharesToBurn,
        remainingShares,
        txDigest,
      });

      return NextResponse.json({
        success: true,
        data: {
          walletAddress,
          sharesBurned: sharesToBurn,
          usdcReturned: withdrawUsdc,
          remainingShares,
        },
        chain: 'sui',
        network,
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action. Use deposit, withdraw, execute-deposit-swaps, execute-withdraw-swaps, record-deposit, or record-withdraw' },
      { status: 400 }
    );
    
  } catch (error) {
    logger.error('[SUI-API] POST Error', { error });
    
    return NextResponse.json(
      { success: false, error: 'Service temporarily unavailable', chain: 'sui' },
      { status: 500 }
    );
  }
}
