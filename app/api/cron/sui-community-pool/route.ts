/**
 * Cron Job: SUI Community Pool AI Management (USDC)
 * 
 * Invoked by Upstash QStash every 30 minutes to:
 * 1. Fetch SUI pool on-chain stats (USDC balance, shares, members)
 * 2. Record NAV snapshot with 4-asset allocation tracking
 * 3. Sync member data from on-chain → DB
 * 4. Run AI allocation decision (BTC/ETH/SUI/CRO)
 * 5. Trigger auto-hedge via BlueFin when risk is elevated
 * 
 * 4 Assets: BTC, ETH, SUI, CRO
 * Deposit token: USDC on SUI
 * 
 * Security: QStash signature verification + CRON_SECRET fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { getSuiUsdcPoolService, validateSuiMainnetConfig, SUI_USDC_POOL_CONFIG, SUI_USDC_COIN_TYPE } from '@/lib/services/sui/SuiCommunityPoolService';
import {
  initCommunityPoolTables,
  recordNavSnapshot,
  saveUserSharesToDb,
  savePoolStateToDb,
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { query } from '@/lib/db/postgres';
import { getMarketDataService } from '@/lib/services/market-data/RealMarketDataService';
import { getMultiSourceValidatedPrice } from '@/lib/services/market-data/unified-price-provider';
import { getBluefinAggregatorService } from '@/lib/services/sui/BluefinAggregatorService';
import { getSuiPoolAgent, type AllocationDecision } from '@/agents/specialized/SuiPoolAgent';
import { getAutoHedgeConfigs } from '@/lib/storage/auto-hedge-storage';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID, isSuiCommunityPool } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Rate limiting: prevent duplicate cron runs within 5 minutes
let lastSuccessfulRunTimestamp = 0;
const MIN_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// 4 pool assets
const POOL_ASSETS = ['BTC', 'ETH', 'SUI', 'CRO'] as const;
type PoolAsset = (typeof POOL_ASSETS)[number];

interface SuiCronResult {
  success: boolean;
  chain: 'sui';
  poolStats?: {
    totalNAV_USDC: string;
    totalShares: string;
    sharePrice: string;
    memberCount: number;
    allocations: Record<PoolAsset, number>;
  };
  aiDecision?: {
    action: string;
    allocations: Record<PoolAsset, number>;
    confidence: number;
    reasoning: string;
    swappableAssets?: string[];
    hedgedAssets?: string[];
    riskScore?: number;
  };
  riskScore?: number;
  pricesUSD?: Record<string, number>;
  autoHedge?: {
    triggered: boolean;
    hedges?: Array<{
      symbol: string;
      side: string;
      size: number;
      status: string;
      orderId?: string;
      error?: string;
    }>;
  };
  rebalanceSwaps?: {
    planned: number;
    executable: number;
    quotes: Array<{
      asset: string;
      amountInUsdc: string;
      expectedOut: string;
      route: string;
      canSwap: boolean;
    }>;
    simulated?: number;
    swappableAssets?: string[];
    hedgedAssets?: string[];
    executed?: number;
    failed?: number;
    txDigests?: Array<{ asset: string; digest: string }>;
  };
  duration: number;
  error?: string;
}

// ============================================================================
// AI Allocation Engine (same algorithm as EVM, adapted for SUI USDC pool)
// ============================================================================

interface AssetIndicator {
  asset: PoolAsset;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  volatility: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'neutral';
  score: number;
}

async function fetchMarketIndicators(): Promise<AssetIndicator[]> {
  const mds = getMarketDataService();
  const indicators: AssetIndicator[] = [];

  for (const asset of POOL_ASSETS) {
    try {
      const data = await mds.getTokenPrice(asset);
      const price = data.price;
      const change24h = data.change24h ?? 0;
      const volume24h = data.volume24h ?? 0;
      // Estimate high/low from price and 24h change (MarketPrice doesn't have these)
      const high24h = price * (1 + Math.abs(change24h) / 100 * 0.6);
      const low24h = price * (1 - Math.abs(change24h) / 100 * 0.6);

      // Volatility from 24h range
      const rangePercent = price > 0 ? ((high24h - low24h) / price) * 100 : 0;
      const volatility: 'low' | 'medium' | 'high' =
        rangePercent < 3 ? 'low' : rangePercent < 7 ? 'medium' : 'high';

      // Trend from 24h change
      const trend: 'bullish' | 'bearish' | 'neutral' =
        change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral';

      // Score 0-100
      let score = 50 + change24h * 2;
      if (volatility === 'low') score += 10;
      else if (volatility === 'high') score -= 5;
      if (trend === 'bullish') score += 10;
      else if (trend === 'bearish') score -= 10;
      if (volume24h * price > 100_000_000) score += 5;
      score = Math.max(0, Math.min(100, score));

      indicators.push({ asset, price, change24h, volume24h, high24h, low24h, volatility, trend, score });
    } catch (err) {
      logger.warn(`[SUI Cron] Failed to fetch ${asset} price — skipping asset (no zero-data fallback)`, { error: err });
      // Do NOT push zero-data indicators — AI should not make decisions on missing data
    }
  }

  return indicators;
}

function generateAllocation(
  indicators: AssetIndicator[],
  currentAllocations?: Record<PoolAsset, number>
): {
  allocations: Record<PoolAsset, number>;
  confidence: number;
  reasoning: string;
  shouldRebalance: boolean;
} {
  const totalScore = indicators.reduce((s, i) => s + i.score, 0) || 1;
  const sorted = [...indicators].sort((a, b) => b.score - a.score);

  const allocations: Record<string, number> = {};
  let remaining = 100;

  for (let i = 0; i < sorted.length; i++) {
    if (i === sorted.length - 1) {
      allocations[sorted[i].asset] = remaining;
    } else {
      let pct = Math.round((sorted[i].score / totalScore) * 100);
      pct = Math.max(10, Math.min(40, pct));
      allocations[sorted[i].asset] = pct;
      remaining -= pct;
    }
  }

  // Confidence
  const clearTrends = indicators.filter(i => i.trend !== 'neutral').length;
  const highVol = indicators.filter(i => i.volatility === 'high').length;
  const confidence = Math.max(50, Math.min(95, 60 + clearTrends * 8 - highVol * 5));

  // Reasoning
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const reasoning = `SUI USDC Pool AI (${new Date().toISOString().split('T')[0]}): ` +
    `Overweight ${top.asset} (${allocations[top.asset]}%) — ${top.trend}, score ${top.score.toFixed(0)}. ` +
    `Underweight ${bottom.asset} (${allocations[bottom.asset]}%) — ${bottom.trend}, score ${bottom.score.toFixed(0)}. ` +
    `Prices: ${indicators.map(i => `${i.asset}=$${i.price.toLocaleString()}`).join(', ')}.`;

  // Check drift to decide if rebalance needed
  let shouldRebalance = false;
  if (currentAllocations) {
    const maxDrift = Math.max(
      ...POOL_ASSETS.map(a => Math.abs((allocations[a] || 25) - (currentAllocations[a] || 25)))
    );
    shouldRebalance = maxDrift > 5;
  } else {
    shouldRebalance = confidence >= 75;
  }

  return {
    allocations: allocations as Record<PoolAsset, number>,
    confidence,
    reasoning,
    shouldRebalance,
  };
}

// ============================================================================
// Pool → Admin USDC Transfer via open_hedge
// ============================================================================

/**
 * Transfer USDC from SUI pool contract to admin wallet using open_hedge.
 * The Move contract's open_hedge splits USDC from the pool Balance<T> and
 * sends a Coin<T> to state.treasury (the admin/treasury wallet).
 *
 * Requires: SUI_AGENT_CAP_ID env var (the AgentCap object owned by admin).
 *
 * Returns the tx digest on success, or null if transfer is not possible.
 */
