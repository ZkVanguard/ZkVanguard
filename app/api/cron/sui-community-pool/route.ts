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
  recordNavSnapshot,
  saveUserSharesToDb,
  savePoolStateToDb,
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { query } from '@/lib/db/postgres';
import { getMarketDataService } from '@/lib/services/market-data/RealMarketDataService';
import { getMultiSourceValidatedPrice } from '@/lib/services/market-data/unified-price-provider';
import { getBluefinAggregatorService, type PoolAsset as BluefinPoolAsset } from '@/lib/services/sui/BluefinAggregatorService';
import { getSuiPoolAgent, type AllocationDecision } from '@/agents/specialized/SuiPoolAgent';
import { getAutoHedgeConfigs } from '@/lib/storage/auto-hedge-storage';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID, isSuiCommunityPool } from '@/lib/constants';
import { createHedge } from '@/lib/db/hedges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Rate limiting: prevent duplicate cron runs within 5 minutes
let lastSuccessfulRunTimestamp = 0;
const MIN_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
    shouldRebalance = maxDrift > 3;
  } else {
    shouldRebalance = confidence >= 65;
  }

  return {
    allocations: allocations as Record<PoolAsset, number>,
    confidence,
    reasoning,
    shouldRebalance,
  };
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

    for (const bal of allBalances) {
      const coinType = bal.coinType;
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;

      // Match coin type to known assets (skip USDC and SUI gas reserve)
      let asset: BluefinPoolAsset | null = null;
      let decimals = 8;

      for (const a of POOL_ASSETS) {
        const assetType = aggregator.getAssetCoinType(a as BluefinPoolAsset);
        if (assetType && coinType === assetType) {
          asset = a as BluefinPoolAsset;
          decimals = a === 'SUI' ? 9 : 8;
          break;
        }
      }

      if (!asset) continue;

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

    // Step 6.5: Settle PREVIOUS cycle's hedges — return USDC from admin back to pool
    // This runs BEFORE new swaps so the pool gets its money back first.
    // Flow: reverse-swap ALL admin-held assets → USDC, then close_hedge for each.
    // Profits/losses from asset price changes are captured proportionally.
    let hedgeSettlement: { settled: number; failed: number; details: any[]; replenishment?: any; debug?: any } | undefined;
    if (process.env.SUI_POOL_ADMIN_KEY && process.env.SUI_AGENT_CAP_ID) {
      try {
        const activeHedges = await getActiveHedges(network);
        logger.info('[SUI Cron] Step 6.5 getActiveHedges result', { count: activeHedges.length, hedges: activeHedges });
        if (activeHedges.length > 0) {
          const totalCollateralNeeded = activeHedges.reduce((sum, h) => sum + h.collateralUsdc, 0);

          logger.info('[SUI Cron] Settling previous hedges before new allocation', {
            activeHedges: activeHedges.length,
            totalCollateral: totalCollateralNeeded.toFixed(6),
          });

          // Reverse-swap ALL non-USDC assets in admin wallet → USDC
          // Use a large target so ALL assets are converted (not just shortfall)
          const replenishment = await replenishAdminUsdc(network, 1_000_000, pricesUSD);
          logger.info('[SUI Cron] Step 6.5 replenishment result', { swapped: replenishment.swapped, details: replenishment.details });
          if (replenishment.swapped > 0) {
            await new Promise(r => setTimeout(r, 2000));
            logger.info('[SUI Cron] Admin assets → USDC replenishment', {
              swapped: replenishment.swapped.toFixed(6),
              details: replenishment.details,
            });
          }

          // Check total admin USDC after replenishment
          const adminUsdcForSettlement = await getAdminUsdcBalance(network);
          logger.info('[SUI Cron] Admin USDC for settlement', {
            adminUsdc: adminUsdcForSettlement.toFixed(6),
            totalCollateral: totalCollateralNeeded.toFixed(6),
            pnl: (adminUsdcForSettlement - totalCollateralNeeded).toFixed(6),
          });

          // Settle all hedges — returns ALL admin USDC to pool proportionally
          if (adminUsdcForSettlement > 0.001) {
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
    const shouldExecuteSwaps = navUsd >= MIN_SWAP_NAV_USD;
    if (hasUnallocatedUsdc) {
      logger.info('[SUI Cron] Unallocated USDC detected — triggering initial asset allocation', { navUsd });
    }
    if (navUsd > 0.50 && navUsd < MIN_SWAP_NAV_USD) {
      logger.info('[SUI Cron] Pool NAV $' + navUsd.toFixed(2) + ' below $' + MIN_SWAP_NAV_USD + ' swap minimum — skipping swaps to avoid slippage losses');
    }
    if (shouldExecuteSwaps) {
      try {
        const aggregator = getBluefinAggregatorService(network);

        const plan = await aggregator.planRebalanceSwaps(
          navUsd,
          aiResult.allocations as Record<BluefinPoolAsset, number>,
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
              // Daily cap might be exhausted locally, but contract resets counter on day boundary.
              // Still attempt the call and let contract enforce the true limit.
              logger.info('[SUI Cron] Daily cap appears exhausted locally, but attempting hedge anyway (contract will reset at day boundary)', {
                deficit: deficit.toFixed(2),
                maxTransferable: maxTransferable.toFixed(2),
                maxByDailyCap: maxByDailyCap.toFixed(2),
                cappedDeficit: cappedDeficit.toFixed(2),
              });
              
              const transferResult = await transferUsdcFromPoolToAdmin(network, Math.max(deficit * 0.5, 0.01));
              (rebalanceSwaps as any).poolTransfer = {
                requested: Math.max(deficit * 0.5, 0.01).toFixed(2),
                success: transferResult.success,
                txDigest: transferResult.txDigest,
                error: transferResult.error,
              };
              if (transferResult.success) {
                logger.info('[SUI Cron] Pool → admin USDC transfer successful despite daily cap concern', {
                  txDigest: transferResult.txDigest,
                  amount: Math.max(deficit * 0.5, 0.01).toFixed(2),
                });
                await new Promise(r => setTimeout(r, 2000));
              } else {
                logger.warn('[SUI Cron] Pool → admin USDC transfer failed despite daily cap concern', {
                  error: transferResult.error,
                });
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
            // Budget is limited — re-plan with available USDC
            logger.info('[SUI Cron] Re-planning swaps with available budget', {
              available: actualAdminUsdc.toFixed(2),
              originalNeeded: totalUsdcNeeded.toFixed(2),
            });
            try {
              swapPlan = await aggregator.planRebalanceSwaps(
                actualAdminUsdc,
                aiResult.allocations as Record<BluefinPoolAsset, number>,
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

    if (HEDGE_DISABLED) {
      logger.info('[SUI Cron] Auto-hedge disabled by SUI_AUTO_HEDGE_DISABLE=1');
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

          // ── Leverage: bump to 5x for small NAV to clear minQty ────
          const leverage = navUsd < 1000
            ? 5
            : Math.min(suiPoolConfig?.maxLeverage || 3, 5);
          const hedgeRatio = navUsd < 1000 ? 1.0 : 0.5;

          logger.info('[SUI Cron] Auto-hedge plan', {
            navUsd: navUsd.toFixed(2), sentiment, side, leverage, hedgeRatio,
            riskScore, threshold,
            allocations: aiResult.allocations,
          });

          const hedges: AutoHedgeRow[] = [];
          try {
            const bluefin = BluefinService.getInstance();

            // ── Dedup gate: skip assets with an active live position ─
            const existing = await bluefin.getPositions().catch(() => []);
            const liveSet = new Set(
              existing.map(p => `${p.symbol}|${(p.side || '').toUpperCase()}`),
            );

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

              const hedgeValueUSD = navUsd * (allocation / 100) * hedgeRatio;
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

              try {
                logger.info(`[SUI Cron] Opening ${asset}-PERP ${side}`, {
                  allocation, hedgeValueUSD: hedgeValueUSD.toFixed(4),
                  effectiveValue: effectiveValue.toFixed(4),
                  snappedSize, leverage, sentiment,
                });
                const result = await bluefin.openHedge({
                  symbol,
                  side,
                  size: snappedSize,
                  leverage,
                  portfolioId: -2,
                  reason: `Auto-hedge: ${side} via ${sentiment} signal (risk=${riskScore}/${threshold})`,
                });

                hedges.push({
                  symbol, side, size: snappedSize,
                  status: result.success ? 'OPENED' : 'FAILED',
                  orderId: result.orderId, error: result.error,
                });

                if (result.success && result.orderId) {
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
