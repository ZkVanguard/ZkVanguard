/**
 * Cron Job: SUI Community Pool AI Management (USDC)
 * 
 * Invoked by Upstash QStash every 30 minutes to:
 * 1. Fetch SUI pool on-chain stats (USDC balance, shares, members)
 * 2. Record NAV snapshot with 3-asset allocation tracking (BTC/ETH/SUI)
 * 3. Sync member data from on-chain → DB
 * 4. Run AI allocation decision (BTC/ETH/SUI)
 * 5. Trigger auto-hedge via BlueFin when risk is elevated
 * 
 * 3 Assets: BTC, ETH, SUI
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
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { query } from '@/lib/db/postgres';
import { getCronStateOr, setCronState, tryClaimCronRun, getCronHalt, setCronHalt, endOfUtcDayMs, CronKeys } from '@/lib/db/cron-state';
import { getMultiSourceValidatedPrice } from '@/lib/services/market-data/unified-price-provider';
import { getBluefinAggregatorService, type PoolAsset as BluefinPoolAsset } from '@/lib/services/sui/BluefinAggregatorService';
import { getSuiPoolAgent, type AllocationDecision } from '@/agents/specialized/SuiPoolAgent';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { recordPoolNavSnapshot, syncMembersToDb, savePoolState } from '@/lib/services/sui/cron/persistence';
import { resolveLeverage, hedgeRatioForNav, computeTargetMargin, hedgeValueUsd, scaledReserves } from '@/lib/services/sui/cron/hedge-sizing';
import { isStrongHedgeSignal } from '@/lib/services/sui/cron/signal-gating';
import { notifyDiscord } from '@/lib/utils/discord-notify';
// v0.3.0 defense dispatch — statically imported so the graph sees the
// call chain. Previously loaded via `await import()` inside try-blocks
// (36 dynamic imports in this file); tree-sitter can't resolve those,
// so the entire defense pipeline was invisible in graph queries.
// Enclosing try-blocks handle runtime failures; converting the imports
// doesn't change error semantics (they still swallow throws).
import { checkAndCloseDrifts } from '@/lib/services/agents/position-drift-monitor';
import { runStep8AutoHedge } from '@/lib/services/sui/cron/step-8-auto-hedge';
import { runStep4NavDefense } from '@/lib/services/sui/cron/step-4-nav-defense';
import { runStep7Rebalance } from '@/lib/services/sui/cron/step-7-rebalance';
import { replenishAdminUsdc, getAdminUsdcBalance } from '@/lib/services/sui/cron/hedge-treasury';
import { runPolyDiscoverTick } from '@/lib/services/market-data/poly-discover-tick';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Rate limiting: prevent duplicate cron runs within 5 minutes.
// `lastSuccessfulRunTimestamp` is a per-instance fast-path; the real
// guard is the DB-backed CAS lock (`tryClaimCronRun`) so QStash retries
// and Vercel cold-start instances cannot double-execute.
let lastSuccessfulRunTimestamp = 0;
const MIN_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CRON_LOCK_KEY = 'sui-community-pool';
// Hard ceiling on pool NAV in USDC. Above this, the on-chain Move
// fee/withdrawal-cap math (`nav * bps * t`) approaches u64 limits
// and silently wraps. Mainnet contracts must be redeployed with u128
// before crossing this threshold. Override only after verifying the
// new package id has the u128 fixes.
// The Move contract already uses u128 intermediates for every NAV × bps ×
// time multiplication (community_pool_usdc.move:713, :738, :763), so the
// arithmetic itself is safe up to $18 trillion (u64::MAX in USDC micro-
// units). The ceiling here is a defensive shim that also gates against
// second-order risks:
//   - accumulated fee counters (u64) — safe up to ~$1.8T total accrued
//   - BlueFin perp OI ceiling (venue-level) — real limit ~$10-100M today
//   - single-tx DEX slippage — real limit ~$1-5M
// $10B is chosen as the *scale-readiness* ceiling; above that the
// multi-venue router + OTC path must be active or the pool blocks writes.
const NAV_SAFETY_CEILING_USDC = Number(process.env.NAV_SAFETY_CEILING_USDC) || 10_000_000_000;

// Step 6.6 drift-rebalance tunables. Together they bound the per-tick
// blast radius — at most MAX_REBALANCE_SELL_USD of any one overweight
// asset can be reverse-swapped per tick, and only when its drift from
// AI target exceeds REBALANCE_DRIFT_THRESHOLD_PCT.
const REBALANCE_DRIFT_THRESHOLD_PCT = Number(process.env.REBALANCE_DRIFT_THRESHOLD_PCT) || 10;
const MAX_REBALANCE_SELL_USD = Number(process.env.MAX_REBALANCE_SELL_USD) || 20;

// 3 pool assets (SUI community pool — BTC, ETH, SUI only)
const POOL_ASSETS = ['BTC', 'ETH', 'SUI'] as const;
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
  driftRebalance?: {
    preHoldings: Record<string, number>;
    targets: Record<string, number>;
    deltas: Record<string, number>;
    sold: Array<{ asset: string; usdcReceived: number; driftPct: number; txDigest?: string; error?: string }>;
    totalSoldUsdc: number;
    executionAllocations?: Record<string, number>;
    skippedReason?: string;
  };
  duration: number;
  error?: string;
}

// ============================================================================
// Pool ↔ Admin USDC Transfers (open_hedge / close_hedge)
// ============================================================================

/**
 * Return USDC from admin wallet back to the pool via close_hedge.
 * This settles active hedges by returning collateral (+ optional PnL) to the pool.
 *
 * The Move contract's close_hedge:
 *  1. Finds the hedge by ID in active_hedges
 *  2. Removes it and decrements total_hedged_value
 *  3. Joins the passed-in Coin<T> into the pool balance
 *
 * This MUST be called after DEX swaps to return any unused USDC to the pool.
 */
