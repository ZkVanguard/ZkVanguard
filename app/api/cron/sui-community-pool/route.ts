/**
 * Cron Job: SUI Community Pool AI Management (USDC)
 * 
 * Invoked by Upstash QStash every 30 minutes to:
 * 1. Fetch SUI pool on-chain stats (USDC balance, shares, members)
 * 2. Record NAV snapshot with 4-asset allocation tracking
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
import { getAutoHedgeConfigs } from '@/lib/storage/auto-hedge-storage';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { bluefinTreasury } from '@/lib/services/sui/BluefinTreasuryService';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID, isSuiCommunityPool } from '@/lib/constants';
import { createHedge, updateHedgeStatus } from '@/lib/db/hedges';
import { recordPoolNavSnapshot, syncMembersToDb, savePoolState } from '@/lib/services/sui/cron/persistence';
import { resolveLeverage, hedgeRatioForNav, computeTargetMargin, hedgeValueUsd, scaledReserves } from '@/lib/services/sui/cron/hedge-sizing';
import { isStrongHedgeSignal } from '@/lib/services/sui/cron/signal-gating';
import { clampAllocationsToHedgeable } from '@/lib/services/sui/cron/hedgeable-allocation';
import { notifyDiscord } from '@/lib/utils/discord-notify';

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
 * Replenish admin USDC by reverse-swapping non-USDC assets via Bluefin.
 * 
 * When the cron needs USDC (e.g., to settle hedges or refund depositors) but
 * admin wallet is short, this swaps wBTC/ETH/SUI back to USDC automatically
 * using the Bluefin 7k aggregator.
 * 
 * Strategy: swap from the largest-value non-USDC asset first to minimize fees.
 */
async function replenishAdminUsdc(
  network: 'mainnet' | 'testnet',
  usdcShortfall: number,
  pricesUSD: Record<string, number>,
): Promise<{ swapped: number; details: Array<{ asset: string; amountSwapped: number; txDigest?: string; error?: string }> }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey || usdcShortfall <= 0) {
    return { swapped: 0, details: [] };
  }

  const details: Array<{ asset: string; amountSwapped: number; txDigest?: string; error?: string }> = [];
  let totalSwapped = 0;
  let remainingShortfall = usdcShortfall;

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

    // Get admin's non-USDC balances, ranked by USD value (largest first)
    const allBalances = await suiClient.getAllBalances({ owner: address });
    const candidates: Array<{ asset: BluefinPoolAsset; amount: number; valueUsd: number }> = [];

    // Build canonical lookup so `0x27792d9…` from getAllBalances matches
    // `0x027792d9…` from MAINNET_COIN_TYPES. See canonicalizeCoinType()
    // for the root cause — same bug that was breaking getAdminAssetValuesUsd
    // (this function had it from before; finally fixing both at once).
    const canonMap = new Map<string, BluefinPoolAsset>();
    for (const a of POOL_ASSETS) {
      const t = aggregator.getAssetCoinType(a as BluefinPoolAsset);
      if (t) canonMap.set(canonicalizeCoinType(t), a as BluefinPoolAsset);
    }

    for (const bal of allBalances) {
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;

      // Match coin type to known assets (skip USDC and SUI gas reserve)
      const asset: BluefinPoolAsset | undefined = canonMap.get(canonicalizeCoinType(bal.coinType));
      if (!asset) continue;
      const decimals = asset === 'SUI' ? 9 : 8;

      const amount = raw / Math.pow(10, decimals);
      const price = pricesUSD[asset] || 0;
      const valueUsd = amount * price;

      // Reserve a minimum SUI balance for gas (keep 1 SUI untouchable)
      if (asset === 'SUI') {
        const reserveSui = 1.0;
        const swappable = Math.max(0, amount - reserveSui);
        if (swappable <= 0) continue;
        candidates.push({ asset, amount: swappable, valueUsd: swappable * price });
      } else {
        candidates.push({ asset, amount, valueUsd });
      }
    }

    // Sort by USD value descending — swap largest holdings first
    candidates.sort((a, b) => b.valueUsd - a.valueUsd);

    logger.info('[SUI Cron] Replenish candidates', {
      shortfall: usdcShortfall.toFixed(6),
      candidates: candidates.map(c => `${c.asset}: ${c.amount.toFixed(6)} (~$${c.valueUsd.toFixed(2)})`),
    });

    // Swap from each asset until shortfall is covered
    for (const c of candidates) {
      if (remainingShortfall <= 0.01) break; // Done

      // Calculate how much of this asset to swap (with 5% buffer for slippage)
      const usdcTarget = Math.min(remainingShortfall * 1.05, c.valueUsd);
      if (usdcTarget < 0.10) continue; // Skip tiny swaps

      const price = pricesUSD[c.asset] || 0;
      if (price <= 0) continue;

      const assetAmountToSwap = Math.min(c.amount, usdcTarget / price);
      if (assetAmountToSwap <= 0) continue;

      logger.info(`[SUI Cron] Reverse swap ${c.asset} → USDC`, {
        assetAmount: assetAmountToSwap.toFixed(8),
        targetUsdc: usdcTarget.toFixed(4),
        remainingShortfall: remainingShortfall.toFixed(4),
      });

      try {
        const reverseQuote = await aggregator.getReverseSwapQuote(c.asset, assetAmountToSwap);

        if (!reverseQuote.canSwapOnChain || !reverseQuote.routerData) {
          logger.warn(`[SUI Cron] ${c.asset} → USDC not swappable on-chain, skipping`);
          details.push({ asset: c.asset, amountSwapped: 0, error: 'No on-chain route' });
          continue;
        }

        const swapResult = await aggregator.executeSwap(reverseQuote, 0.02); // 2% slippage for reverse
        const usdcReceived = Number(swapResult.amountOut || '0') / 1e6;

        if (swapResult.success) {
          totalSwapped += usdcReceived;
          remainingShortfall -= usdcReceived;
          details.push({
            asset: c.asset,
            amountSwapped: usdcReceived,
            txDigest: swapResult.txDigest,
          });
          logger.info(`[SUI Cron] ${c.asset} → USDC swap success`, {
            txDigest: swapResult.txDigest,
            usdcReceived: usdcReceived.toFixed(6),
          });
          // Wait for state propagation
          await new Promise(r => setTimeout(r, 2500));
        } else {
          details.push({
            asset: c.asset,
            amountSwapped: 0,
            error: swapResult.error,
          });
          logger.warn(`[SUI Cron] ${c.asset} → USDC swap failed`, { error: swapResult.error });
        }
      } catch (swapErr) {
        const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
        details.push({ asset: c.asset, amountSwapped: 0, error: msg });
        logger.warn(`[SUI Cron] Reverse swap ${c.asset} threw error`, { error: msg });
      }
    }
  } catch (err) {
    logger.error('[SUI Cron] replenishAdminUsdc failed', { error: err });
  }

  return { swapped: totalSwapped, details };
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
 * AI-driven on-chain daily-cap reset.
 *
 * The Move contract caps `daily_hedge_total` at 50% of NAV per UTC day to
 * prevent runaway hedge spend. That cap is too restrictive when the AI +
 * prediction-market signal flips strongly mid-day: the pool sits idle until
 * midnight UTC instead of acting on a high-confidence directional move.
 *
 * `admin_reset_daily_hedge(AdminCap, &mut state, &Clock)` zeros the counter
 * without touching active positions. We invoke it sparingly — only when the
 * AI says it's worth the additional risk — and we cap usage to a small
 * number per UTC day so a buggy or compromised signal source can't drain
 * the pool.
 *
 * Reset is allowed when ALL hold:
 *   • on-chain dailyHedgedToday >= 50% of NAV (cap actually exhausted)
 *   • AI urgency in {HIGH, CRITICAL} OR confidence >= 75
 *   • resets-used-today < HEDGE_DAILY_MAX_RESETS (default 4)
 */
/**
 * Push the off-chain NAV portion to the Move contract's oracle field so
 * deposit/withdraw share math reflects true pool value.
 *
 * external_nav_usdc = navUsd_total - balance_onchain_usdc - hedge_state.total_hedged_value
 *
 * We subtract balance + hedge_state because the contract adds those on
 * the on-chain side already (see get_total_nav in the Move source).
 * Double-counting them in the oracle would over-pay withdrawers and
 * under-issue shares on deposit.
 *
 * Fails open on any error (logs warn, returns success:false). The
 * Move contract reverts on stale oracle when admin_set_external_nav_required(true)
 * has been called, so a missed attestation pauses withdrawals automatically.
 */
