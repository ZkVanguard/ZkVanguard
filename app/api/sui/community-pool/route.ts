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
 * - POST /api/sui/community-pool?action=deposit           - Build USDC deposit tx params
 * - POST /api/sui/community-pool?action=withdraw          - Build withdrawal tx params
 * - POST /api/sui/community-pool?action=execute-deposit-swaps   - Swap deposited USDC → 4 assets
 * - POST /api/sui/community-pool?action=execute-withdraw-swaps  - Swap assets → USDC for withdrawal
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

    // Get contract info
    if (action === 'contract') {
      const info = service.getContractInfo();
      return NextResponse.json({
        success: true,
        data: info,
        chain: 'sui',
        network,
      });
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
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      {
        success: false,
        error: message,
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

      for (const asset of assets) {
        const pct = (allocations[asset] || 0) / 100;
        if (pct <= 0) continue;

        // USD value this asset needs to contribute
        const assetUsdValue = withdrawUsdc * pct;
        
        // Get reverse quote (asset → USDC)
        // We need to estimate the asset amount from USD value
        // Use a forward quote to get the price ratio
        const forwardQuote = await aggregator.getSwapQuote(asset, assetUsdValue);
        if (!forwardQuote.canSwapOnChain || !forwardQuote.routerData) {
          results.push({
            asset,
            success: false,
            amountIn: '0',
            error: `No route for ${asset} → USDC`,
          });
          continue;
        }

        // Use the forward quote's expected output as the amount to sell back
        const assetAmountRaw = Number(forwardQuote.expectedAmountOut);
        const decimals = asset === 'SUI' ? 9 : 8;
        const assetAmount = assetAmountRaw / Math.pow(10, decimals);

        const reverseQuote = await aggregator.getReverseSwapQuote(asset, assetAmount);
        if (!reverseQuote.canSwapOnChain || !reverseQuote.routerData) {
          results.push({
            asset,
            success: false,
            amountIn: reverseQuote.amountIn,
            error: reverseQuote.route,
          });
          continue;
        }

        // Execute reverse swap
        const execResult = await aggregator.executeSwap(reverseQuote, 0.01);
        results.push(execResult);

        if (execResult.success) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      const totalExecuted = results.filter(r => r.success).length;
      const totalFailed = results.filter(r => !r.success).length;

      logger.info('[SUI-API] Withdrawal swaps executed', {
        withdrawUsdc,
        executed: totalExecuted,
        failed: totalFailed,
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
        },
        chain: 'sui',
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action. Use deposit, withdraw, execute-deposit-swaps, or execute-withdraw-swaps' },
      { status: 400 }
    );
    
  } catch (error) {
    logger.error('[SUI-API] POST Error', { error });
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { success: false, error: message, chain: 'sui' },
      { status: 500 }
    );
  }
}