async function transferUsdcFromPoolToAdmin(
  network: 'mainnet' | 'testnet',
  amountUsdc: number,
): Promise<{ success: boolean; txDigest?: string; error?: string }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const agentCapId = (process.env.SUI_AGENT_CAP_ID || process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey) {
    return { success: false, error: 'SUI_POOL_ADMIN_KEY not configured' };
  }
  if (!agentCapId) {
    return { success: false, error: 'SUI_AGENT_CAP_ID / SUI_ADMIN_CAP_ID not configured — cannot call open_hedge' };
  }
  if (!poolConfig.packageId || !poolConfig.poolStateId) {
    return { success: false, error: 'Pool package or state ID not configured' };
  }

  try {
    const { Ed25519Keypair, Transaction, SuiClient, getFullnodeUrl } = await import('@mysten/sui/keypairs/ed25519')
      .then(kp => import('@mysten/sui/transactions').then(tx => import('@mysten/sui/client').then(cl => ({
        Ed25519Keypair: kp.Ed25519Keypair,
        Transaction: tx.Transaction,
        SuiClient: cl.SuiClient,
        getFullnodeUrl: cl.getFullnodeUrl,
      }))));

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch {
      return { success: false, error: 'Invalid SUI_POOL_ADMIN_KEY format' };
    }

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const amountRaw = Math.floor(amountUsdc * 1e6); // USDC has 6 decimals on SUI
    const usdcType = SUI_USDC_COIN_TYPE[network];

    const tx = new Transaction();
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::open_hedge`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(agentCapId),              // AgentCap
        tx.object(poolConfig.poolStateId!), // UsdcPoolState
        tx.pure.u8(0),                       // pair_index (0 = rebalance)
        tx.pure.u64(amountRaw),             // collateral_usdc
        tx.pure.u64(1),                     // leverage (1x = spot)
        tx.pure.bool(true),                 // is_long (buying assets)
        tx.pure.string('Cron rebalance: transfer USDC from pool to admin for DEX swaps'),
        tx.object('0x6'),                   // Clock
      ],
    });

    tx.setGasBudget(50_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true },
    });

    const success = result.effects?.status?.status === 'success';
    if (success) {
      logger.info('[SUI Cron] Pool → admin USDC transfer via open_hedge', {
        txDigest: result.digest,
        amountUsdc,
      });
    } else {
      logger.error('[SUI Cron] Pool → admin USDC transfer failed', {
        txDigest: result.digest,
        error: result.effects?.status?.error,
      });
    }

    return { success, txDigest: result.digest, error: success ? undefined : result.effects?.status?.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[SUI Cron] transferUsdcFromPoolToAdmin failed', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Check admin wallet's USDC balance on SUI.
 */
async function getAdminUsdcBalance(network: 'mainnet' | 'testnet'): Promise<number> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey) return 0;

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch {
      return 0;
    }

    const address = keypair.getPublicKey().toSuiAddress();
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const usdcType = SUI_USDC_COIN_TYPE[network];
    const balance = await suiClient.getBalance({ owner: address, coinType: usdcType });
    return Number(balance.totalBalance) / 1e6; // USDC 6 decimals
  } catch {
    return 0;
  }
}

// ============================================================================
// GET Handler — QStash / Vercel Cron
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse<SuiCronResult>> {
  const startTime = Date.now();

  // Verify QStash signature or CRON_SECRET
  const authResult = await verifyCronRequest(request, 'SUI CommunityPool Cron');
  if (authResult !== true) {
    return NextResponse.json(
      { success: false, chain: 'sui', error: 'Unauthorized', duration: Date.now() - startTime },
      { status: 401 }
    );
  }

  const network = ((process.env.SUI_NETWORK || 'testnet').trim()) as 'mainnet' | 'testnet';
  logger.info('[SUI Cron] Starting SUI community pool AI management', { network });

  // MAINNET SAFETY: Reject if contract addresses not configured
  if (network === 'mainnet') {
    const missing = validateSuiMainnetConfig();
    if (missing.length > 0) {
      logger.error('[SUI Cron] MAINNET CONFIG INCOMPLETE — aborting cron', { missing });
      return NextResponse.json(
        { success: false, chain: 'sui' as const, error: `Mainnet not configured. Missing: ${missing.join(', ')}`, duration: Date.now() - startTime },
        { status: 503 }
      );
    }
  }

  // Rate limit: reject if last successful run was less than 5 minutes ago
  const timeSinceLastRun = startTime - lastSuccessfulRunTimestamp;
  if (lastSuccessfulRunTimestamp > 0 && timeSinceLastRun < MIN_CRON_INTERVAL_MS) {
    logger.warn('[SUI Cron] Rate limited — too soon since last run', {
      secondsSinceLast: Math.round(timeSinceLastRun / 1000),
      minIntervalSeconds: MIN_CRON_INTERVAL_MS / 1000,
    });
    return NextResponse.json(
      { success: false, chain: 'sui' as const, error: `Rate limited. Last run ${Math.round(timeSinceLastRun / 1000)}s ago, min interval is ${MIN_CRON_INTERVAL_MS / 1000}s`, duration: Date.now() - startTime },
      { status: 429 }
    );
  }

  try {
    // M3: Validate admin key format early (fail-fast, not during swap execution)
    const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
    if (adminKey) {
      // Reject if someone accidentally set a wallet address (0x + 64 hex) instead of a private key
      // A proper key is either bech32 (suiprivkey...) or will derive a DIFFERENT address than its own hex
      if (!adminKey.startsWith('suiprivkey') && /^0x[0-9a-fA-F]{64}$/.test(adminKey)) {
        // Could be hex key OR an address — derive and check
        try {
          const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
          const kp = Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.slice(2), 'hex'));
          const derived = kp.getPublicKey().toSuiAddress();
          if (derived !== adminKey) {
            // Valid hex key — derives to a different address (expected)
            logger.info('[SUI Cron] Admin key validated', { derivedWallet: derived.slice(0, 16) + '...' });
          }
          // If derived === adminKey, that would be astronomically unlikely for a real key
          // but we don't block it since the key format is technically valid
        } catch {
          logger.error('[SUI Cron] Invalid SUI_POOL_ADMIN_KEY — cannot derive keypair from hex');
          return NextResponse.json(
            { success: false, chain: 'sui' as const, error: 'Invalid SUI_POOL_ADMIN_KEY — failed to derive keypair', duration: Date.now() - startTime },
            { status: 503 }
          );
        }
      } else if (!adminKey.startsWith('suiprivkey')) {
        const isValidHex = /^[0-9a-fA-F]{64}$/.test(adminKey);
        if (!isValidHex) {
          logger.error('[SUI Cron] Invalid SUI_POOL_ADMIN_KEY format — must be suiprivkey... or 64-char hex');
          return NextResponse.json(
            { success: false, chain: 'sui' as const, error: 'Invalid SUI_POOL_ADMIN_KEY format', duration: Date.now() - startTime },
            { status: 503 }
          );
        }
      }
    }

    // Step 0: Ensure DB tables exist
    await initCommunityPoolTables();

    // Step 1: Fetch on-chain SUI pool stats
    const suiService = getSuiUsdcPoolService(network);
    const poolStats = await suiService.getPoolStats();

    logger.info('[SUI Cron] Pool stats fetched', {
      totalNAV: poolStats.totalNAV,
      totalNAVUsd: poolStats.totalNAVUsd,
      members: poolStats.memberCount,
      sharePrice: poolStats.sharePrice,
    });

    // Step 2: Fetch live prices for all 4 assets
    const pricesUSD: Record<string, number> = {};
    let pricesFetched = false;
    try {
      const results = await Promise.allSettled(
        POOL_ASSETS.map(async (asset) => {
          const validated = await getMultiSourceValidatedPrice(asset);
          return { asset, price: validated.price };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          pricesUSD[r.value.asset] = r.value.price;
        }
      }
      pricesFetched = Object.keys(pricesUSD).length === POOL_ASSETS.length;
      logger.info('[SUI Cron] Prices fetched', pricesUSD);
    } catch (priceErr) {
      logger.error('[SUI Cron] Price fetch failed - aborting allocation decisions', { error: priceErr });
      return NextResponse.json({
        success: false,
        chain: 'sui' as const,
        duration: Date.now() - startTime,
        error: 'Price fetch failed - cannot make allocation decisions without prices',
      }, { status: 500 });
    }

    if (!pricesFetched) {
      logger.error('[SUI Cron] Incomplete prices - only got prices for: ' + Object.keys(pricesUSD).join(', '));
      return NextResponse.json({
        success: false,
        chain: 'sui' as const,
        duration: Date.now() - startTime,
        error: `Incomplete price data: got ${Object.keys(pricesUSD).length}/${POOL_ASSETS.length} prices`,
      }, { status: 500 });
    }

    // Step 3: Get AI allocation decision via SuiPoolAgent
    const suiAgent = getSuiPoolAgent(network);
    const indicators = await suiAgent.analyzeMarket();

    // Fetch current allocations from last AI decision in DB (no hardcoded defaults)
    let currentAllocations: Record<PoolAsset, number> = {
      BTC: 0,
      ETH: 0,
      SUI: 0,
      CRO: 0,
    };
    try {
      const lastDecisions = await query(
        `SELECT details FROM community_pool_transactions 
         WHERE type = 'AI_DECISION' AND details->>'chain' = 'sui'
         ORDER BY created_at DESC LIMIT 1`
      ) as Array<{ details: Record<string, unknown> }>;
      if (lastDecisions.length > 0 && lastDecisions[0].details?.allocations) {
        const saved = lastDecisions[0].details.allocations as Record<string, number>;
        for (const asset of POOL_ASSETS) {
          if (typeof saved[asset] === 'number') {
            currentAllocations[asset] = saved[asset];
          }
        }
        logger.info('[SUI Cron] Loaded last AI allocations from DB', currentAllocations);
      } else {
        logger.info('[SUI Cron] No previous AI decision found, using zero allocations (first run)');
      }
    } catch (allocErr) {
      logger.warn('[SUI Cron] Could not load previous allocations from DB', { error: allocErr });
    }

    const aiResult = suiAgent.generateAllocation(indicators, currentAllocations);

    logger.info('[SUI Cron] AI Agent decision', {
      allocations: aiResult.allocations,
      confidence: aiResult.confidence,
      shouldRebalance: aiResult.shouldRebalance,
      swappableAssets: aiResult.swappableAssets,
      hedgedAssets: aiResult.hedgedAssets,
      riskScore: aiResult.riskScore,
    });

    // Step 4: Record NAV snapshot
    // For SUI pool, totalNAV is in SUI. Convert to USD for consistent tracking.
    const navUsd = poolStats.totalNAVUsd || (poolStats.totalNAV * (pricesUSD['SUI'] || 0));
    const sharePriceUsd = poolStats.sharePriceUsd || (poolStats.sharePrice * (pricesUSD['SUI'] || 0));

    try {
      await recordNavSnapshot({
        sharePrice: sharePriceUsd || poolStats.sharePrice,
        totalNav: navUsd || poolStats.totalNAV,
        totalShares: poolStats.totalShares,
        memberCount: poolStats.memberCount,
        allocations: aiResult.allocations,
        source: 'sui-usdc-pool',
        chain: 'sui',
      });
      logger.info('[SUI Cron] NAV snapshot recorded');
    } catch (navErr) {
      logger.warn('[SUI Cron] Failed to record NAV (non-critical)', { error: navErr });
    }

    // Step 5: Sync members to DB from on-chain
    try {
      const members = await suiService.getAllMembers();
      let synced = 0;
      for (const m of members) {
        if (m.shares > 0) {
          await saveUserSharesToDb({
            walletAddress: m.address.toLowerCase(),
            shares: m.shares,
            costBasisUSD: m.valueUsd || m.valueSui * (pricesUSD['SUI'] || 0),
            chain: 'sui',
          });
          synced++;
        }
      }
      logger.info('[SUI Cron] Members synced to DB', { synced, total: members.length });
    } catch (syncErr) {
      logger.warn('[SUI Cron] Member sync failed (non-critical)', { error: syncErr });
    }

    // Step 6: Save pool state to DB
    try {
      const poolAllocRecord: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {};
      for (const asset of POOL_ASSETS) {
        const pct = aiResult.allocations[asset] || 25;
        poolAllocRecord[asset] = {
          percentage: pct,
          valueUSD: navUsd * (pct / 100),
          amount: 0,
          price: pricesUSD[asset] || 0,
        };
      }

      await savePoolStateToDb({
        totalValueUSD: navUsd,
        totalShares: poolStats.totalShares,
        sharePrice: sharePriceUsd || 1,
        allocations: poolAllocRecord,
        lastRebalance: Date.now(),
        lastAIDecision: {
          timestamp: Date.now(),
          reasoning: aiResult.reasoning,
          allocations: aiResult.allocations,
        },
        chain: 'sui',
      });
      logger.info('[SUI Cron] Pool state saved to DB');
    } catch (dbErr) {
      logger.warn('[SUI Cron] DB pool state save failed (non-critical)', { error: dbErr });
    }

    // Step 7: Plan + Execute rebalance via SuiPoolAgent
    // Trigger swaps when:
    //  a) AI detects allocation drift and recommends rebalancing, OR
    //  b) Pool has USDC that hasn't been converted to assets yet (first allocation)
    //     If all previous DB-stored allocations are 0, it's the first run and all USDC
    //     needs to be swapped/hedged into assets. Also force rebalance when the pool has
    //     never had successful swaps (no DB swap records).
    let rebalanceSwaps: SuiCronResult['rebalanceSwaps'] = undefined;
    const hasUnallocatedUsdc = navUsd > 1 && (
      currentAllocations.BTC === 0 &&
      currentAllocations.ETH === 0 &&
      currentAllocations.SUI === 0 &&
      currentAllocations.CRO === 0
    );
    // Always execute swaps if pool has value — on SUI, "swaps" are BlueFin perp hedges
    // that need to be opened/adjusted to reflect AI allocations
    const shouldExecuteSwaps = navUsd > 1;
    if (hasUnallocatedUsdc) {
      logger.info('[SUI Cron] Unallocated USDC detected — triggering initial asset allocation', { navUsd });
    }
    if (shouldExecuteSwaps) {
      try {
        const aggregator = getBluefinAggregatorService(network);

        const plan = await aggregator.planRebalanceSwaps(
          navUsd,
          aiResult.allocations as Record<PoolAsset, number>,
        );

        const onChainCount = plan.swaps.filter(s => s.canSwapOnChain).length;
        const simulatedCount = plan.swaps.filter(s => s.isSimulated).length;

        rebalanceSwaps = {
          planned: plan.swaps.length,
          executable: onChainCount,
          quotes: plan.swaps.map(s => ({
            asset: s.asset,
            amountInUsdc: (Number(s.amountIn) / 1e6).toFixed(2),
            expectedOut: s.expectedAmountOut,
            route: s.route,
            canSwap: s.canSwapOnChain,
          })),
        };

        // Attach agent metadata
        rebalanceSwaps.simulated = simulatedCount;
        rebalanceSwaps.swappableAssets = aiResult.swappableAssets;
        rebalanceSwaps.hedgedAssets = aiResult.hedgedAssets;

        logger.info('[SUI Cron] Agent rebalance plan', {
          planned: plan.swaps.length,
          onChain: onChainCount,
          simulated: simulatedCount,
          quotes: plan.swaps.map(q => 
            `${q.asset}: $${(Number(q.amountIn) / 1e6).toFixed(2)} → ${q.expectedAmountOut} (${q.route})${q.isSimulated ? ' [simulated]' : ''}`
          ),
        });

        // Step 7b: Ensure admin wallet has USDC for swaps (transfer from pool if needed)
        const hedgeableCount = plan.swaps.filter(s => !s.canSwapOnChain && s.hedgeVia === 'bluefin').length;
        if (process.env.SUI_POOL_ADMIN_KEY && (onChainCount > 0 || hedgeableCount > 0)) {
          // Calculate total USDC needed for on-chain swaps + hedges
          const totalUsdcNeeded = plan.swaps
            .filter(s => s.canSwapOnChain || s.hedgeVia === 'bluefin')
            .reduce((sum, s) => sum + Number(s.amountIn) / 1e6, 0);

          // Check admin wallet USDC balance
          const adminUsdcBalance = await getAdminUsdcBalance(network);
          logger.info('[SUI Cron] Admin wallet USDC check', {
            available: adminUsdcBalance.toFixed(2),
            needed: totalUsdcNeeded.toFixed(2),
          });

          // If admin wallet doesn't have enough USDC, transfer from pool via open_hedge
          if (adminUsdcBalance < totalUsdcNeeded * 0.95) { // 5% tolerance
            const deficit = totalUsdcNeeded - adminUsdcBalance;

            // Cap transfer at on-chain contract limits:
            // - max_hedge_ratio: 50% of NAV can be hedged/transferred total
            // - reserve_ratio: 20% of balance must stay in pool
            const maxByHedgeRatio = navUsd * 0.5; // 5000 BPS max hedge ratio
            const maxByReserve = navUsd * 0.8;     // 2000 BPS (20%) reserve requirement
            const maxTransferable = Math.min(maxByHedgeRatio, maxByReserve);
            const cappedDeficit = Math.min(deficit, maxTransferable * 0.95); // 5% safety margin

            logger.info('[SUI Cron] Admin USDC insufficient — transferring from pool via open_hedge', {
              deficit: deficit.toFixed(2),
              maxTransferable: maxTransferable.toFixed(2),
              cappedDeficit: cappedDeficit.toFixed(2),
            });

            const transferResult = await transferUsdcFromPoolToAdmin(network, cappedDeficit);
            (rebalanceSwaps as any).poolTransfer = {
              requested: cappedDeficit.toFixed(2),
              success: transferResult.success,
              txDigest: transferResult.txDigest,
              error: transferResult.error,
            };
            if (transferResult.success) {
              logger.info('[SUI Cron] Pool → admin USDC transfer successful', {
                txDigest: transferResult.txDigest,
                amount: cappedDeficit.toFixed(2),
              });
              // Small delay for state propagation
              await new Promise(r => setTimeout(r, 2000));
            } else {
              logger.warn('[SUI Cron] Pool → admin USDC transfer failed (proceeding with available balance)', {
                error: transferResult.error,
              });
            }
          }

          // Step 7c: Execute on-chain swaps
          try {
            const execResult = await aggregator.executeRebalance(plan, 0.015);
            
            rebalanceSwaps.executed = execResult.totalExecuted;
            rebalanceSwaps.failed = execResult.totalFailed;
            rebalanceSwaps.txDigests = execResult.results
              .filter((r): r is typeof r & { txDigest: string } => !!r.txDigest)
              .map(r => ({ asset: r.asset, digest: r.txDigest }));

            logger.info('[SUI Cron] On-chain swaps executed', {
              executed: execResult.totalExecuted,
              failed: execResult.totalFailed,
              digests: execResult.results.filter(r => r.txDigest).map(r => r.txDigest),
            });
          } catch (execErr) {
            logger.error('[SUI Cron] On-chain swap execution failed', { error: execErr });
            (rebalanceSwaps as any).executionError = execErr instanceof Error ? execErr.message : String(execErr);
          }
        } else if (!process.env.SUI_POOL_ADMIN_KEY) {
          logger.info('[SUI Cron] Swap execution skipped — SUI_POOL_ADMIN_KEY not set (quotes only)');
        }

        // Step 7d: Log hedged/simulated positions
        const hedgedPositions = plan.swaps.filter(s => s.isSimulated || !s.canSwapOnChain);
        if (hedgedPositions.length > 0) {
          (rebalanceSwaps as any).hedgedPositions = hedgedPositions.map(s => ({
            asset: s.asset,
            method: s.hedgeVia || 'price-tracked',
            usdcAllocated: (Number(s.amountIn) / 1e6).toFixed(2),
            estimatedQty: s.expectedAmountOut,
            route: s.route,
          }));
          logger.info('[SUI Cron] Hedged positions tracked', {
            count: hedgedPositions.length,
            assets: hedgedPositions.map(s => `${s.asset}: $${(Number(s.amountIn) / 1e6).toFixed(2)} via ${s.hedgeVia || 'virtual'}`),
          });
        }

      } catch (swapErr) {
        logger.warn('[SUI Cron] Rebalance planning failed (non-critical)', { error: swapErr });
      }
    }

    // Step 8: Auto-Hedge via BlueFin if risk exceeds threshold
    let autoHedgeResult: { triggered: boolean; hedges?: Array<{ symbol: string; side: string; size: number; status: string; orderId?: string; error?: string }> } = { triggered: false };
    try {
      // Load auto-hedge config for SUI pool
      const allConfigs = await getAutoHedgeConfigs();
      const suiPoolConfig = allConfigs.find(c => 
        isSuiCommunityPool(c.portfolioId) || 
        c.portfolioId === SUI_COMMUNITY_POOL_PORTFOLIO_ID ||
        (c as any).poolAddress === process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID
      );

      if (suiPoolConfig?.enabled) {
        const riskScore = aiResult.riskScore ?? 0;
        const threshold = suiPoolConfig.riskThreshold ?? 2;

        logger.info('[SUI Cron] Auto-hedge check', {
          enabled: true,
          riskScore,
          threshold,
          shouldHedge: riskScore >= threshold,
        });

        if (riskScore >= threshold) {
          // Risk exceeds threshold - open protective hedges on BlueFin
          const hedges: typeof autoHedgeResult.hedges = [];
          
          // Only hedge if BlueFin credentials are configured
          if (process.env.BLUEFIN_PRIVATE_KEY) {
            try {
              const bluefin = BluefinService.getInstance();
              const leverage = Math.min(suiPoolConfig.maxLeverage || 3, 5);

              // Calculate hedge sizes based on pool NAV and allocations
              // Open SHORT hedges on overweight assets to protect against downside
              for (const asset of ['BTC', 'ETH', 'SUI'] as const) {
                const allocation = aiResult.allocations[asset] || 0;
                if (allocation >= 25) { // Only hedge significant positions (>25%)
                  const hedgeValueUSD = navUsd * (allocation / 100) * 0.5; // Hedge 50% of position
                  const hedgeSizeBase = hedgeValueUSD / (pricesUSD[asset] || 1);

                  if (hedgeSizeBase > 0.001) {
                    try {
                      const result = await bluefin.openHedge({
                        symbol: `${asset}-PERP`,
                        side: 'SHORT', // Protective short to hedge long spot exposure
                        size: hedgeSizeBase,
                        leverage,
                        portfolioId: -2, // SUI pool special ID
                        reason: `Auto-hedge: Risk ${riskScore}/10 > threshold ${threshold}/10`,
                      });

                      hedges.push({
                        symbol: `${asset}-PERP`,
                        side: 'SHORT',
                        size: hedgeSizeBase,
                        status: result.success ? 'OPENED' : 'FAILED',
                        orderId: result.orderId,
                        error: result.error,
                      });

                      logger.info(`[SUI Cron] Opened ${asset} hedge`, {
                        symbol: `${asset}-PERP`,
                        side: 'SHORT',
                        size: hedgeSizeBase,
                        leverage,
                        success: result.success,
                        orderId: result.orderId,
                      });
                    } catch (hedgeErr) {
                      hedges.push({
                        symbol: `${asset}-PERP`,
                        side: 'SHORT',
                        size: hedgeSizeBase,
                        status: 'ERROR',
                        error: hedgeErr instanceof Error ? hedgeErr.message : String(hedgeErr),
                      });
                      logger.error(`[SUI Cron] Failed to hedge ${asset}`, { error: hedgeErr });
                    }
                  }
                }
              }

              autoHedgeResult = { triggered: true, hedges };
            } catch (bfErr) {
              logger.error('[SUI Cron] BlueFin hedging failed', { error: bfErr });
              autoHedgeResult = { 
                triggered: true, 
                hedges: [{ symbol: 'ALL', side: 'N/A', size: 0, status: 'ERROR', error: String(bfErr) }] 
              };
            }
          } else {
            logger.info('[SUI Cron] Risk threshold exceeded but BLUEFIN_PRIVATE_KEY not set (hedge skipped)');
            autoHedgeResult = { triggered: false };
          }
        }
      } else {
        logger.debug('[SUI Cron] Auto-hedging disabled for SUI pool');
      }
    } catch (hedgeConfigErr) {
      logger.warn('[SUI Cron] Auto-hedge config check failed (non-critical)', { error: hedgeConfigErr });
    }

    // Step 9: Log AI decision to transaction history
    try {
      const decisionId = `sui_ai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await addPoolTransactionToDb({
        id: decisionId,
        type: 'AI_DECISION',
        chain: 'sui',
        details: {
          chain: 'sui',
          agent: 'SuiPoolAgent',
          action: aiResult.shouldRebalance ? 'REBALANCE' : 'HOLD',
          allocations: aiResult.allocations,
          confidence: aiResult.confidence,
          reasoning: aiResult.reasoning,
          swappableAssets: aiResult.swappableAssets,
          hedgedAssets: aiResult.hedgedAssets,
          riskScore: aiResult.riskScore,
          prices: pricesUSD,
          rebalanceQuotes: rebalanceSwaps,
          poolNAV_USDC: navUsd,
          poolSharePrice: sharePriceUsd,
          memberCount: poolStats.memberCount,
        },
      });
    } catch (txErr) {
      logger.warn('[SUI Cron] Transaction log failed (non-critical)', { error: txErr });
    }

    // Build response
    const result: SuiCronResult = {
      success: true,
      chain: 'sui',
      poolStats: {
        totalNAV_USDC: navUsd.toFixed(2),
        totalShares: poolStats.totalShares.toFixed(4),
        sharePrice: (sharePriceUsd || poolStats.sharePrice).toFixed(6),
        memberCount: poolStats.memberCount,
        allocations: aiResult.allocations,
      },
      aiDecision: {
        action: aiResult.shouldRebalance ? 'REBALANCE' : 'HOLD',
        allocations: aiResult.allocations,
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        swappableAssets: aiResult.swappableAssets,
        hedgedAssets: aiResult.hedgedAssets,
        riskScore: aiResult.riskScore,
      },
      pricesUSD,
      autoHedge: autoHedgeResult.triggered ? autoHedgeResult : undefined,
      rebalanceSwaps,
      duration: Date.now() - startTime,
    };

    logger.info('[SUI Cron] Completed successfully', {
      duration: result.duration,
      action: result.aiDecision?.action,
      autoHedgeTriggered: autoHedgeResult.triggered,
    });

    // Update rate limit timestamp on success
    lastSuccessfulRunTimestamp = Date.now();

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[SUI Cron] Failed', { error: message });

    return NextResponse.json(
      {
        success: false,
        chain: 'sui' as const,
        error: message,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// QStash sends POST by default — support both methods
export const POST = GET;