async function attestExternalNav(
  network: 'mainnet' | 'testnet',
  navUsdTotal: number,
): Promise<{ pushed: boolean; externalNavUsd?: number; txDigest?: string; error?: string }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];
  if (!adminKey || !adminCapId || !poolConfig.packageId || !poolConfig.poolStateId) {
    return { pushed: false, error: 'missing admin key, AdminCap, or pool config' };
  }

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const keypair = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim()
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim();
    const suiClient = new SuiClient({ url: rpcUrl });

    // Read on-chain balance + hedge_state from the pool object so we
    // compute the external portion correctly. Cron's navUsdTotal already
    // includes everything; subtracting these gives the bit that lives
    // off-chain.
    const obj = await suiClient.getObject({ id: poolConfig.poolStateId!, options: { showContent: true } });
    const fields = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    const balanceRaw = Number((fields as { balance?: string }).balance ?? 0);
    const hedgeStateFields = ((fields as { hedge_state?: { fields?: Record<string, unknown> } }).hedge_state?.fields) ?? {};
    const hedgedRaw = Number((hedgeStateFields as { total_hedged_value?: string }).total_hedged_value ?? 0);
    const balanceUsd = balanceRaw / 1e6;
    const hedgedUsd = hedgedRaw / 1e6;

    const externalNavUsd = Math.max(0, navUsdTotal - balanceUsd - hedgedUsd);
    const externalNavRaw = Math.floor(externalNavUsd * 1e6); // USDC has 6 decimals

    // AdminCap ownership check — like aiDrivenResetDailyHedge, the cron
    // gracefully no-ops when the cap has been transferred to MSafe.
    const capObj = await suiClient.getObject({ id: adminCapId, options: { showOwner: true } });
    const capOwner = capObj.data?.owner;
    const cronSigner = keypair.toSuiAddress();
    if (!capOwner || typeof capOwner !== 'object' || !('AddressOwner' in capOwner)) {
      return { pushed: false, error: 'AdminCap owner unreadable — skipping attestation' };
    }
    if (capOwner.AddressOwner.toLowerCase() !== cronSigner.toLowerCase()) {
      return { pushed: false, error: `AdminCap is on MSafe (${capOwner.AddressOwner.slice(0, 12)}…) — cron cannot attest. Multi-sig must push.` };
    }

    const tx = new Transaction();
    const usdcType = SUI_USDC_COIN_TYPE[network];
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::admin_attest_external_nav`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(adminCapId),
        tx.object(poolConfig.poolStateId!),
        tx.pure.u64(externalNavRaw),
        tx.object('0x6'),
      ],
    });
    tx.setGasBudget(20_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair, transaction: tx, options: { showEffects: true },
    });
    const ok = result.effects?.status?.status === 'success';
    if (ok) {
      logger.info('[SUI Cron] External NAV attested', {
        externalNavUsd: externalNavUsd.toFixed(2),
        balanceUsd: balanceUsd.toFixed(2),
        hedgedUsd: hedgedUsd.toFixed(2),
        navUsdTotal: navUsdTotal.toFixed(2),
        txDigest: result.digest,
      });
      return { pushed: true, externalNavUsd, txDigest: result.digest };
    }
    const errStr = result.effects?.status?.error || 'unknown';
    // E_EXTERNAL_NAV_CHANGE_TOO_LARGE is an expected reversion (anti-
    // manipulation guard); just warn and let the next tick try again.
    if (errStr.includes('30,') || errStr.includes('E_EXTERNAL_NAV_CHANGE_TOO_LARGE')) {
      logger.warn('[SUI Cron] External NAV attestation rejected — change > 30%', {
        externalNavUsd: externalNavUsd.toFixed(2), error: errStr,
      });
      return { pushed: false, error: 'change > 30% guard' };
    }
    logger.warn('[SUI Cron] External NAV attestation tx failed', { error: errStr, txDigest: result.digest });
    return { pushed: false, error: errStr, txDigest: result.digest };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('[SUI Cron] External NAV attestation threw', { error: msg });
    return { pushed: false, error: msg };
  }
}

async function aiDrivenResetDailyHedge(
  network: 'mainnet' | 'testnet',
  signal: { urgency?: string; confidence?: number },
): Promise<{ reset: boolean; reason?: string; txDigest?: string; error?: string; resetsUsed?: number }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const adminCapId = (process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey) return { reset: false, reason: 'no admin key' };
  if (!adminCapId) return { reset: false, reason: 'SUI_ADMIN_CAP_ID not configured' };
  if (!poolConfig.packageId || !poolConfig.poolStateId) {
    return { reset: false, reason: 'pool not configured' };
  }

  const urgency = (signal.urgency || '').toUpperCase();
  const confidence = Number(signal.confidence || 0);
  const minConfidence = Number(process.env.HEDGE_RESET_MIN_CONFIDENCE || 75);
  if (!isStrongHedgeSignal(urgency, confidence, minConfidence)) {
    return { reset: false, reason: `weak signal (urgency=${urgency || 'NONE'} conf=${confidence})` };
  }

  // Bound resets per UTC day so the cap still has teeth.
  const dayKey = `hedgeDailyReset:${Math.floor(Date.now() / 86_400_000)}`;
  const maxResets = Number(process.env.HEDGE_DAILY_MAX_RESETS || 4);
  const usedSoFar = await getCronStateOr<number>(dayKey, 0);
  if (usedSoFar >= maxResets) {
    return { reset: false, reason: `reset budget exhausted (${usedSoFar}/${maxResets})`, resetsUsed: usedSoFar };
  }

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const keypair = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    // Pre-flight: confirm the cron's hot key still owns the AdminCap.
    // Once the cap is transferred to the MSafe multisig, the cron MUST stop
    // attempting auto-resets (each tx would fail noisily and burn gas budget).
    // We treat "not owned" as a clean no-op: daily cap acts as hard-stop until
    // a human runs collect-fees / reset via the multisig.
    const capObj = await suiClient.getObject({ id: adminCapId, options: { showOwner: true } });
    const capOwner = capObj.data?.owner;
    const cronSigner = keypair.toSuiAddress();
    if (!capOwner || typeof capOwner !== 'object' || !('AddressOwner' in capOwner)) {
      return { reset: false, reason: 'AdminCap owner unreadable — skipping auto-reset' };
    }
    if (capOwner.AddressOwner.toLowerCase() !== cronSigner.toLowerCase()) {
      return {
        reset: false,
        reason: `AdminCap owned by ${capOwner.AddressOwner} (not cron signer ${cronSigner}) — multisig-gated, daily cap is hard-stop`,
      };
    }

    const tx = new Transaction();
    const usdcType = SUI_USDC_COIN_TYPE[network];
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::admin_reset_daily_hedge`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(adminCapId),
        tx.object(poolConfig.poolStateId!),
        tx.object('0x6'),
      ],
    });
    tx.setGasBudget(20_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair, transaction: tx, options: { showEffects: true },
    });
    const ok = result.effects?.status?.status === 'success';
    if (ok) {
      await setCronState(dayKey, usedSoFar + 1);
      logger.info('[SUI Cron] AI-driven daily-cap reset SUCCESS', {
        urgency, confidence, resetsUsed: usedSoFar + 1, maxResets, txDigest: result.digest,
      });
      await notifyDiscord(
        `Daily hedge cap RESET (${usedSoFar + 1}/${maxResets} resets used today, urgency=${urgency}, conf=${confidence}). Pool can now hedge again before UTC midnight.`,
        'WARN',
        { network, urgency, confidence, resetsUsed: usedSoFar + 1, maxResets, txDigest: result.digest },
      );
      return { reset: true, txDigest: result.digest, resetsUsed: usedSoFar + 1 };
    }
    logger.warn('[SUI Cron] AI-driven daily-cap reset FAILED', {
      error: result.effects?.status?.error,
    });
    return { reset: false, reason: 'tx failed', error: result.effects?.status?.error };
  } catch (err) {
    return { reset: false, reason: 'exception', error: err instanceof Error ? err.message : String(err) };
  }
}

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
      ? ((process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim())
      : ((process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim());
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

    // Step 4: Record NAV snapshot
    // For SUI pool, totalNAV is in SUI. Convert to USD for consistent tracking.
    const navUsd = poolStats.totalNAVUsd || (poolStats.totalNAV * (pricesUSD['SUI'] || 0));
    const sharePriceUsd = poolStats.sharePriceUsd || (poolStats.sharePrice * (pricesUSD['SUI'] || 0));

    // ── Scale safety ceiling ─────────────────────────────────────
    // Above NAV_SAFETY_CEILING_USDC the on-chain Move contract's
    // `nav * bps * time_elapsed` math approaches u64.MAX and may wrap
    // silently, breaking fee accrual and the daily-withdrawal-cap
    // circuit breaker. Halt write-side actions (rebalance, hedge,
    // top-up) but still record snapshots so dashboards keep working.
    let aboveSafetyCeiling = false;
    // Pre-halt warning at 80% so the team gets weeks of lead time to plan
    // the u128 Move redeploy + audit rather than scrambling at the wall.
    const NAV_SAFETY_WARN_PCT = Number(process.env.NAV_SAFETY_WARN_PCT) || 80;
    const navPctOfCeiling = (navUsd / NAV_SAFETY_CEILING_USDC) * 100;
    if (navUsd > NAV_SAFETY_CEILING_USDC) {
      aboveSafetyCeiling = true;
      logger.error('[SUI Cron] NAV exceeds safety ceiling — write actions disabled', {
        navUsd: navUsd.toFixed(2),
        ceiling: NAV_SAFETY_CEILING_USDC,
        message: 'Redeploy Move contracts with u128 fee/cap math before continuing.',
      });
      await notifyDiscord(
        `NAV $${navUsd.toFixed(0)} exceeds safety ceiling $${NAV_SAFETY_CEILING_USDC.toLocaleString()} — write actions HALTED. Redeploy Move contracts with u128 math before resuming.`,
        'KILL',
        { navUsd: navUsd.toFixed(2), ceiling: NAV_SAFETY_CEILING_USDC },
      );
    } else if (navPctOfCeiling >= NAV_SAFETY_WARN_PCT) {
      // De-bounce: only re-alert if we haven't pinged about this in 6h.
      const lastWarnKey = 'sui-community-pool:nav-ceiling-warn-ms';
      const lastWarn = await getCronStateOr<number>(lastWarnKey, 0);
      if (Date.now() - lastWarn > 6 * 3600_000) {
        logger.warn('[SUI Cron] NAV approaching safety ceiling', {
          navUsd: navUsd.toFixed(2),
          ceiling: NAV_SAFETY_CEILING_USDC,
          pctOfCeiling: navPctOfCeiling.toFixed(1),
        });
        await notifyDiscord(
          `NAV $${navUsd.toFixed(0)} is ${navPctOfCeiling.toFixed(1)}% of safety ceiling $${NAV_SAFETY_CEILING_USDC.toLocaleString()} — plan the u128 Move contract redeploy + audit BEFORE the pool hits 100%. Halt is automatic at the ceiling and freezes all writes.`,
          'WARN',
          { navUsd: navUsd.toFixed(2), ceiling: NAV_SAFETY_CEILING_USDC, pctOfCeiling: navPctOfCeiling.toFixed(1) },
        );
        await setCronState(lastWarnKey, Date.now()).catch(() => {});
      }
    }

    // ── Hedgeability clamp (T1-A) ────────────────────────────────
    // BlueFin's per-symbol minQty creates a naked-long gap at small NAV:
    // if NAV × alloc% × leverage / price < minQty, the perp leg can't
    // open and the spot leg sits unhedged when AI signals BEARISH/NEUTRAL.
    // Concrete: at $50 NAV with 45% BTC alloc, BTC perp needs
    // ≥0.001 BTC = $73 notional but only sees $14 → silently skipped,
    // wBTC stays naked-long. Clamp drops unhedgeable assets and
    // redistributes their share to assets that CAN clear minQty.
    {
      const tierLev = resolveLeverage(navUsd, undefined);
      const ratio = hedgeRatioForNav(navUsd);
      const perpSpecs: Record<string, { minQuantity: number; stepSize: number }> = {
        BTC: { minQuantity: 0.001, stepSize: 0.001 },
        ETH: { minQuantity: 0.01,  stepSize: 0.01  },
        SUI: { minQuantity: 1,     stepSize: 1     },
      };
      // Fetch BlueFin OI for the 3 perps so the clamp also enforces the
      // T3-B OI cap (5% of venue OI by default). At BlueFin's real ETH OI
      // ~$40k, any hedge > ~$2k would be rejected by T3-B at open time;
      // without checking here, the cron would still swap USDC to wETH
      // and end up holding naked spot. Fetch is best-effort — if BlueFin
      // is unreachable we proceed with minQty-only check (acceptable
      // degradation; OI guard still gates the actual open).
      let openInterestUsd: Record<string, number> | undefined;
      try {
        const bfService = BluefinService.getInstance();
        const oiResults = await Promise.all([
          bfService.getMarketData('BTC-PERP').catch(() => null),
          bfService.getMarketData('ETH-PERP').catch(() => null),
          bfService.getMarketData('SUI-PERP').catch(() => null),
        ]);
        openInterestUsd = {};
        if (oiResults[0]?.openInterestUsd) openInterestUsd.BTC = oiResults[0].openInterestUsd;
        if (oiResults[1]?.openInterestUsd) openInterestUsd.ETH = oiResults[1].openInterestUsd;
        if (oiResults[2]?.openInterestUsd) openInterestUsd.SUI = oiResults[2].openInterestUsd;
      } catch {
        // best-effort — fall back to minQty-only clamp
      }
      // ── PROFIT-LOCK GUARD ─────────────────────────────────────────
      // Before hedgeability clamp, cap RISK allocation based on drawdown
      // from rolling peak NAV. Prevents the tiny-pool "slow bleed" where
      // spot LONG positions decay while hedges can't cover them at
      // sub-minQty scale. Env-tunable via PROFIT_LOCK_DRAWDOWN_START (5%)
      // and PROFIT_LOCK_ZERO_RISK_AT (20%). Disable with PROFIT_LOCK_DISABLE=1.
      try {
        const peakNavForLock = await getCronStateOr<number>(CronKeys.poolNavPeak('community-pool'), navUsd);
        const { applyProfitLock } = await import('@/lib/services/sui/cron/profit-lock-guard');
        const lockDecision = applyProfitLock(
          aiResult.allocations as Record<string, number>,
          navUsd,
          peakNavForLock,
        );
        if (lockDecision.active) {
          logger.warn('[SUI Cron] Profit-lock guard capped risk allocation', {
            drawdownPct: lockDecision.drawdownPct.toFixed(2),
            peakNav: peakNavForLock.toFixed(2),
            navUsd: navUsd.toFixed(2),
            riskCap: lockDecision.riskAllocationCap,
            before: lockDecision.originalAllocations,
            after: lockDecision.cappedAllocations,
          });
          await notifyDiscord(
            `🛡️ Profit-lock ACTIVE: NAV $${navUsd.toFixed(2)} is ${lockDecision.drawdownPct.toFixed(1)}% below peak $${peakNavForLock.toFixed(2)}. Risk capped at ${lockDecision.riskAllocationCap}%, ${lockDecision.cappedAllocations.USDC ?? 0}% held in USDC.`,
            'WARN',
            {
              drawdownPct: lockDecision.drawdownPct,
              riskCap: lockDecision.riskAllocationCap,
              before: lockDecision.originalAllocations,
              after: lockDecision.cappedAllocations,
            },
          ).catch(() => {});
          aiResult.allocations = lockDecision.cappedAllocations as typeof aiResult.allocations;
        }

        // Track continuous zero-risk-tier duration for alert-response-loop
        // Gap 8's UNWIND_ALL_SPOT rule triggers after > 24h at 0% risk cap.
        try {
          if (lockDecision.active && lockDecision.riskAllocationCap === 0) {
            const existing = await getCronStateOr<number | null>('profit-lock:zero-since', null);
            if (!existing) {
              await setCronState('profit-lock:zero-since', Date.now()).catch(() => {});
            }
          } else {
            await setCronState('profit-lock:zero-since', null).catch(() => {});
          }
        } catch { /* best-effort */ }

        // ── PortfolioDriver — corrective unwind (Gaps 1, 2, 5) ─────
        // Profit-lock caps FUTURE allocations. PortfolioDriver actively
        // reshapes existing holdings toward the cap. Env-gated so the
        // first few days after deploy are log-only — operator watches
        // Discord for what it WOULD do before flipping execute on.
        try {
          const { runPortfolioDriverTick } = await import('@/lib/services/sui/PortfolioDriver');
          const { Polymarket5MinService } = await import('@/lib/services/market-data/Polymarket5MinService');
          const currentSignal = await Polymarket5MinService.getLatest5MinSignal().catch(() => null);
          if (currentSignal) {
            // Build a sandbox-like snapshot from real holdings for the pure driver.
            // Derive per-asset spot USD from the live allocation × NAV. poolStats
            // is already available in this scope from the earlier getPoolStats call.
            const liveAlloc = poolStats.allocation ?? { BTC: 0, ETH: 0, SUI: 0 };
            const spotUsd: Record<string, number> = {
              wBTC: navUsd * ((liveAlloc.BTC || 0) / 100),
              wETH: navUsd * ((liveAlloc.ETH || 0) / 100),
              SUI:  navUsd * ((liveAlloc.SUI || 0) / 100),
            };
            const spotSum = Object.values(spotUsd).reduce((s, v) => s + v, 0);
            const snapshot = {
              idleUsdc: Math.max(0, navUsd - spotSum),
              spot: spotUsd,
              hedges: [] as Array<{ asset: string; side: 'LONG' | 'SHORT'; notionalUsd: number }>,
              getNav: () => navUsd,
            };
            const actions = await runPortfolioDriverTick({
              sandbox: snapshot,
              signal: {
                direction: currentSignal.direction,
                confidence: currentSignal.confidence,
                observedAt: Date.now(),
              },
              nowMs: Date.now(),
              peakNavUsd: peakNavForLock,
              aiAllocation: aiResult.allocations as Record<string, number>,
              spotPrices: pricesUSD,
            });
            if (actions.length > 0) {
              const execute = (process.env.PORTFOLIO_DRIVER_EXECUTE ?? '') === '1';
              logger.warn('[SUI Cron] PortfolioDriver suggests corrective actions', {
                execute, count: actions.length, actions,
              });
              await notifyDiscord(
                `🎯 PortfolioDriver: ${actions.length} corrective action(s) [${execute ? 'EXECUTING' : 'log-only'}]. ${actions.map(a => `${a.type}:${a.asset} $${a.amountUsd}`).join(', ')}`,
                execute ? 'TRADE' : 'INFO',
                { actions, execute },
              ).catch(() => {});
              // Execution wiring: TODO — hook to BluefinAggregatorService for
              // SELL_SPOT_TO_USDC/BUY_SPOT_FROM_USDC and BluefinService for
              // OPEN_HEDGE/CLOSE_HEDGE. Actions above are the source of truth;
              // this cron already has adminUsdc + swap paths later in the flow.
            }
          }
        } catch (driverErr) {
          logger.warn('[SUI Cron] PortfolioDriver threw (non-critical)', {
            error: driverErr instanceof Error ? driverErr.message : String(driverErr),
          });
        }
      } catch (lockErr) {
        logger.warn('[SUI Cron] Profit-lock guard threw (non-critical)', {
          error: lockErr instanceof Error ? lockErr.message : String(lockErr),
        });
      }

      const clamp = clampAllocationsToHedgeable({
        navUsd,
        allocations: aiResult.allocations as Record<string, number>,
        prices: pricesUSD,
        hedgeRatio: ratio,
        leverage: tierLev,
        perpSpecs,
        openInterestUsd,
        maxOiPct: Number(process.env.BLUEFIN_MAX_OI_PCT) || 5,
      });
      if (clamp.redistributed) {
        logger.warn('[SUI Cron] Hedgeability clamp redistributed allocations', {
          dropped: clamp.dropped,
          before: aiResult.allocations,
          after: clamp.allocations,
          navUsd: navUsd.toFixed(2),
          leverage: tierLev,
          hedgeRatio: ratio,
        });
        // Discord intentionally silent — "AI target > minQty" is the
        // steady state on a $50 pool and firing INFO every 30-min cron
        // tick is pure noise. Logged above via logger for audit.
        aiResult.allocations = clamp.allocations as typeof aiResult.allocations;
      } else if (clamp.dropped.length > 0 && !clamp.redistributed) {
        // No survivor — every asset unhedgeable. Fall back to keeping
        // pool in USDC for this cycle (skip swap + skip hedge).
        logger.error('[SUI Cron] No asset can clear minQty at current NAV — skipping swap + hedge', {
          navUsd: navUsd.toFixed(2),
          leverage: tierLev,
          dropped: clamp.dropped,
        });
        // Discord silent — same reason: repeated WARN on a permanently-
        // small pool is noise. Structural state, not an event.
        for (const a of Object.keys(aiResult.allocations)) {
          (aiResult.allocations as Record<string, number>)[a] = 0;
        }
      }
    }

    // Push the off-chain NAV portion to the Move contract's oracle field
    // so deposit + withdraw share math reflects true pool value. Without
    // this, the contract pays withdrawing members against only the
    // on-chain USDC balance (~$0.40 vs $44.99 true NAV on 2026-06-03 =
    // 97% underpayment). Best-effort: failure does NOT block the cron
    // tick (NAV snapshot + reconcile still need to run); the next tick
    // retries. With admin_set_external_nav_required(true), the contract
    // will revert deposits/withdrawals if attestation goes stale,
    // pausing user flow until the cron catches up.
    if (!aboveSafetyCeiling) {
      const attest = await attestExternalNav(network, navUsd);
      if (attest.pushed) {
        logger.info('[SUI Cron] External NAV oracle updated', {
          externalNavUsd: attest.externalNavUsd?.toFixed(2),
          txDigest: attest.txDigest,
        });
      } else if (attest.error && !attest.error.includes('AdminCap is on MSafe')) {
        // MSafe-gated path is expected; everything else is worth surfacing.
        logger.warn('[SUI Cron] External NAV attestation failed (non-fatal)', { error: attest.error });
      }
    }

    await recordPoolNavSnapshot({ sharePriceUsd, navUsd, poolStats, allocations: aiResult.allocations });

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
    // Trigger swaps when:
    //  a) AI detects allocation drift and recommends rebalancing, OR
    //  b) Pool has USDC that hasn't been converted to assets yet (first allocation)
    //     If all previous DB-stored allocations are 0, it's the first run and all USDC
    //     needs to be swapped/hedged into assets. Also force rebalance when the pool has
    //     never had successful swaps (no DB swap records).
    let rebalanceSwaps: SuiCronResult['rebalanceSwaps'] = undefined;
    const hasUnallocatedUsdc = navUsd > 50 && (
      currentAllocations.BTC === 0 &&
      currentAllocations.ETH === 0 &&
      currentAllocations.SUI === 0
    );
    // Only execute on-chain swaps when pool has enough value to avoid
    // catastrophic slippage on micro-amounts. $15 minimum ensures each
    // asset swap is at least ~$3-5 which gets acceptable DEX pricing.
    const MIN_SWAP_NAV_USD = 15;
    const shouldExecuteSwaps = navUsd >= MIN_SWAP_NAV_USD && !aboveSafetyCeiling;
    if (hasUnallocatedUsdc) {
      logger.info('[SUI Cron] Unallocated USDC detected — triggering initial asset allocation', { navUsd });
    }
    if (navUsd > 0.50 && navUsd < MIN_SWAP_NAV_USD) {
      logger.info('[SUI Cron] Pool NAV $' + navUsd.toFixed(2) + ' below $' + MIN_SWAP_NAV_USD + ' swap minimum — skipping swaps to avoid slippage losses');
    }
    if (aboveSafetyCeiling) {
      logger.warn('[SUI Cron] Step 7 skipped — NAV above safety ceiling', { navUsd: navUsd.toFixed(2) });
    }
    if (shouldExecuteSwaps) {
      try {
        const aggregator = getBluefinAggregatorService(network);

        // Use buy-only execution allocations from Step 6.6 if available,
        // else fall back to the raw AI target. The buy-only set zeros out
        // any overweight asset so Step 7 doesn't re-buy what we just sold.
        const planAllocations = (executionAllocations && Object.values(executionAllocations).some(v => v > 0))
          ? executionAllocations as Record<BluefinPoolAsset, number>
          : aiResult.allocations as Record<BluefinPoolAsset, number>;
        if (executionAllocations && executionAllocations !== aiResult.allocations) {
          logger.info('[SUI Cron] Step 7 using buy-only execution allocations (excludes overweight assets)', {
            aiTarget: aiResult.allocations,
            executionAllocations: planAllocations,
          });
        }

        const plan = await aggregator.planRebalanceSwaps(
          navUsd,
          planAllocations,
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

            // Read on-chain state to get exact contract-side balance and hedge values.
            let contractBalance = navUsd; // fallback: use full NAV
            let existingHedgedValue = 0;
            let dailyHedgedToday = 0;
            try {
              const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
              const rpcUrl = network === 'mainnet'
                ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
                : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
              const tmpClient = new SuiClient({ url: rpcUrl });
              const poolConfig = SUI_USDC_POOL_CONFIG[network];
              if (poolConfig.poolStateId) {
                const obj = await tmpClient.getObject({ id: poolConfig.poolStateId, options: { showContent: true } });
                const fields = (obj.data?.content as any)?.fields;
                if (fields) {
                  const rawBal = typeof fields.balance === 'string'
                    ? fields.balance
                    : (fields.balance?.fields?.value || '0');
                  contractBalance = Number(rawBal) / 1e6;
                  existingHedgedValue = Number(fields.hedge_state?.fields?.total_hedged_value || '0') / 1e6;

                  // Read daily hedge counter
                  const hedgeState = fields.hedge_state?.fields;
                  if (hedgeState) {
                    const currentDay = Math.floor(Date.now() / 86400000);
                    const onChainDay = Number(hedgeState.current_hedge_day || 0);
                    if (onChainDay === currentDay) {
                      dailyHedgedToday = Number(hedgeState.daily_hedge_total || 0) / 1e6;
                    }
                  }

                  logger.info('[SUI Cron] On-chain contract state for limit calc', {
                    contractBalance: contractBalance.toFixed(2),
                    existingHedgedValue: existingHedgedValue.toFixed(2),
                    maxHedgeRatioBps: fields.hedge_state?.fields?.auto_hedge_config?.fields?.max_hedge_ratio_bps,
                    dailyHedgedToday: dailyHedgedToday.toFixed(2),
                  });
                }
              }
            } catch (stateErr) {
              logger.warn('[SUI Cron] Failed to read on-chain state for limit calc, using fallback', { error: stateErr });
            }

            // Contract's get_total_nav() returns balance + total_hedged_value (fixed in v5 redeploy).
            const contractNav = contractBalance + existingHedgedValue;
            const maxHedgeTotal = contractNav * 0.5; // max_hedge_ratio_bps=5000
            const maxByHedgeRatio = Math.max(0, maxHedgeTotal - existingHedgedValue);
            const maxByReserve = contractBalance * 0.8;     // 20% reserve must stay in pool

            // Daily cap: 50% of NAV minus what's already been hedged today
            // NOTE: contract resets daily_hedge_total at day boundary when open_hedge is called.
            // If dailyHedgedToday contains prior hedge but we're same calendar day, the contract
            // will reset it atomically. So we check maxByDailyCap but allow the call to fail gracefully.
            const maxByDailyCap = Math.max(0, contractNav * 0.50 - dailyHedgedToday);

            const maxTransferable = Math.min(maxByHedgeRatio, maxByReserve, maxByDailyCap);
            const cappedDeficit = Math.min(deficit, maxTransferable * 0.90); // 10% safety margin

            if (maxByHedgeRatio <= 0) {
              logger.warn('[SUI Cron] Already at max hedge ratio — skipping pool transfer', {
                existingHedgedValue: existingHedgedValue.toFixed(2),
                maxHedgeTotal: maxHedgeTotal.toFixed(2),
              });
              (rebalanceSwaps as any).poolTransfer = {
                requested: '0.00',
                success: false,
                error: 'Max hedge ratio reached',
              };
            } else if (maxTransferable <= 0 || cappedDeficit <= 0.000001) {
              // Daily cap exhausted on-chain. Try an AI-driven reset before
              // giving up: if the prediction-market signal is strong (urgency
              // HIGH/CRITICAL or confidence >= 75) and we still have reset
              // budget left for today, zero the counter and retry.
              const resetOutcome = await aiDrivenResetDailyHedge(network, {
                urgency: enhancedContext?.urgency,
                confidence: aiResult.confidence,
              });

              if (resetOutcome.reset) {
                logger.info('[SUI Cron] Daily cap was exhausted — AI-driven reset successful, retrying transfer', {
                  txDigest: resetOutcome.txDigest,
                  resetsUsedToday: resetOutcome.resetsUsed,
                  urgency: enhancedContext?.urgency,
                  confidence: aiResult.confidence,
                });
                // After reset, the full daily cap is available again — retry
                // with the original deficit (bounded by hedge ratio + reserve).
                const newCap = Math.min(maxByHedgeRatio, maxByReserve);
                const retryAmount = Math.min(deficit, newCap * 0.90);
                if (retryAmount > 0.01) {
                  const transferResult = await transferUsdcFromPoolToAdmin(network, retryAmount);
                  (rebalanceSwaps as any).poolTransfer = {
                    requested: retryAmount.toFixed(2),
                    success: transferResult.success,
                    txDigest: transferResult.txDigest,
                    resetTxDigest: resetOutcome.txDigest,
                    error: transferResult.error,
                  };
                  if (transferResult.success) {
                    logger.info('[SUI Cron] Pool → admin USDC transfer succeeded after AI-driven reset', {
                      txDigest: transferResult.txDigest, amount: retryAmount.toFixed(2),
                    });
                    await new Promise(r => setTimeout(r, 2000));
                  } else {
                    logger.warn('[SUI Cron] Transfer failed after reset', {
                      error: transferResult.error,
                    });
                  }
                } else {
                  (rebalanceSwaps as any).poolTransfer = {
                    requested: '0.00', success: false,
                    error: 'After reset, no headroom (hedge ratio or reserve exhausted)',
                    resetTxDigest: resetOutcome.txDigest,
                  };
                }
              } else {
                // Reset declined — signal too weak or budget exhausted.
                const minutesToMidnight = Math.ceil(((86_400_000 - (Date.now() % 86_400_000)) / 60_000));
                logger.info('[SUI Cron] On-chain daily cap exhausted; AI-driven reset NOT applied — skipping transfer', {
                  deficit: deficit.toFixed(2),
                  maxByDailyCap: maxByDailyCap.toFixed(2),
                  resetReason: resetOutcome.reason,
                  resetError: resetOutcome.error,
                  urgency: enhancedContext?.urgency,
                  confidence: aiResult.confidence,
                  minutesToMidnight,
                });
                (rebalanceSwaps as any).poolTransfer = {
                  requested: '0.00',
                  success: false,
                  error: `daily cap exhausted; reset declined (${resetOutcome.reason}); resets in ${minutesToMidnight}m`,
                };
              }
            } else {
            logger.info('[SUI Cron] Admin USDC insufficient — transferring from pool via open_hedge', {
              deficit: deficit.toFixed(2),
              contractNav: contractNav.toFixed(2),
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
              logger.warn('[SUI Cron] Pool → admin USDC transfer failed', {
                error: transferResult.error,
              });
            }
            } // close else block for maxByHedgeRatio > 0
          }

          // Step 7c: Check actual admin USDC balance before proceeding
          const actualAdminUsdc = await getAdminUsdcBalance(network);

          // BAIL OUT if admin has no meaningful USDC (transfer failed or wasn't needed)
          if (actualAdminUsdc < 0.10) {
            logger.warn('[SUI Cron] Admin USDC too low to execute swaps — skipping', {
              actualAdminUsdc: actualAdminUsdc.toFixed(4),
            });
            (rebalanceSwaps as any).swapBudget = actualAdminUsdc.toFixed(2);
            (rebalanceSwaps as any).executed = 0;
            (rebalanceSwaps as any).failed = 0;
            (rebalanceSwaps as any).swapResults = [];
          } else {
          // Re-plan swaps with actual available admin USDC budget
          let swapPlan = plan;
          if (actualAdminUsdc < totalUsdcNeeded * 0.95 && actualAdminUsdc > 0.10) {
            // Budget is limited — re-plan with available USDC.
            // Use the same buy-only allocations the initial plan used, so the
            // re-plan also skips overweight assets.
            logger.info('[SUI Cron] Re-planning swaps with available budget', {
              available: actualAdminUsdc.toFixed(2),
              originalNeeded: totalUsdcNeeded.toFixed(2),
            });
            try {
              swapPlan = await aggregator.planRebalanceSwaps(
                actualAdminUsdc,
                planAllocations,
              );
            } catch (replanErr) {
              logger.warn('[SUI Cron] Re-plan failed, using original plan', { error: replanErr });
            }
          }

          // Execute on-chain swaps
          try {
            const execResult = await aggregator.executeRebalance(swapPlan, 0.015);
            
            rebalanceSwaps.executed = execResult.totalExecuted;
            rebalanceSwaps.failed = execResult.totalFailed;
            rebalanceSwaps.txDigests = execResult.results
              .filter((r): r is typeof r & { txDigest: string } => !!r.txDigest)
              .map(r => ({ asset: r.asset, digest: r.txDigest }));
            // Include per-swap error details for diagnostics
            (rebalanceSwaps as any).swapResults = execResult.results.map(r => ({
              asset: r.asset,
              success: r.success,
              amountIn: r.amountIn,
              amountOut: r.amountOut,
              txDigest: r.txDigest,
              error: r.error,
            }));
            (rebalanceSwaps as any).swapBudget = actualAdminUsdc.toFixed(2);

            logger.info('[SUI Cron] On-chain swaps executed', {
              executed: execResult.totalExecuted,
              failed: execResult.totalFailed,
              budget: actualAdminUsdc.toFixed(2),
              digests: execResult.results.filter(r => r.txDigest).map(r => r.txDigest),
              errors: execResult.results.filter(r => !r.success).map(r => `${r.asset}: ${r.error}`),
            });
          } catch (execErr) {
            logger.error('[SUI Cron] On-chain swap execution failed', { error: execErr });
            (rebalanceSwaps as any).executionError = execErr instanceof Error ? execErr.message : String(execErr);
          }
          } // end else (admin has enough USDC)
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
      const { checkAndCloseDrifts } = await import('@/lib/services/agents/position-drift-monitor');
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
    // Signal-driven hedging:
    //  • Direction comes from AI sentiment (BULLISH→LONG, BEARISH/NEUTRAL→SHORT-protective)
    //  • Triggers on every cycle where NAV ≥ HEDGE_MIN_NAV_USD ($20 default), not gated by risk
    //  • Auto-bumps leverage to 5x at sub-$1000 NAV so we clear BlueFin minQty
    //  • Skips assets that already have an active position (no duplicate spam)
    //  • Per-asset allocation ≥ 5% required to qualify (avoids dust)
    // To override behavior:
    //  • HEDGE_MIN_NAV_USD          — gate floor (default 20)
    //  • HEDGE_RISK_THRESHOLD_DEFAULT — keep risk-gating (default 0 = disabled)
    //  • SUI_AUTO_HEDGE_DISABLE=1   — fully disable
    // ═══════════════════════════════════════════════════════════════
    type AutoHedgeRow = { symbol: string; side: string; size: number; status: string; orderId?: string; error?: string };
    let autoHedgeResult: { triggered: boolean; hedges?: AutoHedgeRow[] } = { triggered: false };
    const MIN_HEDGE_NAV_USD = Number(process.env.HEDGE_MIN_NAV_USD) || 20;
    const HEDGE_DISABLED = process.env.SUI_AUTO_HEDGE_DISABLE === '1';

    // ── Drawdown auto-halt ─────────────────────────────────────────
    // The cron auto-opens positions every 30min but has no global
    // equity stop — many small losses can bleed the pool without any
    // individual position hitting liquidation-guard. Use the
    // `poolNav:peak:community-pool` value that pool-nav-monitor
    // already tracks as a global peak, compare against current NAV,
    // and halt auto-hedge for the rest of the UTC day if drawdown
    // exceeds the configured ceiling (default 10%).
    //
    // Halt is honored via cronHaltUntil — same primitive bluefin-
    // health uses. Clears at UTC midnight when the next day's pool-
    // nav-monitor tick can re-establish peak.
    const HEDGE_DRAWDOWN_HALT_PCT = Number(process.env.HEDGE_DRAWDOWN_HALT_PCT) || 10;
    let drawdownHalted = false;
    try {
      const existingHalt = await getCronHalt('sui-community-pool:autohedge');
      if (existingHalt) {
        drawdownHalted = true;
        logger.warn('[SUI Cron] Auto-hedge halt active', { until: new Date(existingHalt.untilMs).toISOString(), reason: existingHalt.reason });
      } else {
        const peakNav = await getCronStateOr<number>(CronKeys.poolNavPeak('community-pool'), navUsd);
        if (peakNav > 0 && navUsd < peakNav) {
          const ddPct = ((peakNav - navUsd) / peakNav) * 100;
          if (ddPct >= HEDGE_DRAWDOWN_HALT_PCT) {
            await setCronHalt(
              'sui-community-pool:autohedge',
              endOfUtcDayMs(),
              `Pool NAV $${navUsd.toFixed(2)} is ${ddPct.toFixed(1)}% below peak $${peakNav.toFixed(2)} (>= ${HEDGE_DRAWDOWN_HALT_PCT}% halt threshold). Auto-hedge paused until UTC midnight.`,
            );
            await notifyDiscord(
              `Auto-hedge HALTED — pool NAV $${navUsd.toFixed(2)} is ${ddPct.toFixed(1)}% below peak $${peakNav.toFixed(2)} (threshold ${HEDGE_DRAWDOWN_HALT_PCT}%). Paused until UTC midnight.`,
              'KILL',
              { navUsd, peakNav, drawdownPct: ddPct.toFixed(2), threshold: HEDGE_DRAWDOWN_HALT_PCT },
            );
            drawdownHalted = true;
          }
        }
      }
    } catch (haltErr) {
      logger.warn('[SUI Cron] Drawdown halt check threw — failing open', { error: haltErr });
    }

    if (HEDGE_DISABLED) {
      logger.info('[SUI Cron] Auto-hedge disabled by SUI_AUTO_HEDGE_DISABLE=1');
    } else if (drawdownHalted) {
      logger.warn('[SUI Cron] Auto-hedge skipped — drawdown halt active');
    } else if (aboveSafetyCeiling) {
      logger.warn('[SUI Cron] Auto-hedge skipped — NAV above safety ceiling', {
        navUsd: navUsd.toFixed(2),
        ceiling: NAV_SAFETY_CEILING_USDC,
      });
    } else if (navUsd < MIN_HEDGE_NAV_USD) {
      logger.info(`[SUI Cron] Pool NAV $${navUsd.toFixed(2)} below HEDGE_MIN_NAV_USD=$${MIN_HEDGE_NAV_USD} — skipping Step 8`);
    } else {
      try {
        const allConfigs = await getAutoHedgeConfigs();
        const suiPoolConfig = allConfigs.find(c =>
          isSuiCommunityPool(c.portfolioId) ||
          c.portfolioId === SUI_COMMUNITY_POOL_PORTFOLIO_ID ||
          (c as { poolAddress?: string }).poolAddress === process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID,
        );

        // Default-enabled when DB row missing (signal-driven hedging)
        const enabled = suiPoolConfig ? suiPoolConfig.enabled : true;
        const riskScore = aiResult.riskScore ?? 0;
        // Default threshold = 0 → AI sentiment drives hedging, not risk-cascade
        const threshold = suiPoolConfig?.riskThreshold ?? Number(process.env.HEDGE_RISK_THRESHOLD_DEFAULT || 0);
        const passesRiskGate = riskScore >= threshold;

        if (!enabled) {
          logger.debug('[SUI Cron] Auto-hedging disabled in suiPoolConfig');
        } else if (!passesRiskGate) {
          logger.info('[SUI Cron] Auto-hedge skipped — risk gate not met', { riskScore, threshold });
        } else if (!process.env.BLUEFIN_PRIVATE_KEY) {
          logger.warn('[SUI Cron] Auto-hedge skipped — BLUEFIN_PRIVATE_KEY missing');
        } else {
          // ── Direction: AI sentiment ────────────────────────────────
          const sentiment = (enhancedContext.marketSentiment || 'NEUTRAL').toUpperCase();
          const side: 'LONG' | 'SHORT' = sentiment === 'BULLISH' ? 'LONG' : 'SHORT';

          // ── Leverage: bump to 10x for tiny NAV so BTC clears minQty=0.001 ─
          // BTC at $78k requires effective notional ≥ $78.66 to snap to minQty.
          // At NAV=$50, alloc=30%, that means we need leverage ≥ 6x.
          // We default to 10x at NAV<$1000 (BlueFin max for BTC perp), with
          // suiPoolConfig.maxLeverage as a soft cap that operators can lower.
          // Above $1k we drop to 5x; above $1M we cap at 3x to limit
          // single-wallet liquidation risk; above $100M cap at 2x because
          // a single 50% adverse move would wipe a pool of that size.
          const leverage = resolveLeverage(navUsd, suiPoolConfig?.maxLeverage);
          const hedgeRatio = hedgeRatioForNav(navUsd);

          logger.info('[SUI Cron] Auto-hedge plan', {
            navUsd: navUsd.toFixed(2), sentiment, side, leverage, hedgeRatio,
            riskScore, threshold,
            allocations: aiResult.allocations,
          });

          const hedges: AutoHedgeRow[] = [];
          try {
            const bluefin = BluefinService.getInstance();

            // ── Margin top-up: pool USDC → admin spot → BlueFin margin bank ─
            // Money flow each cycle:
            //   1. Step 6.5 already moved USDC pool → admin (treasury rail
            //      via open_hedge) and Step 7 swapped portions to spot
            //      BTC/ETH/SUI per AI allocation.
            //   2. Now deposit remaining admin USDC into BlueFin margin bank
            //      so the perp hedges have collateral. Falls back to swapping
            //      a small amount of admin SUI → USDC if spot USDC is short.
            //   3. After hedges close (separate flow), BlueFin USDC withdraws
            //      back to admin, which feeds the next reverse-swap cycle.
            // Margin requirement: notional / leverage (10x => 10% of NAV).
            const totalAllocPct = (['BTC','ETH','SUI'] as const)
              .reduce((s, a) => s + Math.max(0, aiResult.allocations[a] || 0), 0);
            const targetMargin = computeTargetMargin(navUsd, totalAllocPct, hedgeRatio, leverage);
            const minMargin = targetMargin * 0.9;
            try {
              // Reserves and swap caps scale with NAV so the same code
              // works for $50 testnet pools and $100M production pools.
              //   • spotReserve: 0.05% of NAV (min $0.50, max $5k buffer)
              //   • suiReserve:  0.001% of NAV in SUI equiv (min 0.5 SUI)
              //   • maxSwapSui:  0.1% of NAV per tick, expressed in SUI
              const { spotReserve: scaledSpotReserve, suiReserve: scaledSuiReserve, maxSwapSui: scaledMaxSwapSui } = scaledReserves(navUsd, pricesUSD['SUI']);
              // Honor the AI's SUI allocation: autoTopUp must NOT sweep the
              // target SUI spot position back to USDC. Without this guard,
              // Step 7 buys SUI for the spot leg → autoTopUp immediately
              // swaps it to USDC → SUI never accumulates on the wallet.
              // Reserve covers gas + the target SUI allocation; only EXCESS
              // SUI above (reserve + target) is sweepable.
              const suiPrice = pricesUSD['SUI'] || 0;
              const targetSuiUsd = (navUsd * Number(aiResult.allocations.SUI || 0)) / 100;
              const targetSuiUnits = suiPrice > 0 ? targetSuiUsd / suiPrice : 0;
              const suiReserveWithTarget = scaledSuiReserve + targetSuiUnits;
              const topUp = await bluefinTreasury.autoTopUp({
                minMargin, targetMargin,
                spotReserve: scaledSpotReserve,
                swapFromSui: true,
                suiReserve: suiReserveWithTarget,
                maxSwapSui: scaledMaxSwapSui,
              });
              logger.info('[SUI Cron] Margin top-up', {
                minMargin: minMargin.toFixed(4),
                targetMargin: targetMargin.toFixed(4),
                result: topUp,
              });
            } catch (tuErr) {
              logger.warn('[SUI Cron] Margin top-up failed (proceeding to hedge loop)', {
                error: tuErr instanceof Error ? tuErr.message : String(tuErr),
              });
            }

            // ── Dedup gate: skip assets with an active live position ─
            const existing = await bluefin.getPositions().catch(() => []);
            const liveSet = new Set(
              existing.map(p => `${p.symbol}|${(p.side || '').toUpperCase()}`),
            );

            // ── Self-healing reconciler ────────────────────────────
            // Two failure modes the open-loop hedger can leave behind:
            //   (a) Orphan rows: DB row exists but BlueFin has no matching
            //       position (margin call, manual close, failed open we
            //       optimistically recorded, etc.). Close them so dashboard
            //       and dedup gate stay accurate.
            //   (b) Duplicate rows: multiple active rows for one live
            //       (market, side). Keep the newest, close the rest.
            // Scope is intentionally narrow: only sui rows that are NOT
            // mirrored from on-chain pool hedges (hedge_id_onchain IS NULL).
            try {
              const dbActive = await query<{
                id: number; order_id: string; market: string; side: string; created_at: Date;
              }>(
                `SELECT id, order_id, market, side, created_at
                 FROM hedges
                 WHERE chain = 'sui'
                   AND status = 'active'
                   AND (hedge_id_onchain IS NULL OR hedge_id_onchain = '')`,
              );
              const groups = new Map<string, typeof dbActive>();
              for (const row of dbActive) {
                const key = `${row.market}|${(row.side || '').toUpperCase()}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(row);
              }
              let closedOrphans = 0, closedDups = 0;
              for (const [key, rows] of groups.entries()) {
                if (!liveSet.has(key)) {
                  // (a) orphan: no live counterpart
                  for (const r of rows) {
                    await updateHedgeStatus(r.order_id, 'closed').catch(() => {});
                    closedOrphans++;
                  }
                } else if (rows.length > 1) {
                  // (b) duplicate: keep newest, close rest
                  const sorted = [...rows].sort(
                    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                  );
                  for (let i = 1; i < sorted.length; i++) {
                    await updateHedgeStatus(sorted[i].order_id, 'closed').catch(() => {});
                    closedDups++;
                  }
                }
              }
              if (closedOrphans + closedDups > 0) {
                logger.info('[SUI Cron] Self-healing reconciler', {
                  closedOrphans, closedDups, totalActive: dbActive.length,
                });
              }
            } catch (rcErr) {
              logger.warn('[SUI Cron] Self-healing reconciler failed', {
                error: rcErr instanceof Error ? rcErr.message : String(rcErr),
              });
            }

            const PERP_SPECS: Record<string, { minQty: number; stepSize: number }> = {
              BTC: { minQty: 0.001, stepSize: 0.001 },
              ETH: { minQty: 0.01, stepSize: 0.01 },
              SUI: { minQty: 1, stepSize: 1 },
            };

            for (const asset of ['BTC', 'ETH', 'SUI'] as const) {
              const symbol = `${asset}-PERP`;
              const key = `${symbol}|${side}`;
              if (liveSet.has(key)) {
                logger.info(`[SUI Cron] Skip ${asset}-PERP ${side}: position already active`);
                hedges.push({ symbol, side, size: 0, status: 'SKIPPED_DUP' });
                continue;
              }

              // Direction-flip: if an opposite-side position exists, close
              // it before opening the new direction. Without this the cron
              // accumulates both legs (one LONG + one SHORT on the same
              // symbol) and burns margin for net-zero exposure until
              // liquidation-guard fires. The existing dedup gate above
              // only catches same-side dupes, not flips.
              const oppositeSide: 'LONG' | 'SHORT' = side === 'LONG' ? 'SHORT' : 'LONG';
              const oppositeKey = `${symbol}|${oppositeSide}`;
              if (liveSet.has(oppositeKey)) {
                logger.info(`[SUI Cron] Direction flip — closing existing ${oppositeKey} before opening ${key}`);
                try {
                  const closeRes = await bluefin.closeHedge({ symbol });
                  if (!closeRes.success) {
                    logger.warn(`[SUI Cron] Direction-flip close FAILED for ${symbol} — skipping open to avoid double-leg accumulation`, {
                      error: closeRes.error,
                      preCloseSize: (closeRes as { preCloseSize?: number }).preCloseSize,
                      postCloseSize: (closeRes as { postCloseSize?: number }).postCloseSize,
                    });
                    await notifyDiscord(
                      `Direction-flip close FAILED for ${symbol} (was ${oppositeSide}, wanted ${side}). Skipping open to avoid double-leg margin burn. Investigate: ${closeRes.error}`,
                      'WARN',
                      { symbol, fromSide: oppositeSide, toSide: side, error: closeRes.error },
                    );
                    hedges.push({ symbol, side, size: 0, status: 'SKIPPED_FLIP_CLOSE_FAILED', error: closeRes.error });
                    continue;
                  }
                  await notifyDiscord(
                    `Direction-flip on ${symbol}: closed ${oppositeSide}, opening ${side}.`,
                    'INFO',
                    { symbol, fromSide: oppositeSide, toSide: side, closeOrderId: closeRes.orderId },
                  );
                  // Brief settle window so the next openHedge's pre-trade
                  // margin check sees the freed collateral.
                  await new Promise(r => setTimeout(r, 1500));
                } catch (flipErr) {
                  const msg = flipErr instanceof Error ? flipErr.message : String(flipErr);
                  logger.warn(`[SUI Cron] Direction-flip close threw for ${symbol} — skipping open`, { error: msg });
                  hedges.push({ symbol, side, size: 0, status: 'SKIPPED_FLIP_CLOSE_ERROR', error: msg });
                  continue;
                }
              }

              const allocation = aiResult.allocations[asset] || 0;
              if (allocation < 5) {
                hedges.push({ symbol, side, size: 0, status: 'SKIPPED_LOW_ALLOC' });
                continue;
              }

              const price = pricesUSD[asset] || 0;
              if (price <= 0) {
                hedges.push({ symbol, side, size: 0, status: 'SKIPPED_NO_PRICE' });
                continue;
              }

              const hedgeValueUSD = hedgeValueUsd(navUsd, allocation, hedgeRatio);
              const effectiveValue = hedgeValueUSD * leverage;
              const hedgeSizeBase = effectiveValue / price;
              const spec = PERP_SPECS[asset];
              const snappedSize = Math.floor(hedgeSizeBase / spec.stepSize) * spec.stepSize;

              if (snappedSize < spec.minQty) {
                logger.info(`[SUI Cron] Skip ${asset}-PERP: size ${snappedSize} < minQty ${spec.minQty}`, {
                  allocation, hedgeValueUSD, effectiveValue, leverage, hedgeRatio,
                });
                hedges.push({ symbol, side, size: snappedSize, status: 'SKIPPED_MIN_QTY' });
                continue;
              }

              // ── DUST5: prevent creating positions that WILL become dust ───
              // Opening at exactly minQty leaves no buffer; a single partial
              // fill / funding shrink / PnL normalization can drop the size
              // below minQty and trap the margin. Require 1.5x minQty (see
              // OPEN_MIN_QTY_BUFFER in dust-manager.ts). Compare against the
              // TARGET post-snap size, not the pre-snap raw size.
              try {
                const { wouldBecomeDust } = await import('@/lib/services/sui/dust-manager');
                if (wouldBecomeDust(symbol, snappedSize)) {
                  const minSafe = spec.minQty * 1.5;
                  logger.info(`[SUI Cron] Skip ${asset}-PERP: size ${snappedSize} risks dust (< ${minSafe.toFixed(4)} = 1.5x minQty)`, {
                    snappedSize, minQty: spec.minQty, minSafeSize: minSafe, hedgeValueUSD,
                  });
                  hedges.push({ symbol, side, size: snappedSize, status: 'SKIPPED_DUST_RISK' });
                  continue;
                }
              } catch (dustGuardErr) {
                logger.debug('[SUI Cron] Dust guard threw (non-critical)', {
                  error: dustGuardErr instanceof Error ? dustGuardErr.message : String(dustGuardErr),
                });
              }

              // ── T5-A Phase 3 shadow mode ─────────────────────────
              // When PERP_ROUTER_SHADOW=true, compute what the multi-
              // venue router WOULD do alongside the existing BlueFin
              // direct call. Logs the plan + Discord-alerts if the
              // router would have made a different choice (e.g. split
              // across venues, picked Hyperliquid for lower funding).
              // Zero execution change — purely diagnostic so we can
              // validate the router in production before flipping live.
              if ((process.env.PERP_ROUTER_SHADOW || '').toLowerCase() === 'true') {
                try {
                  const { routeHedge } = await import('@/lib/services/perps/PerpVenueRouter');
                  const { HyperliquidService } = await import('@/lib/services/perps/HyperliquidService');
                  const hl = HyperliquidService.getInstance();
                  const [bfMd, hlSnap] = await Promise.all([
                    bluefin.getMarketData(symbol).catch(() => null),
                    hl.getMarketSnapshot(symbol).catch(() => null),
                  ]);
                  const venues = [] as Array<{ name: string; oiUsd: number; fundingRate8h: number; canTrade: boolean }>;
                  if (bfMd) venues.push({ name: 'bluefin', oiUsd: bfMd.openInterestUsd ?? 0, fundingRate8h: bfMd.fundingRate ?? 0, canTrade: true });
                  if (hlSnap) venues.push({ name: 'hyperliquid', oiUsd: hlSnap.openInterestUsd, fundingRate8h: hlSnap.fundingRate, canTrade: false });
                  const plan = routeHedge({ symbol, notionalUsd: hedgeValueUSD, side, venues, maxOiPct: Number(process.env.BLUEFIN_MAX_OI_PCT) || 5 });
                  logger.info('[SUI Cron][shadow-router]', { symbol, plan, venues });
                  const primaryVenue = plan.legs[0]?.venue ?? 'none';
                  const wouldDiverge = plan.legs.length > 1 || (primaryVenue !== 'bluefin' && plan.legs.length > 0);
                  if (wouldDiverge) {
                    await notifyDiscord(
                      `[shadow-router] ${symbol} ${side} $${hedgeValueUSD.toFixed(2)}: router would split across ${plan.legs.length} legs (primary ${primaryVenue}), blended cost ${plan.blendedFundingCostBps8h.toFixed(2)}bps/8h. Live path still using direct BlueFin.`,
                      'INFO',
                      { symbol, primaryVenue, legs: plan.legs, blendedCostBps: plan.blendedFundingCostBps8h },
                    );
                  }
                } catch (shadowErr) {
                  logger.debug('[SUI Cron][shadow-router] failed (non-critical)', {
                    error: shadowErr instanceof Error ? shadowErr.message : String(shadowErr),
                  });
                }
              }

              try {
                logger.info(`[SUI Cron] Opening ${asset}-PERP ${side}`, {
                  allocation, hedgeValueUSD: hedgeValueUSD.toFixed(4),
                  effectiveValue: effectiveValue.toFixed(4),
                  snappedSize, leverage, sentiment,
                });

                // ── AGENT GATE — AG1 + AG2 ──────────────────────────────
                // Consult HedgingAgent + RiskAgent (cached from runAutonomous
                // Cycle) + SafeExecutionGuard before opening. Block on:
                //   - per-asset HOLD directive
                //   - high-confidence side mismatch
                //   - risk score above ceiling
                //   - position cap / slippage / cooldown breach
                // Logs to agent_decisions for outcome tracking.
                const { checkBeforeTrade, completeTrade } = await import('@/lib/services/agents/agent-trade-guard');
                const guard = await checkBeforeTrade({
                  chain: 'sui',
                  asset,
                  intendedSide: side as 'LONG' | 'SHORT',
                  notionalUsd: hedgeValueUSD,
                  agentSource: 'sui-community-pool-cron',
                });

                if (!guard.approved) {
                  logger.warn(`[SUI Cron] Agent guard BLOCKED ${asset}-PERP ${side}`, {
                    stage: guard.stage, reason: guard.reason,
                  });
                  await notifyDiscord(
                    `🛡️ Agent guard blocked ${asset}-PERP ${side} ($${hedgeValueUSD.toFixed(2)}): ${guard.reason}`,
                    'WARN',
                    { stage: guard.stage, asset, side, notionalUsd: hedgeValueUSD.toFixed(2), agentSide: guard.agentSide, agentConfidence: guard.agentConfidence },
                  );
                  hedges.push({
                    symbol, side, size: snappedSize,
                    status: 'BLOCKED_BY_AGENT',
                    error: guard.reason,
                  });
                  continue;
                }

                if (guard.agentSide && guard.agentSide !== side) {
                  // Side mismatch under low confidence → log informationally
                  logger.info(`[SUI Cron] Agent diverged on ${asset} side but confidence too low to block`, {
                    cronSide: side, agentSide: guard.agentSide, conf: guard.agentConfidence,
                  });
                }

                const result = await bluefin.openHedge({
                  symbol,
                  side,
                  size: snappedSize,
                  leverage,
                  portfolioId: -2,
                  reason: `Auto-hedge: ${side} via ${sentiment} signal (risk=${riskScore}/${threshold}) | agent: ${guard.reason}`,
                });

                // Post-open verification: BlueFin returns `success` as soon as
                // the order is accepted, but the position only materializes
                // after the matching engine fills it. With tight margin the
                // fill can be rejected, leaving us with an orphan DB row.
                // Wait briefly and re-poll positions; only persist if the
                // (symbol, side) actually shows up.
                let filled = false;
                if (result.success && result.orderId) {
                  await new Promise(r => setTimeout(r, 2_500));
                  try {
                    const post = await bluefin.getPositions();
                    filled = post.some(p =>
                      p.symbol === symbol &&
                      (p.side || '').toUpperCase() === side &&
                      Number((p as { size?: number }).size ?? 0) > 0,
                    );
                  } catch {
                    // If the verification call fails we can't confirm — be
                    // conservative and skip persisting; the order is on
                    // BlueFin and the next cycle's reconciler will adopt it
                    // into the DB if it actually exists.
                    filled = false;
                  }
                }

                hedges.push({
                  symbol, side, size: snappedSize,
                  status: result.success
                    ? (filled ? 'OPENED' : 'ACCEPTED_NOT_FILLED')
                    : 'FAILED',
                  orderId: result.orderId, error: result.error,
                });

                // Settle the SafeGuard execution + record outcome for agent
                // accuracy tracking. Best-effort; never breaks the cron.
                try {
                  await completeTrade(guard, {
                    chain: 'sui', asset,
                    intendedSide: side as 'LONG' | 'SHORT',
                    notionalUsd: hedgeValueUSD,
                    orderId: result.orderId ?? null,
                    success: result.success && filled,
                    error: result.error,
                  });
                } catch (settleErr) {
                  logger.debug('[SUI Cron] completeTrade settle threw (non-fatal)', {
                    error: settleErr instanceof Error ? settleErr.message : String(settleErr),
                  });
                }

                if (result.success && result.orderId && filled) {
                  try {
                    await createHedge({
                      orderId: result.orderId,
                      portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
                      walletAddress: (process.env.SUI_ADMIN_ADDRESS || '').trim(),
                      asset,
                      market: symbol,
                      side,
                      size: snappedSize,
                      notionalValue: hedgeValueUSD,
                      leverage,
                      entryPrice: price,
                      simulationMode: false,
                      chain: 'sui',
                      reason: `Auto-hedge: ${side} via ${sentiment} signal`,
                    });
                  } catch (dbErr) {
                    logger.warn('[SUI Cron] Failed to persist hedge', { asset, error: dbErr });
                  }
                  await notifyDiscord(
                    `Auto-hedge OPENED: ${side} ${snappedSize} ${asset}-PERP @ ${leverage}x (notional $${hedgeValueUSD.toFixed(2)}, signal=${sentiment}).`,
                    'TRADE',
                    { network, asset, side, size: snappedSize, leverage, notionalUsd: hedgeValueUSD.toFixed(2), orderId: result.orderId },
                  );

                  // Privacy attestation: emit zk_hedge_commitment::store_commitment
                  // for the hedge we just opened. Hides asset/side/size/leverage/
                  // entryPrice behind a 32-byte commitment hash. Skips cleanly if
                  // privacy contracts aren't deployed (mainnet env vars unset).
                  try {
                    const { emitPrivateHedgeCommitment } = await import('@/lib/services/sui/cron/private-hedge-emit');
                    const emit = await emitPrivateHedgeCommitment({
                      asset, side, size: snappedSize,
                      notionalValue: hedgeValueUSD, leverage,
                      entryPrice: price, orderId: result.orderId,
                    }, network as 'mainnet' | 'testnet');
                    if (emit.success) {
                      logger.info('[SUI Cron] Private hedge commitment emitted', {
                        orderId: result.orderId,
                        commitment: emit.commitmentHashHex?.slice(0, 16) + '...',
                        txDigest: emit.txDigest,
                      });
                      // Discord silent — the "Auto-hedge OPENED" TRADE
                      // alert above already announced the hedge. Adding
                      // a second INFO ping about the ZK commitment
                      // that ALWAYS accompanies it doubles Discord
                      // volume without adding operator-actionable info.
                      // ZK commitment digest is logged via logger for
                      // audit trail.
                    } else if (!emit.skipped) {
                      logger.warn('[SUI Cron] Private hedge commitment failed (non-critical)', {
                        orderId: result.orderId, error: emit.error,
                      });
                    }
                  } catch (zkErr) {
                    // Privacy emission is best-effort — never fail the cron over it
                    logger.debug('[SUI Cron] Private hedge emit threw (non-critical)', {
                      error: zkErr instanceof Error ? zkErr.message : String(zkErr),
                    });
                  }
                } else if (result.success && result.orderId && !filled) {
                  // Order accepted by BlueFin but not yet filled — collateral
                  // is reserved against the resting order. Visible state but
                  // not yet a position. Surface this to operators since the
                  // reconciler will pick it up only after fill.
                  await notifyDiscord(
                    `Auto-hedge PENDING: ${side} ${snappedSize} ${asset}-PERP @ ${leverage}x accepted, awaiting fill (notional $${hedgeValueUSD.toFixed(2)}, signal=${sentiment}).`,
                    'INFO',
                    { network, asset, side, size: snappedSize, leverage, notionalUsd: hedgeValueUSD.toFixed(2), orderId: result.orderId },
                  );
                } else if (!result.success) {
                  await notifyDiscord(
                    `Auto-hedge FAILED: ${side} ${snappedSize} ${asset}-PERP @ ${leverage}x — ${result.error || 'unknown'}.`,
                    'WARN',
                    { network, asset, side, size: snappedSize, leverage, error: result.error },
                  );
                }
                logger.info(`[SUI Cron] ${asset}-PERP ${side} ${result.success ? 'OPENED' : 'FAILED'}`, {
                  size: snappedSize, leverage, orderId: result.orderId, error: result.error,
                });
              } catch (hedgeErr) {
                hedges.push({
                  symbol, side, size: snappedSize, status: 'ERROR',
                  error: hedgeErr instanceof Error ? hedgeErr.message : String(hedgeErr),
                });
                logger.error(`[SUI Cron] ${asset}-PERP ${side} threw`, { error: hedgeErr });
              }
            }

            autoHedgeResult = { triggered: true, hedges };
          } catch (bfErr) {
            logger.error('[SUI Cron] BlueFin hedging failed', { error: bfErr });
            autoHedgeResult = {
              triggered: true,
              hedges: [{ symbol: 'ALL', side: 'N/A', size: 0, status: 'ERROR', error: String(bfErr) }],
            };
          }
        }
      } catch (hedgeConfigErr) {
        logger.warn('[SUI Cron] Auto-hedge config check failed (non-critical)', { error: hedgeConfigErr });
      }
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
      const { runPolyDiscoverTick } = await import('@/lib/services/market-data/poly-discover-tick');
      const polyResult = await runPolyDiscoverTick();
      // Heartbeat for /api/health/production cron-freshness check on the
      // poly-discover key, so ops can still tell discovery is running.
      const { setCronState } = await import('@/lib/db/cron-state');
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
      const { getAgentOrchestrator } = await import('@/lib/services/agent-orchestrator');
      const orchestrator = getAgentOrchestrator();
      const cycle = await orchestrator.runAutonomousCycle({
        chain: 'sui',
        portfolioId: -2,
      });
      const { setCronState } = await import('@/lib/db/cron-state');
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
          const { notifyDiscord } = await import('@/lib/utils/discord-notify');
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
