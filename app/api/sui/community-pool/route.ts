/**
 * SUI Community Pool API (USDC Deposits, 4-Asset AI-Managed)
 * 
 * Endpoints:
 * - GET  /api/sui/community-pool                          - Get pool summary with 4-asset allocation
 * - GET  /api/sui/community-pool?user=0x...               - Get user's position (USDC-denominated)
 * - GET  /api/sui/community-pool?action=members           - Get all members
 * - GET  /api/sui/community-pool?action=contract          - Get contract info (USDC coin type etc)
 * - GET  /api/sui/community-pool?action=allocation        - Get current 4-asset allocation
 * - GET  /api/sui/community-pool?action=swap-quote        - Get BlueFin aggregator swap quote
 * - GET  /api/sui/community-pool?action=admin-wallet      - Check admin wallet status
 * - GET  /api/sui/community-pool?action=user-position     - Get user position from DB
 * - GET  /api/sui/community-pool?action=treasury-info     - Get treasury address, pending fees, MSafe status
 * - POST /api/sui/community-pool?action=deposit           - Build USDC deposit tx params
 * - POST /api/sui/community-pool?action=withdraw          - Build withdrawal tx params
 * - POST /api/sui/community-pool?action=collect-fees      - Build collect_fees tx params (admin)
 * - POST /api/sui/community-pool?action=set-treasury      - Build set_treasury tx params (admin)
 * - POST /api/sui/community-pool?action=execute-deposit-swaps   - Swap deposited USDC → 4 assets
 * - POST /api/sui/community-pool?action=execute-withdraw-swaps  - Swap assets → USDC for withdrawal
 * - POST /api/sui/community-pool?action=record-deposit    - Record USDC deposit + execute swaps + mint shares
 * - POST /api/sui/community-pool?action=record-withdraw   - Burn shares + execute reverse swaps + record withdrawal
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { getSuiUsdcPoolService, validateSuiMainnetConfig } from '@/lib/services/sui/SuiCommunityPoolService';
import { getBluefinAggregatorService, type PoolAsset, type SwapExecutionResult } from '@/lib/services/sui/BluefinAggregatorService';
import { readLimiter, mutationLimiter } from '@/lib/security/rate-limiter';
import { verifyCronRequest } from '@/lib/qstash';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

type NetworkType = 'testnet' | 'mainnet';

// ============================================
// PER-WALLET MUTEX LOCK (prevents race conditions on concurrent deposits/withdrawals)
// ============================================
const walletLocks = new Map<string, Promise<void>>();

async function withWalletLock<T>(wallet: string, fn: () => Promise<T>): Promise<T> {
  const key = wallet.toLowerCase();
  // Chain onto any existing lock BEFORE awaiting — prevents race between concurrent callers
  const existing = walletLocks.get(key) ?? Promise.resolve();
  let resolve: () => void;
  const lock = new Promise<void>((r) => { resolve = r; });
  // Register our lock immediately so the next caller chains onto us
  walletLocks.set(key, lock);
  try {
    await existing; // Wait for previous operation to finish
    return await fn();
  } finally {
    resolve!();
    // Only delete if our lock is still the active one
    if (walletLocks.get(key) === lock) {
      walletLocks.delete(key);
    }
  }
}

function getNetwork(request: NextRequest): NetworkType {
  const url = new URL(request.url);
  const network = url.searchParams.get('network')?.trim();
  if (network === 'mainnet' || network === 'testnet') return network;
  // Default to env var, then testnet as safe fallback
  const envNetwork = (process.env.SUI_NETWORK || 'mainnet').trim() as NetworkType;
  return envNetwork === 'mainnet' || envNetwork === 'testnet' ? envNetwork : 'mainnet';
}

/** Reject requests if mainnet config is incomplete */
function requireValidNetwork(network: NetworkType): NextResponse | null {
  if (network !== 'mainnet') return null;
  const missing = validateSuiMainnetConfig();
  if (missing.length > 0) {
    logger.error('[SUI-API] Mainnet config incomplete — blocking request', { missing });
    return NextResponse.json(
      { success: false, error: `Mainnet not configured. Missing: ${missing.join(', ')}` },
      { status: 503 }
    );
  }
  return null;
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

    // MAINNET SAFETY: Reject if contract addresses not configured
    const configError = requireValidNetwork(network);
    if (configError) return configError;
    
    logger.info('[SUI-API] Request', { action, user, network });
    
    const service = getSuiUsdcPoolService(network);

    // Cache-bust: clear in-memory caches when client requests fresh data (after deposit/withdraw)
    if (url.searchParams.get('nocache') === '1') {
      service.clearCaches();
    }
    
    // Get BlueFin aggregator swap quote
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

      const aggregator = getBluefinAggregatorService(network);
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
      const aggregator = getBluefinAggregatorService(network);
      const wallet = await aggregator.checkAdminWallet();
      return NextResponse.json({
        success: true,
        data: {
          configured: wallet.configured,
          address: wallet.address,
          suiBalance: wallet.suiBalance,
          hasGas: wallet.hasGas,
          gasFloorSui: wallet.gasFloorSui,
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

      const { getUserTransactionCounts, saveUserSharesToDb } = await import('@/lib/db/community-pool');
      const txCounts = await getUserTransactionCounts(wallet, 'sui');

      // On-chain is the source of truth — read member position from contract
      let onChainPosition;
      let onChainReadFailed = false;
      try {
        onChainPosition = await service.getMemberPosition(wallet);
      } catch (err) {
        logger.error('[SUI-API] Failed to read on-chain member position', { 
          wallet: wallet.slice(0, 10) + '...', 
          error: err instanceof Error ? err.message : err,
        });
        onChainPosition = null;
        onChainReadFailed = true;
      }

      // If on-chain read failed, return a clear error instead of faking success with zero shares
      if (onChainReadFailed) {
        return NextResponse.json({
          success: false,
          error: 'Failed to read on-chain position — RPC may be unavailable',
          fallback: {
            wallet,
            depositCount: txCounts.depositCount,
            withdrawalCount: txCounts.withdrawalCount,
          },
          chain: 'sui',
          network,
        }, { status: 503 });
      }

      const shares = onChainPosition?.isMember ? onChainPosition.shares : 0;
      const valueUsdc = onChainPosition?.isMember ? onChainPosition.valueUsd : 0;
      const percentage = onChainPosition?.isMember ? onChainPosition.percentage : 0;
      // costBasis tracks actual USDC deposited on-chain (depositedSui field = depositedUsdc for USDC pool)
      const costBasisUsd = onChainPosition?.isMember ? onChainPosition.depositedSui : 0;

      // Sanity check: percentage can never exceed 100, shares can never be negative
      if (shares < 0 || percentage > 100.001 || valueUsdc < 0) {
        logger.error('[SUI-API] SANITY CHECK FAILED on user position', {
          shares, percentage, valueUsdc, wallet: wallet.slice(0, 10) + '...',
        });
        return NextResponse.json(
          { success: false, error: 'On-chain data failed sanity check — please retry' },
          { status: 500 }
        );
      }

      // Sync DB to match on-chain (background, non-blocking for response)
      if (shares > 0) {
        saveUserSharesToDb({
          walletAddress: wallet,
          shares,
          costBasisUSD: costBasisUsd || shares,
          chain: 'sui',
        }).catch(err => logger.warn('[SUI-API] DB sync failed (non-critical)', { 
          error: err instanceof Error ? err.message : err,
        }));
      }

      if (!onChainPosition?.isMember) {
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
            percentage: 0,
          },
          chain: 'sui',
          network,
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          isMember: true,
          wallet,
          shares,
          valueUsdc,
          costBasisUsd,
          joinedAt: onChainPosition.joinedAt || null,
          lastActionAt: onChainPosition.lastDepositAt || null,
          depositCount: txCounts.depositCount,
          withdrawalCount: txCounts.withdrawalCount,
          percentage,
        },
        chain: 'sui',
        network,
      });
    }

    // Get contract info
    if (action === 'contract') {
      const info = service.getContractInfo();
      // Also include the deployed SUI-native pool contract info
      const { getSuiCommunityPoolService } = await import('@/lib/services/sui/SuiCommunityPoolService');
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
            description: '3-asset AI-managed allocation for USDC deposits',
            assets: ['BTC', 'ETH', 'SUI'],
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
          BTC: 35,
          ETH: 30,
          SUI: 35,
        };
        return NextResponse.json({
          success: true,
          data: {
            allocation,
            description: '3-asset AI-managed allocation for USDC deposits',
            assets: ['BTC', 'ETH', 'SUI'],
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

    // Treasury info: on-chain treasury address, pending fees, MSafe status
    if (action === 'treasury-info') {
      const treasuryInfo = await service.getTreasuryInfo();
      return cachedJsonResponse({
        success: true,
        data: treasuryInfo,
        chain: 'sui',
        network,
        duration: Date.now() - startTime,
      }, 30);
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

    // MAINNET SAFETY: Reject if contract addresses not configured
    const configError = requireValidNetwork(network);
    if (configError) return configError;
    
    const body = await request.json();
    const service = getSuiUsdcPoolService(network);
    
    logger.info('[SUI-API] POST request', { action, network, body });

    // Build collect_fees transaction params (admin/fee-manager operation)
    if (action === 'collect-fees') {
      // SECURITY: Admin-only — require QStash signature or CRON_SECRET
      const authResult = await verifyCronRequest(request, 'SUI collect-fees');
      if (authResult !== true) {
        return NextResponse.json({ success: false, error: 'Unauthorized — admin operation requires authentication' }, { status: 401 });
      }

      // Ensure poolStateId is cached
      await service.getPoolStats();

      const treasuryInfo = await service.getTreasuryInfo();
      if (treasuryInfo.totalPendingFees <= 0) {
        return NextResponse.json(
          { success: false, error: 'No pending fees to collect' },
          { status: 400 }
        );
      }

      const params = service.buildCollectFeesParams();
      return NextResponse.json({
        success: true,
        data: {
          ...params,
          pendingFees: treasuryInfo.totalPendingFees,
          treasuryAddress: treasuryInfo.treasuryAddress,
          msafeConfigured: treasuryInfo.msafeConfigured,
        },
        chain: 'sui',
        network,
      });
    }

    // Build set_treasury transaction params (admin operation)
    if (action === 'set-treasury') {
      // SECURITY: Admin-only — require QStash signature or CRON_SECRET
      const authResult = await verifyCronRequest(request, 'SUI set-treasury');
      if (authResult !== true) {
        return NextResponse.json({ success: false, error: 'Unauthorized — admin operation requires authentication' }, { status: 401 });
      }

      const { newTreasury } = body;
      if (!newTreasury || !/^0x[a-fA-F0-9]{64}$/.test(newTreasury)) {
        return NextResponse.json(
          { success: false, error: 'Valid SUI address required (0x + 64 hex chars)' },
          { status: 400 }
        );
      }

      // Ensure poolStateId is cached
      await service.getPoolStats();

      const params = service.buildSetTreasuryParams(newTreasury);
      return NextResponse.json({
        success: true,
        data: params,
        chain: 'sui',
        network,
      });
    }
    
    // ── Admin recovery: sell all non-USDC admin assets and return USDC to pool ──
    // POST /api/sui/community-pool?action=admin-recover
    // Auth: CRON_SECRET or QStash signature
    if (action === 'admin-recover') {
      const authResult = await verifyCronRequest(request, 'SUI admin-recover');
      if (authResult !== true) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const startTime = Date.now();
      const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
      const agentCapId = (process.env.SUI_AGENT_CAP_ID || process.env.SUI_ADMIN_CAP_ID || '').trim();
      if (!adminKey || !agentCapId) {
        return NextResponse.json({ success: false, error: 'SUI_POOL_ADMIN_KEY / SUI_AGENT_CAP_ID not configured' }, { status: 503 });
      }

      // Import what we need
      const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
      const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
      const { SUI_USDC_POOL_CONFIG } = await import('@/lib/types/sui-pool-types');
      const { getMarketDataService } = await import('@/lib/services/market-data/RealMarketDataService');

      const keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
      const address = keypair.getPublicKey().toSuiAddress();

      const rpcUrl = network === 'mainnet'
        ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
        : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
      const suiClient = new SuiClient({ url: rpcUrl });

      // Fetch current prices for replenishment value estimate
      const mds = getMarketDataService();
      const [btcPrice, ethPrice, suiPrice] = await Promise.all([
        mds.getTokenPrice('BTC').then(p => p.price).catch(() => 0),
        mds.getTokenPrice('ETH').then(p => p.price).catch(() => 0),
        mds.getTokenPrice('SUI').then(p => p.price).catch(() => 0),
      ]);
      const pricesUSD: Record<string, number> = { BTC: btcPrice, ETH: ethPrice, SUI: suiPrice };

      // Step 1: Sell all non-USDC assets via BlueFin
      // (inline the replenish logic to avoid importing cron internals)
      const aggregator = getBluefinAggregatorService(network);
      const allBalances = await suiClient.getAllBalances({ owner: address });
      const { MAINNET_COIN_TYPES, ASSET_TO_COIN_KEY, ASSET_DECIMALS } = await import('@/lib/types/bluefin-types');
      const usdcType = MAINNET_COIN_TYPES.USDC;
      
      const swapResults: Array<{ asset: string; sold: number; usdcReceived: number; txDigest?: string; error?: string }> = [];
      for (const bal of allBalances) {
        if (bal.coinType === usdcType || bal.coinType === '0x2::sui::SUI') continue;
        const raw = Number(bal.totalBalance);
        if (raw <= 0) continue;

        // Match to known pool asset
        const assetEntry = Object.entries(ASSET_TO_COIN_KEY).find(([, key]) => MAINNET_COIN_TYPES[key] === bal.coinType);
        if (!assetEntry) continue;
        const asset = assetEntry[0] as PoolAsset;
        const decimals = ASSET_DECIMALS[ASSET_TO_COIN_KEY[asset]] || 8;
        const amount = raw / Math.pow(10, decimals);
        if (amount < 1e-8) continue;

        try {
          const reverseQuote = await aggregator.getReverseSwapQuote(asset, amount);
          if (!reverseQuote.canSwapOnChain) {
            swapResults.push({ asset, sold: amount, usdcReceived: 0, error: 'No on-chain route' });
            continue;
          }
          const swapResult = await aggregator.executeSwap(reverseQuote, 0.025);
          const usdcReceived = Number(swapResult.amountOut || '0') / 1e6;
          swapResults.push({ asset, sold: amount, usdcReceived, txDigest: swapResult.txDigest, error: swapResult.error });
          if (swapResult.success) await new Promise(r => setTimeout(r, 2500));
        } catch (e) {
          swapResults.push({ asset, sold: amount, usdcReceived: 0, error: String(e) });
        }
      }

      const totalReplenished = swapResults.reduce((s, r) => s + r.usdcReceived, 0);

      // Step 2: Return admin USDC to pool via mini-hedge cycle if we have meaningful USDC
      let poolReturn: { success: boolean; returned?: number; txDigest?: string; error?: string } = { success: false };
      if (totalReplenished > 1.0) {
        // Check current admin USDC (includes any pre-existing balance)
        const usdcCoins = await suiClient.getCoins({ owner: address, coinType: usdcType });
        const adminUsdc = usdcCoins.data.reduce((s, c) => s + Number(c.balance), 0) / 1e6;

        if (adminUsdc > 1.0) {
          const poolConfig = SUI_USDC_POOL_CONFIG[network];
          if (poolConfig.poolStateId && poolConfig.packageId) {
            // Check active hedges first
            const hedgesObj = await suiClient.getObject({ id: poolConfig.poolStateId, options: { showContent: true } });
            const fields = (hedgesObj.data?.content as any)?.fields;
            const activeHedgesList: any[] = fields?.hedge_state?.fields?.active_hedges || [];

            let hedgeId: number[] | null = null;
            let microHedgeUsdc = 0;

            if (activeHedgesList.length === 0) {
              // Open a micro hedge to get a hedge_id
              const { Transaction } = await import('@mysten/sui/transactions');
              const MICRO = 10_000; // 0.01 USDC raw
              const poolCoins = await suiClient.getCoins({ owner: address, coinType: usdcType });
              if (poolCoins.data.length === 0) {
                poolReturn = { success: false, error: 'Admin has no USDC coins to create micro-hedge' };
              } else {
                try {
                  const tx = new Transaction();
                  const primary = tx.object(poolCoins.data[0].coinObjectId);
                  if (poolCoins.data.length > 1) tx.mergeCoins(primary, poolCoins.data.slice(1).map(c => tx.object(c.coinObjectId)));
                  tx.moveCall({
                    target: `${poolConfig.packageId}::${poolConfig.moduleName}::open_hedge`,
                    typeArguments: [usdcType],
                    arguments: [
                      tx.object(agentCapId),
                      tx.object(poolConfig.poolStateId!),
                      tx.pure.u64(MICRO),
                      tx.object('0x6'),
                    ],
                  });
                  tx.setGasBudget(30_000_000);
                  const openTx = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair, options: { showEffects: true } });
                  if (openTx.effects?.status?.status === 'success') {
                    await new Promise(r => setTimeout(r, 3000));
                    // Fetch hedge id
                    const freshObj = await suiClient.getObject({ id: poolConfig.poolStateId!, options: { showContent: true } });
                    const freshFields = (freshObj.data?.content as any)?.fields;
                    const freshHedges: any[] = freshFields?.hedge_state?.fields?.active_hedges || [];
                    if (freshHedges.length > 0) {
                      const h = freshHedges[freshHedges.length - 1];
                      hedgeId = Array.from(Buffer.from((h.fields || h).id || '', 'hex'));
                      microHedgeUsdc = MICRO / 1e6;
                    }
                  }
                } catch (openErr) {
                  poolReturn = { success: false, error: `Micro-hedge open failed: ${openErr}` };
                }
              }
            } else {
              const h = activeHedgesList[0];
              hedgeId = Array.from(Buffer.from((h.fields || h).id || '', 'hex'));
              microHedgeUsdc = Number((h.fields || h).collateral_usdc || 0) / 1e6;
            }

            if (hedgeId && !poolReturn.error) {
              // Return all admin USDC to pool
              const freshCoins = await suiClient.getCoins({ owner: address, coinType: usdcType });
              const totalAdminUsdc = freshCoins.data.reduce((s, c) => s + Number(c.balance), 0) / 1e6;
              const pnl = Math.max(0, totalAdminUsdc - microHedgeUsdc);
              const { Transaction } = await import('@mysten/sui/transactions');
              const tx2 = new Transaction();
              const primary2 = tx2.object(freshCoins.data[0].coinObjectId);
              if (freshCoins.data.length > 1) tx2.mergeCoins(primary2, freshCoins.data.slice(1).map(c => tx2.object(c.coinObjectId)));
              const [returnCoin] = tx2.splitCoins(primary2, [Math.floor(totalAdminUsdc * 1e6)]);
              tx2.moveCall({
                target: `${poolConfig.packageId}::${poolConfig.moduleName}::close_hedge`,
                typeArguments: [usdcType],
                arguments: [
                  tx2.object(agentCapId),
                  tx2.object(poolConfig.poolStateId!),
                  tx2.pure.vector('u8', hedgeId),
                  tx2.pure.u64(Math.floor(pnl * 1e6)),
                  tx2.pure.bool(pnl > 0),
                  returnCoin,
                  tx2.object('0x6'),
                ],
              });
              tx2.setGasBudget(50_000_000);
              const closeTx = await suiClient.signAndExecuteTransaction({ transaction: tx2, signer: keypair, options: { showEffects: true } });
              if (closeTx.effects?.status?.status === 'success') {
                poolReturn = { success: true, returned: totalAdminUsdc, txDigest: closeTx.digest };
              } else {
                poolReturn = { success: false, error: closeTx.effects?.status?.error };
              }
            }
          }
        }
      }

      return NextResponse.json({
        success: true,
        action: 'admin-recover',
        swapResults,
        totalReplenished: totalReplenished.toFixed(6),
        poolReturn,
        duration: Date.now() - startTime,
        chain: 'sui',
        network,
      });
    }

    // ── Trigger Upstash QStash to run cron immediately ──
    // POST /api/sui/community-pool?action=trigger-cron
    if (action === 'trigger-cron') {
      const authResult = await verifyCronRequest(request, 'SUI trigger-cron');
      if (authResult !== true) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const qstashToken = process.env.QSTASH_TOKEN;
      if (!qstashToken) {
        return NextResponse.json({ success: false, error: 'QSTASH_TOKEN not configured' }, { status: 503 });
      }

      const cronUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.zkvanguard.xyz'}/api/cron/sui-community-pool`;
      // Use regional endpoint from QSTASH_URL env or fall back to US East-1
      const qstashBase = (process.env.QSTASH_URL || 'https://qstash-us-east-1.upstash.io').replace(/\/$/, '');
      const res = await fetch(`${qstashBase}/v2/publish/${cronUrl}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Method': 'GET',
        },
        body: JSON.stringify({}),
      });

      const result = await res.json().catch(() => ({}));
      return NextResponse.json({
        success: res.ok,
        queued: res.ok,
        messageId: (result as any)?.messageId,
        cronUrl,
        status: res.status,
        chain: 'sui',
      });
    }

    // Build deposit transaction params
    if (action === 'deposit') {
      const { amount } = body;
      if (!amount) {
        return NextResponse.json(
          { success: false, error: 'Amount required (in MIST or SUI)' },
          { status: 400 }
        );
      }

      // CRITICAL: Validate positive amount to prevent negative value attacks.
      // BigInt() throws on invalid input (strings with letters, decimals,
      // SQL injection payloads, etc.) — catch and return 400 instead of 500.
      let amountRaw: bigint;
      try {
        amountRaw = BigInt(amount);
      } catch {
        return NextResponse.json(
          { success: false, error: 'Amount must be an integer (USDC base units)' },
          { status: 400 }
        );
      }
      if (amountRaw <= 0n) {
        return NextResponse.json(
          { success: false, error: 'Amount must be positive' },
          { status: 400 }
        );
      }
      // Upper bound: 1B USDC (1e15 base units). Anything beyond this is
      // either a typo or an attempt to abuse the API.
      const MAX_DEPOSIT_RAW = 1_000_000_000_000_000n; // 1B USDC * 10^6
      if (amountRaw > MAX_DEPOSIT_RAW) {
        return NextResponse.json(
          { success: false, error: 'Amount exceeds maximum deposit (1B USDC)' },
          { status: 400 }
        );
      }
      
      // Fetch pool stats first to ensure poolStateId is cached
      await service.getPoolStats();
      
      // For USDC pool: amount is in USDC atomic units (6 decimals)
      // 1 USDC = 1,000,000 (6 decimals)
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

      // CRITICAL: Validate positive shares to prevent negative value attacks
      const sharesScaled = BigInt(shares);
      if (sharesScaled <= 0n) {
        return NextResponse.json(
          { success: false, error: 'Shares must be positive' },
          { status: 400 }
        );
      }
      
      // Fetch pool stats first to ensure poolStateId is cached
      await service.getPoolStats();
      
      // USDC pool uses 6 decimals for shares
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
      // SECURITY: Admin-only — requires QStash signature or CRON_SECRET
      const authResult = await verifyCronRequest(request, 'SUI execute-deposit-swaps');
      if (authResult !== true) {
        return NextResponse.json({ success: false, error: 'Unauthorized — admin operation requires authentication' }, { status: 401 });
      }

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

      const aggregator = getBluefinAggregatorService(network);

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
        allocations as Record<PoolAsset, number>,
      );

      const onChainSwaps = plan.swaps.filter(s => s.canSwapOnChain && s.routerData);
      const hedgedSwaps = plan.swaps.filter(s => !s.canSwapOnChain && s.hedgeVia === 'bluefin');

      if (onChainSwaps.length === 0 && hedgedSwaps.length === 0) {
        return NextResponse.json({
          success: false,
          data: {
            message: 'No on-chain swaps or hedges available for these assets',
            plan,
          },
          chain: 'sui',
        }, { status: 400 });
      }

      // Execute on-chain swaps + BlueFin hedges (1% slippage for direct deposits)
      const result = await aggregator.executeRebalance(plan, 0.01);

      logger.info('[SUI-API] Deposit swaps executed', {
        amountUsdc,
        executed: result.totalExecuted,
        failed: result.totalFailed,
        hedged: hedgedSwaps.length,
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
        },
        chain: 'sui',
      });
    }

    // Dry-run deposit swaps — validates entire pipeline without executing
    if (action === 'dry-run-deposit-swaps') {
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

      const aggregator = getBluefinAggregatorService(network);
      const wallet = await aggregator.checkAdminWallet();

      const plan = await aggregator.planRebalanceSwaps(
        amountUsdc,
        allocations as Record<PoolAsset, number>,
      );

      const result = await aggregator.executeRebalance(plan, 0.01, { dryRun: true });

      return NextResponse.json({
        success: true,
        data: {
          dryRun: true,
          wallet: { configured: wallet.configured, hasGas: wallet.hasGas, address: wallet.address },
          plan: {
            totalUsdcToSwap: plan.totalUsdcToSwap,
            swaps: plan.swaps.map(s => ({
              asset: s.asset,
              amountIn: s.amountIn,
              expectedAmountOut: s.expectedAmountOut,
              canSwapOnChain: s.canSwapOnChain,
              hedgeVia: s.hedgeVia,
            })),
          },
          execution: {
            executed: result.totalExecuted,
            failed: result.totalFailed,
            results: result.results,
          },
          hedgeValidation: result.dryRunDetails || [],
        },
        chain: 'sui',
      });
    }

    // Execute pre-withdraw swaps: assets → USDC
    if (action === 'execute-withdraw-swaps') {
      // SECURITY: Admin-only — requires QStash signature or CRON_SECRET
      const authResult = await verifyCronRequest(request, 'SUI execute-withdraw-swaps');
      if (authResult !== true) {
        return NextResponse.json({ success: false, error: 'Unauthorized — admin operation requires authentication' }, { status: 401 });
      }

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

      const aggregator = getBluefinAggregatorService(network);

      const wallet = await aggregator.checkAdminWallet();
      if (!wallet.configured || !wallet.hasGas) {
        return NextResponse.json(
          { success: false, error: 'Admin wallet not configured or insufficient gas' },
          { status: 503 }
        );
      }

      // For each asset, calculate how much to sell back to USDC
      const assets: PoolAsset[] = ['BTC', 'ETH', 'SUI'];
      const results: SwapExecutionResult[] = [];
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
        } else if (reverseQuote.hedgeVia === 'bluefin' || forwardQuote.hedgeVia === 'bluefin') {
          // Hedged position: close the BlueFin hedge
          const { bluefinService, BluefinService } = await import('@/lib/services/sui/BluefinService');
          const privateKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
          const bfNetwork = (process.env.BLUEFIN_NETWORK || network || '').trim() as 'mainnet' | 'testnet';

          if (!privateKey) {
            results.push({
              asset,
              success: false,
              amountIn: forwardQuote.expectedAmountOut,
              error: 'BLUEFIN_PRIVATE_KEY not configured — cannot close hedge',
            });
            continue;
          }

          await bluefinService.initialize(privateKey, bfNetwork);
          const symbol = BluefinService.assetToPair(asset);

          if (!symbol) {
            results.push({
              asset,
              success: false,
              amountIn: forwardQuote.expectedAmountOut,
              error: `No BlueFin pair for ${asset}`,
            });
            continue;
          }

          const decimals = asset === 'SUI' ? 9 : 8;
          const closeSize = Number(forwardQuote.expectedAmountOut) / Math.pow(10, decimals);

          const closeResult = await bluefinService.closeHedge({
            symbol,
            size: closeSize > 0 ? closeSize : undefined,
          });

          hedgedPositions.push({
            asset,
            usdcValue: assetUsdValue,
            assetAmount: forwardQuote.expectedAmountOut,
            method: 'bluefin',
            route: reverseQuote.route || `${asset} → USDC (close hedge)`,
          });

          results.push({
            asset,
            success: closeResult.success,
            amountIn: forwardQuote.expectedAmountOut,
            amountOut: Math.floor(assetUsdValue * 1e6).toString(),
            txDigest: closeResult.txDigest,
            error: closeResult.success
              ? `Closed BlueFin hedge: ${symbol}`
              : `BlueFin close failed: ${closeResult.error}`,
          });

          if (closeResult.success) {
            await new Promise(r => setTimeout(r, 1500));
          }
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
      // Security: Cap single deposit to prevent DB inflation attacks
      const MAX_SINGLE_DEPOSIT_USDC = 10_000_000; // $10M max per deposit
      if (amountUsdc > MAX_SINGLE_DEPOSIT_USDC) {
        return NextResponse.json(
          { success: false, error: `Deposit exceeds maximum ($${MAX_SINGLE_DEPOSIT_USDC.toLocaleString()} USDC)` },
          { status: 400 }
        );
      }
      // Security: Validate txDigest format if provided (SUI base58/base64, 32-44 chars)
      if (txDigest && typeof txDigest === 'string' && !/^[A-Za-z0-9+/=]{32,64}$/.test(txDigest) && !txDigest.startsWith('usdc-deposit-')) {
        return NextResponse.json(
          { success: false, error: 'Invalid transaction digest format' },
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

      // SAFETY: Per-wallet lock prevents race conditions from parallel deposits
      return withWalletLock(walletAddress, async () => {

      let swapResult = { totalExecuted: 0, totalFailed: 0, results: [] as Array<{ asset: string; success: boolean; txDigest?: string; amountIn?: string; amountOut?: string; error?: string }> };
      const hedgeResults: Array<{ asset: string; success: boolean; hedgeId?: string; method: string; error?: string }> = [];

      // Only attempt server-side swaps for legacy API-only deposits (no on-chain tx)
      if (!isOnChainDeposit && allocations && typeof allocations === 'object') {
        const aggregator = getBluefinAggregatorService(network);
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

      // On-chain is the source of truth — read actual member shares from contract
      // If on-chain read fails, we still record to DB as fallback (tx may not be finalized)
      // but we log a warning and mark the record as unverified
      let newTotalShares = sharesToMint;
      let newCostBasis = amountUsdc;
      let onChainVerified = false;
      try {
        // Clear cache so we get fresh on-chain data after the deposit tx
        service.clearCaches();
        // Wait briefly for SUI finality (~2-3 seconds on SUI)
        if (isOnChainDeposit) {
          await new Promise(r => setTimeout(r, 2000));
        }
        const onChainPos = await service.getMemberPosition(walletAddress);
        if (onChainPos.isMember && onChainPos.shares > 0) {
          newTotalShares = onChainPos.shares;
          newCostBasis = onChainPos.shares; // 1 share ≈ 1 USDC
          onChainVerified = true;
        } else {
          // On-chain member not found yet — tx may not be finalized
          // Use conservative estimate: existing + new deposit
          const existingShares = await getUserSharesFromDb(walletAddress, 'sui');
          newTotalShares = (existingShares?.shares || 0) + sharesToMint;
          newCostBasis = (existingShares?.cost_basis_usd || 0) + amountUsdc;
          logger.warn('[SUI-API] On-chain member not found yet, using DB + deposit estimate', {
            wallet: walletAddress.slice(0, 10) + '...',
            estimate: newTotalShares,
          });
        }
      } catch (err) {
        logger.error('[SUI-API] On-chain read failed during deposit recording', { 
          error: err instanceof Error ? err.message : err,
        });
        // Fallback: accumulate from DB — will be corrected on next user-position read
        const existingShares = await getUserSharesFromDb(walletAddress, 'sui');
        newTotalShares = (existingShares?.shares || 0) + sharesToMint;
        newCostBasis = (existingShares?.cost_basis_usd || 0) + amountUsdc;
      }

      // Sanity check: shares should never be negative or astronomically large
      if (newTotalShares < 0 || newTotalShares > MAX_SINGLE_DEPOSIT_USDC * 100) {
        logger.error('[SUI-API] SANITY CHECK FAILED on deposit shares', {
          newTotalShares, walletAddress: walletAddress.slice(0, 10) + '...',
        });
        return NextResponse.json(
          { success: false, error: 'Calculated shares failed sanity check — please retry' },
          { status: 500 }
        );
      }

      // Save updated shares to database (DB is a cache of on-chain state)
      await saveUserSharesToDb({
        walletAddress,
        shares: newTotalShares,
        costBasisUSD: newCostBasis,
        chain: 'sui',
      });

      // Record transaction with verification status
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
          onChainVerified,
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

      }); // end withWalletLock
    }

    // Record withdrawal: sync DB with on-chain state after user's on-chain withdrawal
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
      // Security: Validate txDigest format
      if (txDigest && typeof txDigest === 'string' && !/^[A-Za-z0-9+/=]{32,64}$/.test(txDigest)) {
        return NextResponse.json(
          { success: false, error: 'Invalid transaction digest format' },
          { status: 400 }
        );
      }

      // Import DB functions
      const { saveUserSharesToDb, deleteUserSharesFromDb, addPoolTransactionToDb, txHashExists } = await import('@/lib/db/community-pool');

      // Idempotency check: prevent double-recording withdrawal
      if (txDigest) {
        const alreadyRecorded = await txHashExists(txDigest);
        if (alreadyRecorded) {
          return NextResponse.json({
            success: true,
            data: {
              walletAddress,
              sharesBurned: 0,
              usdcReturned: 0,
              message: 'Withdrawal already recorded (idempotent)',
            },
            chain: 'sui',
            network,
          });
        }
      }

      // On-chain is the source of truth — read actual position after withdrawal
      // SAFETY: Per-wallet lock prevents race conditions from parallel withdrawals
      return withWalletLock(walletAddress, async () => {

      let remainingShares = 0;
      let onChainVerified = false;
      try {
        service.clearCaches();
        // Wait for SUI finality
        await new Promise(r => setTimeout(r, 2000));
        const onChainPos = await service.getMemberPosition(walletAddress);
        remainingShares = onChainPos.isMember ? onChainPos.shares : 0;
        onChainVerified = true;
      } catch (err) {
        logger.error('[SUI-API] On-chain read failed during withdrawal recording', {
          error: err instanceof Error ? err.message : err,
        });
        // Fallback: calculate from DB
        const { getUserSharesFromDb } = await import('@/lib/db/community-pool');
        const dbShares = await getUserSharesFromDb(walletAddress, 'sui');
        remainingShares = Math.max(0, (dbShares?.shares || 0) - sharesToBurn);
      }

      // Calculate USDC equivalent
      const withdrawUsdc = sharesToBurn;

      // Sync DB to match on-chain state
      if (remainingShares <= 0.0001) {
        await deleteUserSharesFromDb(walletAddress, 'sui');
        remainingShares = 0;
      } else {
        await saveUserSharesToDb({
          walletAddress,
          shares: remainingShares,
          costBasisUSD: remainingShares, // 1 share ≈ 1 USDC cost basis
          chain: 'sui',
        });
      }

      // Record transaction with verification status
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
          onChainVerified,
          remainingSharesOnChain: remainingShares,
        },
        txHash: txDigest || undefined,
      });

      logger.info('[SUI-API] Withdrawal recorded', {
        wallet: walletAddress.slice(0, 10) + '...',
        sharesBurned: sharesToBurn,
        remainingShares,
        onChainVerified,
        txDigest,
      });

      return NextResponse.json({
        success: true,
        data: {
          walletAddress,
          sharesBurned: sharesToBurn,
          usdcReturned: withdrawUsdc,
          remainingShares,
          onChainVerified,
        },
        chain: 'sui',
        network,
      });

      }); // end withWalletLock
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