async function returnUsdcToPool(
  network: 'mainnet' | 'testnet',
  hedgeId: number[],
  amountUsdc: number,
  pnlUsdc: number,
  isProfit: boolean,
): Promise<{ success: boolean; txDigest?: string; error?: string }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const agentCapId = (process.env.SUI_AGENT_CAP_ID || process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey || !agentCapId || !poolConfig.packageId || !poolConfig.poolStateId) {
    return { success: false, error: 'Missing admin key, agent cap, or pool config' };
  }

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch {
      return { success: false, error: 'Invalid admin key format' };
    }

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const usdcType = SUI_USDC_COIN_TYPE[network];
    const amountRaw = Math.floor(amountUsdc * 1e6);
    const pnlRaw = Math.floor(pnlUsdc * 1e6);

    // Get admin's USDC coins and merge them into a single coin for the return
    const address = keypair.getPublicKey().toSuiAddress();
    const coins = await suiClient.getCoins({ owner: address, coinType: usdcType });
    
    if (!coins.data || coins.data.length === 0) {
      return { success: false, error: 'Admin has no USDC coins to return' };
    }

    const totalAvailable = coins.data.reduce((sum, c) => sum + Number(c.balance), 0);
    if (totalAvailable < amountRaw) {
      return { success: false, error: `Admin only has ${(totalAvailable / 1e6).toFixed(6)} USDC, need ${amountUsdc}` };
    }

    const tx = new Transaction();

    // Merge all USDC coins into one, then split the exact amount needed
    let primaryCoin: ReturnType<typeof tx.object>;
    if (coins.data.length === 1) {
      primaryCoin = tx.object(coins.data[0].coinObjectId);
    } else {
      // Merge all coins into the first one
      primaryCoin = tx.object(coins.data[0].coinObjectId);
      const mergeCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
      if (mergeCoins.length > 0) {
        tx.mergeCoins(primaryCoin, mergeCoins);
      }
    }

    // Split exact amount to return to pool
    const [returnCoin] = tx.splitCoins(primaryCoin, [amountRaw]);

    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::close_hedge`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(agentCapId),              // AgentCap
        tx.object(poolConfig.poolStateId!), // UsdcPoolState
        tx.pure.vector('u8', hedgeId),      // hedge_id bytes
        tx.pure.u64(pnlRaw),               // pnl_usdc
        tx.pure.bool(isProfit),             // is_profit
        returnCoin,                          // Coin<USDC> to return to pool
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
    logger.info('[SUI Cron] close_hedge result', {
      success,
      txDigest: result.digest,
      amountUsdc,
      pnlUsdc,
      isProfit,
      error: success ? undefined : result.effects?.status?.error,
    });

    return { success, txDigest: result.digest, error: success ? undefined : result.effects?.status?.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[SUI Cron] returnUsdcToPool failed', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Read active hedges from on-chain pool state.
 * Returns hedge IDs and collateral amounts for settlement.
 */
async function getActiveHedges(network: 'mainnet' | 'testnet'): Promise<Array<{
  hedgeId: number[];
  collateralUsdc: number;
  pairIndex: number;
  openTime: number;
}>> {
  const poolConfig = SUI_USDC_POOL_CONFIG[network];
  if (!poolConfig.poolStateId) return [];

  try {
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const obj = await suiClient.getObject({
      id: poolConfig.poolStateId,
      options: { showContent: true },
    });
    const fields = (obj.data?.content as any)?.fields;
    const hedges = fields?.hedge_state?.fields?.active_hedges || [];

    return hedges.map((h: any) => {
      const hf = h.fields || h;
      return {
        hedgeId: Array.isArray(hf.hedge_id) ? hf.hedge_id : [],
        collateralUsdc: Number(hf.collateral_usdc || 0) / 1e6,
        pairIndex: Number(hf.pair_index || 0),
        openTime: Number(hf.open_time || 0),
      };
    });
  } catch (err) {
    logger.warn('[SUI Cron] Failed to read active hedges', { error: err });
    return [];
  }
}

/**
 * Settle all active hedges by returning USDC from admin wallet to pool.
 * Called after DEX swap execution to ensure pool balance is restored.
 *
 * The amount returned for each hedge = original collateral (no PnL tracking
 * since the pool is USDC-denominated and token positions are held externally).
 */
async function settleActiveHedges(
  network: 'mainnet' | 'testnet',
): Promise<{ settled: number; failed: number; details: Array<{ hedgeId: string; amount: number; success: boolean; error?: string }> }> {
  const hedges = await getActiveHedges(network);
  if (hedges.length === 0) {
    logger.info('[SUI Cron] No active hedges to settle');
    return { settled: 0, failed: 0, details: [] };
  }

  // Check admin USDC balance
  const adminUsdc = await getAdminUsdcBalance(network);
  const totalNeeded = hedges.reduce((sum, h) => sum + h.collateralUsdc, 0);

  logger.info('[SUI Cron] Settling active hedges', {
    hedgeCount: hedges.length,
    totalCollateral: totalNeeded.toFixed(6),
    adminUsdc: adminUsdc.toFixed(6),
  });

  const details: Array<{ hedgeId: string; amount: number; success: boolean; pnl?: number; error?: string }> = [];
  let settled = 0;
  let failed = 0;
  let remainingUsdc = adminUsdc;

  // Distribute ALL admin USDC proportionally across hedges.
  // If assets appreciated → pool gets back MORE than collateral (profit).
  // If assets depreciated → pool gets back LESS than collateral (loss).
  for (const hedge of hedges) {
    const proportion = totalNeeded > 0 ? hedge.collateralUsdc / totalNeeded : 1 / hedges.length;
    const returnAmount = Math.min(adminUsdc * proportion, remainingUsdc);
    if (returnAmount < 0.000001) {
      logger.warn('[SUI Cron] Insufficient admin USDC to settle hedge', {
        needed: hedge.collateralUsdc,
        available: remainingUsdc,
      });
      details.push({
        hedgeId: Buffer.from(hedge.hedgeId).toString('hex').slice(0, 16),
        amount: hedge.collateralUsdc,
        success: false,
        error: 'Insufficient admin USDC',
      });
      failed++;
      continue;
    }

    const pnlAmount = Math.abs(returnAmount - hedge.collateralUsdc);
    const isProfit = returnAmount >= hedge.collateralUsdc;

    const result = await returnUsdcToPool(
      network,
      hedge.hedgeId,
      returnAmount,
      pnlAmount,
      isProfit,
    );

    details.push({
      hedgeId: Buffer.from(hedge.hedgeId).toString('hex').slice(0, 16),
      amount: returnAmount,
      success: result.success,
      pnl: isProfit ? pnlAmount : -pnlAmount,
      error: result.error,
    });

    if (result.success) {
      settled++;
      remainingUsdc -= returnAmount;
      // Small delay between transactions to avoid nonce issues
      await new Promise(r => setTimeout(r, 1500));
    } else {
      failed++;
    }
  }

  logger.info('[SUI Cron] Hedge settlement complete', { settled, failed, totalHedges: hedges.length });
  return { settled, failed, details };
}

/**
 * Canonicalize a Move struct tag by zero-padding the address portion to
 * 32 bytes (64 hex chars). `suix_getAllBalances` returns coin types with
 * the address stripped of leading zeros (e.g. `0x27792d9...::coin::COIN`),
 * but the configured `MAINNET_COIN_TYPES` use the canonical 64-char form
 * (`0x027792d9...::coin::COIN`). A naive `===` comparison silently misses
 * every match — root cause of the "preHoldings show $0 even though
 * wallet has $33 wBTC" bug on the first drift-rebalance test.
 */
// canonicalizeCoinType extracted to lib/services/sui/coin-type.ts
import { canonicalizeCoinType } from '@/lib/services/sui/coin-type';

/**
 * Read per-asset USD values held by the admin wallet (spot leg of the
 * dual-leg strategy). SUI is counted minus the 1-SUI gas reserve. USDC
 * and BlueFin margin are NOT counted here — this function returns only
 * the asset-spot values that the drift-rebalance compares against AI
 * target percentages.
 */
async function getAdminAssetValuesUsd(
  network: 'mainnet' | 'testnet',
  pricesUSD: Record<string, number>,
): Promise<Record<PoolAsset, number>> {
  const empty: Record<PoolAsset, number> = { BTC: 0, ETH: 0, SUI: 0 };
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey) return empty;
  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
    const keypair = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    const address = keypair.getPublicKey().toSuiAddress();
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });
    const aggregator = getBluefinAggregatorService(network);
    const allBalances = await suiClient.getAllBalances({ owner: address });
    const result: Record<PoolAsset, number> = { BTC: 0, ETH: 0, SUI: 0 };
    // Build canonical lookup of {canonicalCoinType → PoolAsset} once.
    const canonMap = new Map<string, PoolAsset>();
    for (const a of POOL_ASSETS) {
      const assetType = aggregator.getAssetCoinType(a as BluefinPoolAsset);
      if (assetType) canonMap.set(canonicalizeCoinType(assetType), a as PoolAsset);
    }
    for (const bal of allBalances) {
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;
      const a = canonMap.get(canonicalizeCoinType(bal.coinType));
      if (!a) continue;
      const decimals = a === 'SUI' ? 9 : 8;
      const amount = raw / Math.pow(10, decimals);
      const price = pricesUSD[a] || 0;
      let usd = 0;
      if (a === 'SUI') {
        const swappable = Math.max(0, amount - 1.0);
        usd = swappable * price;
      } else {
        usd = amount * price;
      }
      result[a] = (result[a] || 0) + usd;
    }
    return result;
  } catch (err) {
    logger.warn('[SUI Cron] getAdminAssetValuesUsd failed', { error: err instanceof Error ? err.message : String(err) });
    return empty;
  }
}

/**
 * Sell a specific dollar amount of a single asset to USDC via the 7k
 * aggregator. Used by Step 6.6 drift rebalance to free USDC from
 * overweight asset(s) for Step 7 to buy underweight ones. Unlike
 * replenishAdminUsdc (which iterates largest-first to cover a shortfall),
 * this targets one specific asset with one targeted swap.
 */
async function sellAssetForUsdc(
  network: 'mainnet' | 'testnet',
  asset: BluefinPoolAsset,
  targetUsdc: number,
  pricesUSD: Record<string, number>,
): Promise<{ swapped: number; txDigest?: string; error?: string }> {
  if (targetUsdc < 0.10) return { swapped: 0, error: 'target below $0.10 minimum' };
  const price = pricesUSD[asset] || 0;
  if (price <= 0) return { swapped: 0, error: 'no price' };
  try {
    const aggregator = getBluefinAggregatorService(network);
    // Compute asset amount to swap (with 5% slippage buffer baked in)
    const assetAmountToSwap = (targetUsdc * 1.05) / price;
    const quote = await aggregator.getReverseSwapQuote(asset, assetAmountToSwap);
    if (!quote.canSwapOnChain || !quote.routerData) {
      return { swapped: 0, error: 'No on-chain route' };
    }
    const swapResult = await aggregator.executeSwap(quote, 0.02); // 2% slippage tolerance
    const usdcReceived = Number(swapResult.amountOut || '0') / 1e6;
    if (swapResult.success) {
      return { swapped: usdcReceived, txDigest: swapResult.txDigest };
    }
    return { swapped: 0, error: swapResult.error };
  } catch (err) {
    return { swapped: 0, error: err instanceof Error ? err.message : String(err) };
  }
}


/**
 * Sum the USD value of admin wallet's non-USDC, non-SUI-gas holdings.
 *
 * Used as a guard before settleActiveHedges: if replenishAdminUsdc only
 * partially converted wBTC/wETH/SUI back to USDC (e.g. aggregator route
 * missing for one asset, slippage tripped, RPC hiccup), settling hedges
 * with whatever USDC made it back writes a fake "realized loss" to the
 * hedge rows while the real value sits idle in the admin wallet. Skip the
 * settlement tick when residual non-USDC value > $1 so the loss path only
 * triggers after a clean replenish.
 *
 * SUI is excluded up to a small gas-reserve threshold — the cron always
 * keeps ~1 SUI for gas, not because replenishment failed.
 */
async function getAdminNonUsdcUsdValue(
  network: 'mainnet' | 'testnet',
  prices: Record<string, number>,
): Promise<number> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey) return 0;
  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
    const keypair = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    const address = keypair.getPublicKey().toSuiAddress();
    const rpcUrl = network === 'mainnet'
      ? ((process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim())
      : ((process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim());
    const suiClient = new SuiClient({ url: rpcUrl });
    const aggregator = getBluefinAggregatorService(network);
    const all = await suiClient.getAllBalances({ owner: address });
    let usdResidual = 0;
    const SUI_GAS_RESERVE = 1.5; // 1 SUI floor + 0.5 buffer
    for (const bal of all) {
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;
      for (const asset of POOL_ASSETS) {
        const t = aggregator.getAssetCoinType(asset as BluefinPoolAsset);
        if (!t || bal.coinType !== t) continue;
        const decimals = asset === 'SUI' ? 9 : 8;
        const amount = raw / Math.pow(10, decimals);
        const swappable = asset === 'SUI' ? Math.max(0, amount - SUI_GAS_RESERVE) : amount;
        const price = prices[asset] || 0;
        usdResidual += swappable * price;
        break;
      }
    }
    return usdResidual;
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

  // Rate limit + distributed lock. The in-memory check is a fast-path that
  // catches same-instance reruns; the DB CAS is the authority that defeats
  // QStash retries and Vercel cold-start duplicates.
  const timeSinceLastRun = startTime - lastSuccessfulRunTimestamp;
  if (lastSuccessfulRunTimestamp > 0 && timeSinceLastRun < MIN_CRON_INTERVAL_MS) {
    logger.warn('[SUI Cron] Rate limited (in-memory) — too soon since last run', {
      secondsSinceLast: Math.round(timeSinceLastRun / 1000),
      minIntervalSeconds: MIN_CRON_INTERVAL_MS / 1000,
    });
    return NextResponse.json(
      { success: false, chain: 'sui' as const, error: `Rate limited. Last run ${Math.round(timeSinceLastRun / 1000)}s ago, min interval is ${MIN_CRON_INTERVAL_MS / 1000}s`, duration: Date.now() - startTime },
      { status: 429 }
    );
  }
  // DB-backed CAS lock: fails closed on any error so we never double-fire.
  const claim = await tryClaimCronRun(CRON_LOCK_KEY, MIN_CRON_INTERVAL_MS, startTime);
  if (!claim.claimed) {
    logger.warn('[SUI Cron] Distributed lock denied run', {
      reason: claim.reason,
      lastRunMs: claim.lastRunMs,
      secondsSinceLast: claim.lastRunMs > 0 ? Math.round((startTime - claim.lastRunMs) / 1000) : null,
    });
    return NextResponse.json(
      {
        success: false,
        chain: 'sui' as const,
        error: `Distributed lock denied (${claim.reason || 'unknown'})`,
        duration: Date.now() - startTime,
      },
      { status: 429 },
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
          // Reject 0/NaN/Infinity prices — these break NAV math and cause
          // divide-by-zero in size = notional/price. Better to halt the
          // cycle than to open Infinity-sized hedges.
          const p = Number(r.value.price);
          if (Number.isFinite(p) && p > 0) {
            pricesUSD[r.value.asset] = p;
          }
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
    // Uses enhanced pipeline: prediction markets + risk cascade + sentiment + correlation
    const suiAgent = getSuiPoolAgent(network);

    // Fetch current allocations from last AI decision in DB (no hardcoded defaults)
    const currentAllocations: Record<string, number> = {
      BTC: 0,
      ETH: 0,
      SUI: 0,
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

    // Try enhanced allocation (prediction markets + AI intelligence) first,
    // fall back to basic allocation if external APIs are unavailable
    let aiResult: AllocationDecision;
    let enhancedContext: {
      marketSentiment?: string;
      recommendations?: string[];
      riskAlerts?: string[];
      correlationInsight?: string;
      predictionSignals?: Array<{ market: string; signal: string; probability: number }>;
      urgency?: string;
    } = {};

    try {
      const enhanced = await suiAgent.getEnhancedAllocationContext();
      aiResult = {
        allocations: enhanced.allocations,
        confidence: enhanced.confidence,
        reasoning: enhanced.reasoning,
        shouldRebalance: true, // Enhanced context triggers rebalance when urgency is medium+
        swappableAssets: ['BTC', 'ETH', 'SUI'] as PoolAsset[],
        hedgedAssets: [] as PoolAsset[],
        riskScore: enhanced.urgency === 'CRITICAL' ? 9 : enhanced.urgency === 'HIGH' ? 7 : enhanced.urgency === 'MEDIUM' ? 5 : 3,
      };
      // Check drift to decide if rebalance is actually needed
      const maxDrift = Math.max(
        ...POOL_ASSETS.map(a => Math.abs((enhanced.allocations[a] || 25) - (currentAllocations[a] || 25)))
      );
      aiResult.shouldRebalance = maxDrift > 3 || enhanced.confidence >= 65 || enhanced.urgency === 'MEDIUM' || enhanced.urgency === 'HIGH' || enhanced.urgency === 'CRITICAL';

      enhancedContext = {
        marketSentiment: enhanced.marketSentiment,
        recommendations: enhanced.recommendations,
        riskAlerts: enhanced.riskAlerts,
        correlationInsight: enhanced.correlationInsight,
        predictionSignals: enhanced.predictionSignals,
        urgency: enhanced.urgency,
      };

      logger.info('[SUI Cron] Enhanced AI allocation (prediction markets + intelligence)', {
        allocations: aiResult.allocations,
        confidence: aiResult.confidence,
        sentiment: enhanced.marketSentiment,
        urgency: enhanced.urgency,
        predictionSignals: enhanced.predictionSignals?.length || 0,
        riskAlerts: enhanced.riskAlerts?.length || 0,
        recommendations: enhanced.recommendations?.length || 0,
      });
    } catch (enhancedErr) {
      logger.warn('[SUI Cron] Enhanced allocation failed, falling back to basic', {
        error: enhancedErr instanceof Error ? enhancedErr.message : String(enhancedErr),
      });
      const indicators = await suiAgent.analyzeMarket();
      aiResult = suiAgent.generateAllocation(indicators, currentAllocations);
    }

    logger.info('[SUI Cron] AI Agent decision', {
      allocations: aiResult.allocations,
      confidence: aiResult.confidence,
      shouldRebalance: aiResult.shouldRebalance,
      swappableAssets: aiResult.swappableAssets,
      hedgedAssets: aiResult.hedgedAssets,
      riskScore: aiResult.riskScore,
      enhanced: Object.keys(enhancedContext).length > 0,
    });

    // Step 4: NAV snapshot + v0.3.0 defense stack
    // ═══════════════════════════════════════════════════════════════
    // Extracted to lib/services/sui/cron/step-4-nav-defense.ts —
    // scale ceiling + hedgeability clamp + profit-lock guard +
    // alert-response override + PortfolioDriver corrective unwind +
    // external NAV attest + NAV snapshot persist. aiResult.allocations
    // is mutated in-place, matching the inline block's behavior.
    const { navUsd, sharePriceUsd, aboveSafetyCeiling } = await runStep4NavDefense({
      poolStats, pricesUSD, aiResult,
      navSafetyCeilingUsdc: NAV_SAFETY_CEILING_USDC,
      network,
    });


    // Step 5: Sync members to DB from on-chain
    await syncMembersToDb({ suiService, suiPriceUsd: pricesUSD['SUI'] || 0 });

    // Step 6: Save pool state to DB
    await savePoolState({
      navUsd,
      sharePriceUsd,
      poolStats,
      allocations: aiResult.allocations,
      reasoning: aiResult.reasoning,
      pricesUSD,
    });

    // Step 6.5: Settle PREVIOUS cycle's hedges — return USDC from admin back to pool
    // This runs BEFORE new swaps so the pool gets its money back first.
    // Flow: reverse-swap ALL admin-held assets → USDC, then close_hedge for each.
    // Profits/losses from asset price changes are captured proportionally.
    let hedgeSettlement: { settled: number; failed: number; details: any[]; replenishment?: any; debug?: any } | undefined;
    if (aboveSafetyCeiling) {
      logger.warn('[SUI Cron] Step 6.5 skipped — NAV above safety ceiling', { navUsd: navUsd.toFixed(2) });
      hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { skippedReason: 'safety-ceiling' } };
    } else if (process.env.SUI_POOL_ADMIN_KEY && process.env.SUI_AGENT_CAP_ID) {
      try {
        const activeHedges = await getActiveHedges(network);
        logger.info('[SUI Cron] Step 6.5 getActiveHedges result', { count: activeHedges.length, hedges: activeHedges });
        if (activeHedges.length > 0) {
          const totalCollateralNeeded = activeHedges.reduce((sum, h) => sum + h.collateralUsdc, 0);

          logger.info('[SUI Cron] Settling previous hedges before new allocation', {
            activeHedges: activeHedges.length,
            totalCollateral: totalCollateralNeeded.toFixed(6),
          });

          // Replenish only the actual shortfall, not blanket-convert everything.
          // The old design (replenish target = $1M) churned the wallet on every
          // tick: wBTC/wETH/SUI got swapped to USDC, then Step 7 tried to buy
          // them back, but small-notional buys often failed on slippage/route,
          // so wETH/SUI never re-accumulated even though the AI kept allocating
          // 25-40% to them. Net effect: every $1 of wETH was lost to round-trip
          // friction (~1-2% slippage each direction, plus DEX fees).
          //
          // New behaviour:
          //  - Compute the USDC shortfall = collateral_needed − admin_usdc_now.
          //  - If shortfall ≤ 0, admin already has enough USDC for settlement
          //    → skip replenish entirely. Step 7 will buy any allocation drift
          //    from the spare USDC.
          //  - Else replenish exactly shortfall × 1.2 (20% buffer for slippage),
          //    which only converts the minimum non-USDC needed.
          const adminUsdcPreReplenish = await getAdminUsdcBalance(network);
          const usdcShortfall = Math.max(0, totalCollateralNeeded - adminUsdcPreReplenish);
          let replenishment: Awaited<ReturnType<typeof replenishAdminUsdc>> = { swapped: 0, details: [] };
          if (usdcShortfall > 0) {
            const replenishTarget = usdcShortfall * 1.2; // 20% buffer for slippage
            logger.info('[SUI Cron] Step 6.5 replenish needed', {
              adminUsdc: adminUsdcPreReplenish.toFixed(6),
              collateralNeeded: totalCollateralNeeded.toFixed(6),
              shortfall: usdcShortfall.toFixed(6),
              replenishTarget: replenishTarget.toFixed(6),
            });
            replenishment = await replenishAdminUsdc(network, replenishTarget, pricesUSD);
            logger.info('[SUI Cron] Step 6.5 replenishment result', { swapped: replenishment.swapped, details: replenishment.details });
            if (replenishment.swapped > 0) {
              await new Promise(r => setTimeout(r, 2000));
            }
          } else {
            logger.info('[SUI Cron] Step 6.5 replenish skipped — admin has enough USDC', {
              adminUsdc: adminUsdcPreReplenish.toFixed(6),
              collateralNeeded: totalCollateralNeeded.toFixed(6),
              excess: (adminUsdcPreReplenish - totalCollateralNeeded).toFixed(6),
            });
          }

          // Check total admin USDC after replenishment (or after skipping)
          const adminUsdcForSettlement = await getAdminUsdcBalance(network);
          logger.info('[SUI Cron] Admin USDC for settlement', {
            adminUsdc: adminUsdcForSettlement.toFixed(6),
            totalCollateral: totalCollateralNeeded.toFixed(6),
            pnl: (adminUsdcForSettlement - totalCollateralNeeded).toFixed(6),
          });

          // Audit-15 guard: if the replenish step failed to fully convert
          // non-USDC holdings (aggregator route missing, slippage tripped,
          // RPC hiccup) and we settle anyway, the proportional-distribution
          // loop calls close_hedge with the deficit framed as `is_profit=false,
          // pnl_usdc=collateral_minus_returned`. The Move funds-verify guard
          // accepts that (the math is internally consistent), so the row is
          // closed at a fake realized loss while the real value sits in
          // unsold wBTC/wETH/SUI in the admin wallet. Skip the settle when
          // residual non-USDC value > $1 — let the next tick try replenish
          // again. Real losses (asset depreciation) still settle correctly
          // because in that case the admin wallet IS empty of non-USDC after
          // a clean swap.
          const residualUsd = await getAdminNonUsdcUsdValue(network, pricesUSD);
          const REPLENISH_RESIDUAL_GUARD_USD = Number(process.env.HEDGE_SETTLE_RESIDUAL_GUARD_USD) || 1;
          if (residualUsd > REPLENISH_RESIDUAL_GUARD_USD && adminUsdcForSettlement < totalCollateralNeeded * 0.95) {
            logger.warn('[SUI Cron] Skipping hedge settlement — replenish incomplete; would write fake losses', {
              residualUsd: residualUsd.toFixed(2),
              adminUsdc: adminUsdcForSettlement.toFixed(2),
              totalCollateralNeeded: totalCollateralNeeded.toFixed(2),
              guard: REPLENISH_RESIDUAL_GUARD_USD,
            });
            await notifyDiscord(
              `Hedge settlement SKIPPED: admin still holds $${residualUsd.toFixed(2)} of non-USDC after replenish (USDC $${adminUsdcForSettlement.toFixed(2)} vs needed $${totalCollateralNeeded.toFixed(2)}). Likely aggregator route failure — would write fake losses if settled. Retry next tick.`,
              'WARN',
              { residualUsd: residualUsd.toFixed(2), adminUsdcForSettlement: adminUsdcForSettlement.toFixed(2), totalCollateralNeeded: totalCollateralNeeded.toFixed(2) },
            );
            hedgeSettlement = {
              settled: 0, failed: 0, details: [],
              replenishment,
              debug: { skippedReason: 'replenish-incomplete', residualUsd, adminUsdcForSettlement, totalCollateralNeeded },
            };
          } else if (adminUsdcForSettlement > 0.001) {
            const settlement = await settleActiveHedges(network);
            hedgeSettlement = {
              settled: settlement.settled,
              failed: settlement.failed,
              details: settlement.details,
              replenishment,
            };
            logger.info('[SUI Cron] Previous hedges settled — USDC returned to pool', {
              settled: settlement.settled,
              failed: settlement.failed,
              adminUsdcReturned: adminUsdcForSettlement.toFixed(6),
              pnl: (adminUsdcForSettlement - totalCollateralNeeded).toFixed(6),
            });
            // Wait for on-chain state to propagate before opening new hedges
            if (settlement.settled > 0) {
              await new Promise(r => setTimeout(r, 2000));
            }
          } else {
            logger.warn('[SUI Cron] No USDC available to settle hedges', {
              adminUsdc: adminUsdcForSettlement.toFixed(6),
            });
            hedgeSettlement = {
              settled: 0, failed: 0, details: [],
              replenishment,
              debug: { adminUsdcForSettlement, totalCollateralNeeded, activeHedgesCount: activeHedges.length },
            };
          }
        } else {
          logger.info('[SUI Cron] No previous hedges to settle');
          hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { activeHedgesFound: 0 } };
        }
      } catch (settleErr) {
        const errMsg = settleErr instanceof Error ? settleErr.message : String(settleErr);
        logger.warn('[SUI Cron] Pre-swap hedge settlement failed (non-critical)', { error: settleErr });
        hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { error: errMsg } };
      }
    } else {
      hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { envMissing: { adminKey: !process.env.SUI_POOL_ADMIN_KEY, agentCap: !process.env.SUI_AGENT_CAP_ID } } };
    }

    // Step 6.6: Drift-based pre-rebalance — sell overweight asset(s) to USDC
    // so Step 7 has actual budget to buy underweight assets.
    //
    // Why this step exists: after the Step 6.5 shortfall-only fix (commit
    // 598484a7), admin USDC sat near zero because nothing was sold. Step 7's
    // planRebalanceSwaps then had no budget and the wallet got stuck at
    // whatever composition existed — e.g. all wBTC, no wETH, no SUI — even
    // though the AI kept targeting BTC=45/ETH=37/SUI=18.
    //
    // The fix: explicitly identify overweight assets (drift > threshold) and
    // sell exactly the excess. Step 7 then uses the recovered USDC to buy
    // underweight assets per the AI target. Pure addition — does NOT
    // change the original aiResult.allocations (which still drives the
    // hedge step and DB snapshots).
    let driftRebalance: SuiCronResult['driftRebalance'];
    let executionAllocations: Record<string, number> | undefined;
    if (process.env.SUI_POOL_ADMIN_KEY && !aboveSafetyCeiling && navUsd >= 15) {
      try {
        const preHoldings = await getAdminAssetValuesUsd(network, pricesUSD);
        const targets: Record<string, number> = {};
        const deltas: Record<string, number> = {};
        for (const a of POOL_ASSETS) {
          const targetPct = Number(aiResult.allocations[a as PoolAsset] || 0);
          targets[a] = (navUsd * targetPct) / 100;
          deltas[a] = targets[a] - (preHoldings[a as PoolAsset] || 0);
        }
        logger.info('[SUI Cron] Step 6.6 drift analysis', {
          navUsd: navUsd.toFixed(2),
          preHoldings: Object.entries(preHoldings).map(([k, v]) => `${k}=$${(v as number).toFixed(2)}`).join(' '),
          targets: Object.entries(targets).map(([k, v]) => `${k}=$${v.toFixed(2)}`).join(' '),
          deltas: Object.entries(deltas).map(([k, v]) => `${k}=${v > 0 ? '+' : ''}$${v.toFixed(2)}`).join(' '),
          driftThreshold: REBALANCE_DRIFT_THRESHOLD_PCT,
          maxSellPerTick: MAX_REBALANCE_SELL_USD,
        });

        const sold: NonNullable<SuiCronResult['driftRebalance']>['sold'] = [];
        let totalSoldUsdc = 0;

        // Sell overweight assets, smallest excess first to spread DEX impact
        const overweightAssets = POOL_ASSETS
          .map(a => ({ asset: a as string, excess: -(deltas[a] || 0), driftPct: targets[a] > 0 ? (-(deltas[a] || 0) / targets[a]) * 100 : 0 }))
          .filter(x => x.excess > 0 && x.driftPct >= REBALANCE_DRIFT_THRESHOLD_PCT)
          .sort((a, b) => a.excess - b.excess);

        for (const { asset, excess, driftPct } of overweightAssets) {
          const sellUsd = Math.min(excess, MAX_REBALANCE_SELL_USD);
          logger.info(`[SUI Cron] Step 6.6 SELL ${asset}`, {
            currentUsd: (preHoldings[asset as PoolAsset] || 0).toFixed(2),
            targetUsd: targets[asset].toFixed(2),
            excessUsd: excess.toFixed(2),
            driftPct: driftPct.toFixed(1),
            sellUsd: sellUsd.toFixed(2),
          });
          const result = await sellAssetForUsdc(network, asset as BluefinPoolAsset, sellUsd, pricesUSD);
          sold.push({
            asset,
            usdcReceived: result.swapped,
            driftPct,
            txDigest: result.txDigest,
            error: result.error,
          });
          if (result.swapped > 0) {
            totalSoldUsdc += result.swapped;
            // Wait for on-chain state propagation before next swap
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        // Build buy-only execution allocations from positive deltas. Step 7
        // uses this instead of the raw aiResult.allocations so it doesn't
        // accidentally buy MORE of an overweight asset we just sold from.
        const positiveDeltas: Record<string, number> = {};
        let totalPositive = 0;
        for (const a of POOL_ASSETS) {
          const d = deltas[a] || 0;
          if (d > 0) {
            positiveDeltas[a] = d;
            totalPositive += d;
          }
        }
        if (totalPositive > 0) {
          executionAllocations = {};
          let allocated = 0;
          const positiveAssets = Object.keys(positiveDeltas);
          for (let i = 0; i < positiveAssets.length; i++) {
            const a = positiveAssets[i];
            const isLast = i === positiveAssets.length - 1;
            const pct = isLast
              ? Math.max(0, 100 - allocated)
              : Math.round((positiveDeltas[a] / totalPositive) * 100);
            executionAllocations[a] = pct;
            allocated += pct;
          }
          // Ensure overweight assets are 0% in the buy plan (Step 7 won't buy them)
          for (const a of POOL_ASSETS) {
            if (!(a in executionAllocations)) executionAllocations[a] = 0;
          }
        }

        driftRebalance = { preHoldings, targets, deltas, sold, totalSoldUsdc, executionAllocations };

        if (totalSoldUsdc > 0 || sold.length > 0) {
          const okSold = sold.filter(s => s.usdcReceived > 0);
          await notifyDiscord(
            `Drift rebalance: sold $${totalSoldUsdc.toFixed(2)} of overweight asset(s) → USDC for Step 7 buys. ${okSold.map(s => `${s.asset} $${s.usdcReceived.toFixed(2)} (drift ${s.driftPct.toFixed(0)}%)`).join(', ') || '(no swap succeeded)'}.`,
            okSold.length > 0 ? 'INFO' : 'WARN',
            { sold, deltas, targets, navUsd: navUsd.toFixed(2), executionAllocations },
          );
        }
      } catch (driftErr) {
        const msg = driftErr instanceof Error ? driftErr.message : String(driftErr);
        logger.warn('[SUI Cron] Step 6.6 drift rebalance failed (non-critical)', { error: msg });
        driftRebalance = {
          preHoldings: { BTC: 0, ETH: 0, SUI: 0 },
          targets: { BTC: 0, ETH: 0, SUI: 0 },
          deltas: { BTC: 0, ETH: 0, SUI: 0 },
          sold: [], totalSoldUsdc: 0,
          skippedReason: `error: ${msg}`,
        };
      }
    } else {
      driftRebalance = {
        preHoldings: { BTC: 0, ETH: 0, SUI: 0 },
        targets: { BTC: 0, ETH: 0, SUI: 0 },
        deltas: { BTC: 0, ETH: 0, SUI: 0 },
        sold: [], totalSoldUsdc: 0,
        skippedReason: !process.env.SUI_POOL_ADMIN_KEY
          ? 'no admin key'
          : aboveSafetyCeiling
            ? 'above NAV safety ceiling'
            : `NAV $${navUsd.toFixed(2)} < $15 minimum`,
      };
    }

    // Step 7: Plan + Execute rebalance via SuiPoolAgent
    // ═══════════════════════════════════════════════════════════════
    // Extracted to lib/services/sui/cron/step-7-rebalance.ts —
    // rebalance planning + 7b (pool→admin USDC transfer with hedge-cap
    // ratio + reserve + daily-cap enforcement and AI-driven daily reset)
    // + 7c (re-plan against actual budget) + 7d (log hedged positions).
    const { rebalanceSwaps } = await runStep7Rebalance({
      navUsd, aboveSafetyCeiling,
      currentAllocations, executionAllocations,
      aiResult, enhancedContext, network,
    });


    // Step 7.9: Position-Drift Auto-Close (AG10) — self-correct misalignment
    // ═══════════════════════════════════════════════════════════════
    // For each active real hedge (collateral ≥ $1), ask AgentTradeGuard
    // whether re-opening the SAME side would now be approved. If not
    // (agent-directive stage: agent recommends opposite side or HOLD, or
    // risk-gate stage: systemic risk-ceiling breach), close the position.
    // Runs BEFORE Step 8 so freed capital can immediately re-hedge on the
    // correct side in the same tick — pool self-corrects in one cycle.
    // Kill switch: HEDGE_DRIFT_AUTO_CLOSE_DISABLE=1
    // ═══════════════════════════════════════════════════════════════
    let driftResult: { checked: number; drifted: number; closed: number; skipped: number; errors: number; actions: unknown[] } | null = null;
    try {
      const bluefinService = BluefinService.getInstance();
      driftResult = await checkAndCloseDrifts('sui', bluefinService);
      if (driftResult.drifted > 0) {
        logger.info('[SUI Cron] Drift monitor summary', driftResult);
      }
    } catch (driftErr) {
      logger.warn('[SUI Cron] Drift monitor threw (non-critical — Step 8 continues)', {
        error: driftErr instanceof Error ? driftErr.message : String(driftErr),
      });
    }

    // Step 8: Auto-Hedge via BlueFin perpetuals — BTC, ETH, SUI
    // ═══════════════════════════════════════════════════════════════
    // Extracted to lib/services/sui/cron/step-8-auto-hedge.ts —
    // signal-driven hedging with drawdown auto-halt, dedup gate,
    // self-healing reconciler, dust prevention, agent gate, per-fill
    // verification, ZK commitment emission. Behavior verbatim.
    const autoHedgeResult = await runStep8AutoHedge({
      navUsd, pricesUSD, aiResult, enhancedContext,
      aboveSafetyCeiling, navSafetyCeilingUsdc: NAV_SAFETY_CEILING_USDC, network,
    });


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
          enhanced: Object.keys(enhancedContext).length > 0,
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
          ...(enhancedContext.marketSentiment && { marketSentiment: enhancedContext.marketSentiment }),
          ...(enhancedContext.urgency && { urgency: enhancedContext.urgency }),
          ...(enhancedContext.predictionSignals && { predictionSignals: enhancedContext.predictionSignals }),
          ...(enhancedContext.riskAlerts?.length && { riskAlerts: enhancedContext.riskAlerts }),
          ...(enhancedContext.correlationInsight && { correlationInsight: enhancedContext.correlationInsight }),
          // Persist the recommendations list so /api/debug/sui-pool-status
          // can surface tilt explanations like "Synthetic STRONG UP on BTC"
          // and "Drift-fusion alignment UP 100% across 4 assets" — without
          // this, the audit trail loses the *why* behind each allocation.
          ...(enhancedContext.recommendations?.length && { recommendations: enhancedContext.recommendations }),
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
        ...(enhancedContext.marketSentiment && { marketSentiment: enhancedContext.marketSentiment }),
        ...(enhancedContext.urgency && { urgency: enhancedContext.urgency }),
        ...(enhancedContext.predictionSignals && { predictionSignals: enhancedContext.predictionSignals }),
        ...(enhancedContext.riskAlerts?.length && { riskAlerts: enhancedContext.riskAlerts }),
        ...(enhancedContext.correlationInsight && { correlationInsight: enhancedContext.correlationInsight }),
        ...(enhancedContext.recommendations?.length && { recommendations: enhancedContext.recommendations }),
      },
      pricesUSD,
      autoHedge: autoHedgeResult.triggered ? autoHedgeResult : undefined,
      rebalanceSwaps,
      ...(driftRebalance && { driftRebalance }),
      ...(hedgeSettlement && { hedgeSettlement }),
      duration: Date.now() - startTime,
    };

    logger.info('[SUI Cron] Completed successfully', {
      duration: result.duration,
      action: result.aiDecision?.action,
      autoHedgeTriggered: autoHedgeResult.triggered,
    });

    // Update rate limit timestamp on success
    lastSuccessfulRunTimestamp = Date.now();

    // Piggy-back poly-discover at the tail. QStash free-tier is at its
    // 10-schedule cap so we run discovery + momentum + relevance + theme
    // analysis here instead of a standalone cron — same 30-min cadence
    // either way, plus we always run after the AI allocation tick that
    // would actually use the data. Wrapped in try/catch so a Polymarket
    // outage can never fail the SUI cron.
    try {
      const polyResult = await runPolyDiscoverTick();
      // Heartbeat for /api/health/production cron-freshness check on the
      // poly-discover key, so ops can still tell discovery is running.
      void setCronState('cron:lastRun:poly-discover', Date.now()).catch(() => {});
      logger.info('[SUI Cron] poly-discover (inlined) complete', {
        discovered: polyResult.discoveredCount,
        newAssets: polyResult.newSinceLastTick.length,
        newHighImpact: polyResult.broad.newHighImpactCount,
        hotMovers: polyResult.broad.hotMoversCount,
        themesAlerted: polyResult.broad.themesAlerted,
      });
    } catch (polyErr) {
      logger.warn('[SUI Cron] inlined poly-discover failed (non-fatal)', {
        error: polyErr instanceof Error ? polyErr.message : String(polyErr),
      });
    }

    // LeadAgent autonomous cycle — invokes Risk → Hedging consensus →
    // Hedging → Settlement → Reporting in sequence so the 7-agent
    // architecture actually fires every 30min instead of being dormant
    // until someone hits an API endpoint. Result persisted to
    // `lead-cycle:last-decision` for surfacing via the latest endpoint
    // + UI. Try/catch'd so a specialist failure can never break the
    // SUI cron.
    try {
      const orchestrator = getAgentOrchestrator();
      const cycle = await orchestrator.runAutonomousCycle({
        chain: 'sui',
        portfolioId: -2,
      });
      await Promise.all([
        setCronState('cron:lastRun:lead-cycle', Date.now()).catch(() => {}),
        setCronState('lead-cycle:last-decision', { ts: Date.now(), ...cycle }).catch(() => {}),
      ]);
      logger.info('[SUI Cron] LeadAgent autonomous cycle complete', {
        success: cycle.success,
        riskScore: cycle.riskScore,
        hedgeRecs: cycle.hedgeRecommendations,
        durationMs: cycle.durationMs,
      });
      // Discord ping on actionable findings: high risk OR rebalance needed.
      if (cycle.success && (cycle.needsRebalance || (cycle.riskScore ?? 0) > 70)) {
        try {
          await notifyDiscord(
            `🤖 LeadAgent cycle: risk=${cycle.riskScore ?? '?'}/${cycle.riskLevel ?? '?'}, ` +
            `hedge-recs=${cycle.hedgeRecommendations ?? 0}, ` +
            `rebalance=${cycle.needsRebalance ? 'YES' : 'no'}. ` +
            (cycle.leadSummary ?? '').slice(0, 200),
            cycle.needsRebalance ? 'WARN' : 'INFO',
            { cycle },
          ).catch(() => {});
        } catch { /* best-effort */ }
      }
    } catch (cycleErr) {
      logger.warn('[SUI Cron] LeadAgent cycle failed (non-fatal)', {
        error: cycleErr instanceof Error ? cycleErr.message : String(cycleErr),
      });
    }

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
