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
import { bluefinTreasury } from '@/lib/services/sui/BluefinTreasuryService';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID, isSuiCommunityPool } from '@/lib/constants';
import { createHedge } from '@/lib/db/hedges';
import {
  safeLeverage,
  buildDecisionToken,
} from '@/lib/services/hedging/calibration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Rate limiting: prevent duplicate cron runs within 5 minutes
let lastSuccessfulRunTimestamp = 0;
const MIN_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── Hedge decision idempotency (5-min sliding window per {asset, side, risk-bucket}) ──
// Prevents duplicate Bluefin orders if cron clock skews and fires twice in
// the same risk window. Cleared on process restart (Vercel cold start).
const recentHedgeTokens: Map<string, number> = new Map();
const HEDGE_TOKEN_TTL_MS = 5 * 60 * 1000;

// Slippage tolerance for market orders. Anything beyond this between
// the price we sized against and Bluefin's last trade abort the order.
const HEDGE_MAX_SLIPPAGE_PCT = 0.5; // 0.5%

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
  /** Operator wallet gas state — surfaced so the UI can warn users when low */
  operatorGas?: {
    address?: string;
    suiBalance: string;
    gasFloorSui: number;
    sufficient: boolean;
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
 * Minimum USDC value for a meaningful on-chain hedge.
 * Below this, every close emits a deceptive sub-cent "profit" event due to
 * rounding / DEX dust, which clogs the Sui explorer and inflates win-rate stats.
 * Override with HEDGE_MIN_OPEN_USDC env var (decimal USD).
 */
const HEDGE_MIN_OPEN_USDC = Math.max(
  0.10,
  Number(process.env.HEDGE_MIN_OPEN_USDC) || 0.10,
);

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

    // Normalize SUI coin type strings for comparison (RPC may return different
    // address case/padding than our static config).
    const normalizeCoinType = (t: string): string => {
      const parts = t.split('::');
      if (parts.length !== 3) return t.toLowerCase();
      const addr = parts[0].toLowerCase().replace(/^0x/, '').replace(/^0+/, '') || '0';
      return `0x${addr}::${parts[1]}::${parts[2]}`;
    };

    const balanceDebug: Array<{ coinType: string; raw: string; matched?: string }> = [];

    for (const bal of allBalances) {
      const coinType = bal.coinType;
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;

      // Match coin type to known assets (skip USDC and SUI gas reserve)
      let asset: BluefinPoolAsset | null = null;
      let decimals = 8;

      const normBal = normalizeCoinType(coinType);
      for (const a of POOL_ASSETS) {
        const assetType = aggregator.getAssetCoinType(a as BluefinPoolAsset);
        if (assetType && normalizeCoinType(assetType) === normBal) {
          asset = a as BluefinPoolAsset;
          decimals = a === 'SUI' ? 9 : 8;
          break;
        }
      }

      balanceDebug.push({ coinType, raw: bal.totalBalance, matched: asset || undefined });

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
      allBalances: balanceDebug,
    });

    // Swap from each asset until shortfall is covered
    for (const c of candidates) {
      if (remainingShortfall <= 0.01) break; // Done

      // Calculate how much of this asset to swap (with 5% buffer for slippage)
      const usdcTarget = Math.min(remainingShortfall * 1.05, c.valueUsd);
      // Lower floor to $0.05 so tiny orphaned dust can still be cleared.
      // Anything smaller than that can't beat gas anyway.
      if (usdcTarget < 0.05) continue;

      const price = pricesUSD[c.asset] || 0;
      if (price <= 0) continue;

      const assetAmountToSwap = Math.min(c.amount, usdcTarget / price);
      if (assetAmountToSwap <= 0) continue;

      logger.info(`[SUI Cron] Reverse swap ${c.asset} → USDC`, {
        assetAmount: assetAmountToSwap.toFixed(8),
        targetUsdc: usdcTarget.toFixed(4),
        remainingShortfall: remainingShortfall.toFixed(4),
      });

      // Try with progressively higher slippage tolerance — small/illiquid positions
      // (e.g. residual wBTC dust) often need wider slippage to clear.
      // Tightened from [2%, 5%, 10%] → [0.5%, 1%, 2%] for near-zero loss on swap legs.
      // If even 2% won't clear, hold the asset (better than realising 10% loss).
      // Override via HEDGE_REVERSE_SWAP_LADDER="0.005,0.01,0.02".
      const slippageLadder = (process.env.HEDGE_REVERSE_SWAP_LADDER || '0.005,0.01,0.02')
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n) && n > 0 && n <= 0.10);
      let cleared = false;

      for (const slippage of slippageLadder) {
        try {
          const reverseQuote = await aggregator.getReverseSwapQuote(c.asset, assetAmountToSwap);

          if (!reverseQuote.canSwapOnChain || !reverseQuote.routerData) {
            logger.warn(`[SUI Cron] ${c.asset} → USDC not swappable on-chain, skipping`);
            details.push({ asset: c.asset, amountSwapped: 0, error: 'No on-chain route' });
            cleared = true; // Don't retry — no route exists
            break;
          }

          const swapResult = await aggregator.executeSwap(reverseQuote, slippage);
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
              slippageUsed: slippage,
            });
            await new Promise(r => setTimeout(r, 2500));
            cleared = true;
            break;
          }

          // Failed at this slippage — retry with wider slippage if more tolerance left
          const errMsg = swapResult.error || 'unknown';
          const isSlippageError = /slippage|deviation|amount.?out/i.test(errMsg);
          if (!isSlippageError) {
            // Non-slippage error (e.g. gas, RPC) — don't retry
            details.push({ asset: c.asset, amountSwapped: 0, error: errMsg });
            logger.warn(`[SUI Cron] ${c.asset} → USDC swap failed (non-slippage)`, { error: errMsg });
            cleared = true;
            break;
          }
          logger.warn(`[SUI Cron] ${c.asset} → USDC slippage at ${(slippage * 100).toFixed(0)}% — retrying`, { error: errMsg });
        } catch (swapErr) {
          const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
          // If it's a clearly transient error, allow retry; otherwise bail
          if (!/slippage|deviation|amount.?out/i.test(msg)) {
            details.push({ asset: c.asset, amountSwapped: 0, error: msg });
            logger.warn(`[SUI Cron] Reverse swap ${c.asset} threw fatal error`, { error: msg });
            cleared = true;
            break;
          }
          logger.warn(`[SUI Cron] ${c.asset} threw at slippage ${(slippage * 100).toFixed(0)}% — retrying`, { error: msg });
        }
      }

      if (!cleared) {
        details.push({ asset: c.asset, amountSwapped: 0, error: `Failed after ${slippageLadder.length} slippage retries (up to ${slippageLadder[slippageLadder.length - 1] * 100}%)` });
        logger.warn(`[SUI Cron] ${c.asset} → USDC exhausted slippage ladder`);
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

  // Refuse to open dust hedges. They produce noise on the explorer and
  // distort the apparent win-rate without ever moving meaningful capital.
  if (amountUsdc < HEDGE_MIN_OPEN_USDC) {
    return {
      success: false,
      error: `amount $${amountUsdc.toFixed(6)} below HEDGE_MIN_OPEN_USDC=$${HEDGE_MIN_OPEN_USDC.toFixed(2)} — refusing dust open_hedge`,
    };
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

      // Pull live 5-min Polymarket signal (high-accuracy crowd-sourced BTC direction).
      // Strong directional signals from prediction markets justify acting even on small drift.
      let fiveMinSignal: { direction: 'UP' | 'DOWN'; confidence: number; signalStrength: 'STRONG' | 'MODERATE' | 'WEAK' } | null = null;
      try {
        const { Polymarket5MinService } = await import('@/lib/services/market-data/Polymarket5MinService');
        const sig = await Polymarket5MinService.getLatest5MinSignal();
        if (sig) {
          fiveMinSignal = { direction: sig.direction, confidence: sig.confidence, signalStrength: sig.signalStrength };
          logger.info('[SUI Cron] Polymarket 5-min signal', fiveMinSignal);

          // ═══ Track signal + resolve any expired prior signals ═══
          // Records ground truth so we can compute true win-rate over time.
          // Disable with HEDGE_TRACK_SIGNAL_OUTCOMES=false.
          if ((process.env.HEDGE_TRACK_SIGNAL_OUTCOMES || 'true').toLowerCase() !== 'false') {
            try {
              const { trackSignalAndResolve } = await import('@/lib/db/signal-outcomes');
              const probabilityFraction = sig.direction === 'UP'
                ? (sig.upProbability ?? sig.probability) / 100
                : (sig.downProbability ?? sig.probability) / 100;
              await trackSignalAndResolve({
                source: 'polymarket-5min',
                marketId: (sig as unknown as { marketId?: string }).marketId,
                windowEndTime: sig.windowEndTime,
                direction: sig.direction,
                probability: probabilityFraction,
                confidence: sig.confidence,
                signalStrength: sig.signalStrength,
                volume: (sig as unknown as { volume?: number }).volume,
                liquidity: (sig as unknown as { liquidity?: number }).liquidity,
                entryPrice: pricesUSD['BTC'] || 0,
              });
            } catch (trackErr) {
              logger.warn('[SUI Cron] signal-outcome tracking failed (non-critical)', {
                error: trackErr instanceof Error ? trackErr.message : String(trackErr),
              });
            }
          }
        }
      } catch (sigErr) {
        logger.warn('[SUI Cron] 5-min signal fetch failed (non-critical)', { error: sigErr });
      }

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
      // Never open long positions in bearish markets — hold USDC instead to stop losses.
      // Only buy assets when sentiment is neutral or better AND confidence is high enough.
      const sentimentStr = String(enhanced.marketSentiment).toUpperCase();
      let isBearish = sentimentStr === 'BEARISH' || sentimentStr === 'VERY_BEARISH';

      // Polymarket 5-min signal override: a STRONG crowd-sourced signal (>90% historical
      // resolution accuracy via Chainlink) can flip our gate.
      //   STRONG UP   + high confidence → force action even in bearish sentiment (catch reversals)
      //   STRONG DOWN + high confidence → force defensive (treat as bearish even if sentiment was neutral)
      let strongSignalOverride = false;
      if (fiveMinSignal && fiveMinSignal.signalStrength === 'STRONG' && fiveMinSignal.confidence >= 70) {
        if (fiveMinSignal.direction === 'DOWN') {
          isBearish = true; // Force defensive
          logger.info('[SUI Cron] Strong DOWN signal — forcing defensive (USDC) posture', fiveMinSignal);
        } else if (fiveMinSignal.direction === 'UP') {
          // Strong UP overrides bearish gate so we don't miss reversals
          isBearish = false;
          strongSignalOverride = true;
          logger.info('[SUI Cron] Strong UP signal — overriding bearish gate to allow long entries', fiveMinSignal);
        }
      }

      const confidenceThreshold = isBearish ? 85 : 70; // stricter gate in downtrends
      // Standardised drift threshold (env-driven, single source of truth).
      // Default 5% — tighter values cause excessive friction on small pools.
      const driftThresholdPct = Number(process.env.HEDGE_REBALANCE_DRIFT_PCT || 5);
      aiResult.shouldRebalance = !isBearish && (
        maxDrift > driftThresholdPct ||
        enhanced.confidence >= confidenceThreshold ||
        enhanced.urgency === 'HIGH' ||
        enhanced.urgency === 'CRITICAL' ||
        strongSignalOverride
      );

      // ═══════════════════════════════════════════════════════════════════
      // COST-BENEFIT GATE — refuse to rebalance when expected swap cost
      // exceeds expected alpha. Each rebalance touches ~25% of NAV across
      // 2 swap legs; conservative cost = 2 × (slippage 0.1% + gas 0.05%) ≈ 0.30%
      // of swapped notional. Only proceed if drift is large enough that
      // realigning is worth that cost (heuristic: drift × confidence ≥ cost%).
      // ═══════════════════════════════════════════════════════════════════
      if (aiResult.shouldRebalance) {
        const expectedSwapCostPct = Number(process.env.HEDGE_REBALANCE_COST_PCT || 0.3);
        const expectedAlphaPct = (maxDrift / 100) * (enhanced.confidence / 100) * 100;
        if (expectedAlphaPct < expectedSwapCostPct &&
            enhanced.urgency !== 'CRITICAL' &&
            !strongSignalOverride) {
          logger.warn('[SUI Cron] Cost-benefit gate — rebalance suppressed', {
            maxDrift: maxDrift.toFixed(2),
            confidence: enhanced.confidence,
            expectedAlphaPct: expectedAlphaPct.toFixed(3),
            expectedSwapCostPct,
          });
          aiResult.shouldRebalance = false;
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // DRAWDOWN BRAKE — if share price has fallen below par by more than
      // HEDGE_MAX_DRAWDOWN_PCT (default 1%), halt all NEW rebalance swaps
      // and let the hedge logic protect remaining capital. Existing positions
      // still close on next cycle. This enforces "near 0 loss" by refusing
      // to chase prices on declining markets.
      // ═══════════════════════════════════════════════════════════════════
      const _sharePriceUsdEarly = poolStats.sharePriceUsd || (poolStats.sharePrice * (pricesUSD['SUI'] || 0));
      const drawdownPct = _sharePriceUsdEarly > 0 ? Math.max(0, (1 - _sharePriceUsdEarly) * 100) : 0;
      const maxDrawdownPct = Number(process.env.HEDGE_MAX_DRAWDOWN_PCT || 1);
      if (drawdownPct >= maxDrawdownPct) {
        if (aiResult.shouldRebalance) {
          logger.warn('[SUI Cron] Drawdown brake engaged — disabling rebalance swaps', {
            sharePriceUsd: _sharePriceUsdEarly.toFixed(4),
            drawdownPct: drawdownPct.toFixed(2),
            maxDrawdownPct,
          });
        }
        aiResult.shouldRebalance = false;
      }

      // Also short-circuit if KILL_SWITCH is set — no new buys, period.
      const killActive = (process.env.KILL_SWITCH || process.env.TRADING_KILL_SWITCH || '').toLowerCase().trim();
      if (['true','1','on','yes','disable','halt'].includes(killActive)) {
        if (aiResult.shouldRebalance) {
          logger.warn('[SUI Cron] KILL_SWITCH active — disabling rebalance swaps');
        }
        aiResult.shouldRebalance = false;
      }

      // ═══════════════════════════════════════════════════════════════════
      // DAILY-LOSS CIRCUIT BREAKER — auto-halt new swaps + new hedges if
      // realized losses + funding paid in the last 24h exceed the cap
      // (env HEDGE_DAILY_LOSS_CAP_USD, default $5). Existing positions
      // continue to settle normally; only new entries are blocked.
      // ═══════════════════════════════════════════════════════════════════
      let dailyLossHalted = false;
      try {
        const { getRealizedPnlSince } = await import('@/lib/db/hedges');
        const last24h = await getRealizedPnlSince(Date.now() - 24 * 60 * 60 * 1000);
        const dailyLossCap = Number(process.env.HEDGE_DAILY_LOSS_CAP_USD || 5);
        if (last24h.netPnl < -Math.abs(dailyLossCap)) {
          dailyLossHalted = true;
          logger.error('[SUI Cron] Daily-loss circuit breaker TRIPPED', {
            netPnl24h: last24h.netPnl.toFixed(2),
            realized: last24h.realized.toFixed(2),
            fundingPaid: last24h.fundingPaid.toFixed(2),
            closedHedges: last24h.count,
            cap: dailyLossCap,
          });
          if (aiResult.shouldRebalance) {
            aiResult.shouldRebalance = false;
          }
        } else if (last24h.count >= 5) {
          logger.info('[SUI Cron] Daily PnL window', {
            netPnl24h: last24h.netPnl.toFixed(2),
            realized: last24h.realized.toFixed(2),
            fundingPaid: last24h.fundingPaid.toFixed(2),
            closedHedges: last24h.count,
            cap: dailyLossCap,
          });
        }
      } catch (lossErr) {
        logger.warn('[SUI Cron] daily-loss check failed (non-critical)', {
          error: lossErr instanceof Error ? lossErr.message : String(lossErr),
        });
      }
      // Stash for hedge-block to consult.
      (globalThis as Record<string, unknown>).__suiDailyLossHalted = dailyLossHalted;

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
    let hedgeSettlement: { settled: number; failed: number; details: any[]; replenishment?: any; debug?: any; skipped?: string } | undefined;

    // Gas pre-check — abort the whole settle/swap path if operator gas is low.
    // Each cycle needs ~0.1 SUI for open_hedge + swaps + close_hedge. If we
    // start a cycle and run out mid-way, we leave orphaned admin-side coins
    // that can't be returned. Better to skip the cycle and emit a clear log.
    let gasCheckPassed = true;
    let gasStatus: { suiBalance: string; gasFloorSui: number; address?: string } | null = null;
    if (process.env.SUI_POOL_ADMIN_KEY && process.env.SUI_AGENT_CAP_ID) {
      try {
        const aggregator = getBluefinAggregatorService(network);
        const wallet = await aggregator.checkAdminWallet();
        gasStatus = {
          suiBalance: wallet.suiBalance || '0',
          gasFloorSui: wallet.gasFloorSui || 0.1,
          address: wallet.address,
        };
        if (!wallet.hasGas) {
          gasCheckPassed = false;
          logger.warn('[SUI Cron] Gas pre-check FAILED — operator wallet has insufficient SUI for a full cycle', {
            suiBalance: wallet.suiBalance,
            floor: wallet.gasFloorSui,
            address: wallet.address,
            action: 'Skipping settle + swap steps. Top up the operator wallet with SUI to resume trading.',
          });
          hedgeSettlement = {
            settled: 0,
            failed: 0,
            details: [],
            skipped: `Operator wallet has ${wallet.suiBalance} SUI, below ${wallet.gasFloorSui} SUI floor. Top up to resume.`,
          };
        }
      } catch (gasErr) {
        logger.warn('[SUI Cron] Gas pre-check threw — proceeding cautiously', { error: gasErr });
      }
    }

    if (gasCheckPassed && process.env.SUI_POOL_ADMIN_KEY && process.env.SUI_AGENT_CAP_ID) {
      try {
        const activeHedges = await getActiveHedges(network);
        logger.info('[SUI Cron] Step 6.5 getActiveHedges result', { count: activeHedges.length, hedges: activeHedges });

        // Step 6.4: Close orphaned dust hedges (collateral < $0.01 USDC).
        // These are leftover from interrupted prior cycles or from cron
        // attempts when gas ran out mid-way. They serve no risk-management
        // purpose, are filtered out of the user-facing UI, and clog the
        // on-chain active_hedges vector. Close them aggressively.
        // Match HEDGE_MIN_OPEN_USDC so any hedge below that floor is treated
        // as orphan dust and force-closed (no PnL emitted).
        const ORPHAN_DUST_FLOOR_USDC = HEDGE_MIN_OPEN_USDC;
        const dustHedges = activeHedges.filter(h => h.collateralUsdc > 0 && h.collateralUsdc < ORPHAN_DUST_FLOOR_USDC);
        if (dustHedges.length > 0) {
          logger.info('[SUI Cron] Closing orphaned dust hedges', {
            count: dustHedges.length,
            totalValue: dustHedges.reduce((s, h) => s + h.collateralUsdc, 0).toFixed(8),
          });
          for (const dust of dustHedges) {
            try {
              // returnUsdcToPool calls close_hedge for one hedge id with the
              // exact collateral amount (no PnL — these are sub-cent).
              const r = await returnUsdcToPool(network, dust.hedgeId, dust.collateralUsdc, 0, false);
              logger.info('[SUI Cron] Dust hedge close', {
                amount: dust.collateralUsdc,
                ok: r.success,
                tx: r.txDigest,
                err: r.error,
              });
            } catch (dustErr) {
              logger.warn('[SUI Cron] Dust hedge close threw (non-fatal)', { error: dustErr });
            }
            // Tiny pause between closures to avoid RPC rate limits
            await new Promise(r => setTimeout(r, 500));
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // BOUNDED REPLENISH — convert only what's actually needed.
        //  • If active hedges exist, target = totalCollateralNeeded × 1.10
        //  • If none, only clear dust (per-asset value ≤ HEDGE_REPLENISH_DUST_USD,
        //    default $10) so larger holdings can wait for price recovery
        //    rather than be force-converted at a loss.
        // Override the cap entirely with HEDGE_REPLENISH_FORCE_FULL=true.
        // ═══════════════════════════════════════════════════════════════
        const totalCollateralNeededPre = activeHedges.reduce((sum, h) => sum + h.collateralUsdc, 0);
        const forceFull = (process.env.HEDGE_REPLENISH_FORCE_FULL || 'false').toLowerCase() === 'true';
        const replenishTarget = forceFull
          ? 1_000_000
          : (activeHedges.length > 0
              ? totalCollateralNeededPre * 1.10
              : Number(process.env.HEDGE_REPLENISH_DUST_USD || 10));
        const replenishment = await replenishAdminUsdc(network, replenishTarget, pricesUSD);
        logger.info('[SUI Cron] Step 6.5 replenishment result', {
          swapped: replenishment.swapped,
          target: replenishTarget,
          activeHedges: activeHedges.length,
          forceFull,
          details: replenishment.details,
        });
        if (replenishment.swapped > 0) {
          await new Promise(r => setTimeout(r, 2000));
          logger.info('[SUI Cron] Admin assets → USDC replenishment', {
            swapped: replenishment.swapped.toFixed(6),
            details: replenishment.details,
          });
        }

        if (activeHedges.length > 0) {
          const totalCollateralNeeded = activeHedges.reduce((sum, h) => sum + h.collateralUsdc, 0);

          logger.info('[SUI Cron] Settling previous hedges before new allocation', {
            activeHedges: activeHedges.length,
            totalCollateral: totalCollateralNeeded.toFixed(6),
          });

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
          // No open hedges on-chain, but admin may hold orphaned USDC from a prior replenishment.
          // Use a mini hedge roundtrip to officially return these funds to the pool:
          //   open_hedge($0.01 from pool) → get hedge_id → close_hedge(full admin balance) → pool gets it all
          const adminUsdcAfter = await getAdminUsdcBalance(network);
          if (adminUsdcAfter > 1.0) {
            logger.info('[SUI Cron] Orphaned USDC in admin wallet — recovering to pool via mini-hedge', {
              adminUsdc: adminUsdcAfter.toFixed(6),
              replenished: replenishment.swapped.toFixed(6),
            });
            try {
              const MICRO_HEDGE = HEDGE_MIN_OPEN_USDC; // honour dust floor
              const openResult = await transferUsdcFromPoolToAdmin(network, MICRO_HEDGE);
              if (openResult.success) {
                await new Promise(r => setTimeout(r, 3000));
                const freshHedges = await getActiveHedges(network);
                if (freshHedges.length > 0) {
                  const hedge = freshHedges[0];
                  const totalAdminUsdc = await getAdminUsdcBalance(network);
                  const pnl = Math.max(0, totalAdminUsdc - MICRO_HEDGE);
                  const returnResult = await returnUsdcToPool(network, hedge.hedgeId, totalAdminUsdc, pnl, pnl > 0);
                  if (returnResult.success) {
                    logger.info('[SUI Cron] Orphaned USDC successfully returned to pool', {
                      returned: totalAdminUsdc.toFixed(6), pnl: pnl.toFixed(6), txDigest: returnResult.txDigest,
                    });
                    hedgeSettlement = { settled: 1, failed: 0, details: [{ returned: totalAdminUsdc, pnl }], replenishment };
                  } else {
                    logger.warn('[SUI Cron] Mini-hedge close failed', { error: returnResult.error });
                    hedgeSettlement = { settled: 0, failed: 1, details: [], replenishment, debug: { closeError: returnResult.error } };
                  }
                } else {
                  logger.warn('[SUI Cron] Mini-hedge opened but no hedge found on-chain');
                  hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { activeHedgesFound: 0, adminUsdcAfter } };
                }
              } else {
                logger.warn('[SUI Cron] Mini-hedge open failed — admin USDC stays for next cycle', { error: openResult.error });
                hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { openError: openResult.error, adminUsdcAfter } };
              }
            } catch (recoveryErr) {
              logger.warn('[SUI Cron] Orphaned USDC recovery threw', { error: recoveryErr });
              hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { recoveryError: String(recoveryErr), adminUsdcAfter } };
            }
          } else {
            logger.info('[SUI Cron] No orphaned USDC to recover', { adminUsdc: adminUsdcAfter.toFixed(6) });
            hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { activeHedgesFound: 0, adminUsdcAfter } };
          }
        }
      } catch (settleErr) {
        const errMsg = settleErr instanceof Error ? settleErr.message : String(settleErr);
        logger.warn('[SUI Cron] Pre-swap hedge settlement failed (non-critical)', { error: settleErr });
        hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { error: errMsg } };
      }
    } else {
      hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { envMissing: { adminKey: !process.env.SUI_POOL_ADMIN_KEY, agentCap: !process.env.SUI_AGENT_CAP_ID } } };
    }

    // ═══════════════════════════════════════════════════════════════════
    // POSITION-AGE TIMEOUT — force-close any active BlueFin perp hedge
    // older than HEDGE_MAX_AGE_HOURS (default 8). This prevents naked
    // shorts from accumulating funding cost across cycles when the
    // signal that opened them is no longer fresh.
    // ═══════════════════════════════════════════════════════════════════
    let stalePositionCloses = 0;
    try {
      const maxAgeHours = Number(process.env.HEDGE_MAX_AGE_HOURS || 8);
      if (maxAgeHours > 0) {
        const { getStaleActiveHedges } = await import('@/lib/db/hedges');
        const stale = await getStaleActiveHedges(maxAgeHours * 60 * 60 * 1000);
        if (stale.length > 0) {
          logger.warn('[SUI Cron] Stale active perps detected — force-closing', {
            count: stale.length,
            maxAgeHours,
            positions: stale.map(s => ({
              market: s.market,
              side: s.side,
              ageH: (s.ageMs / 3600000).toFixed(1),
            })),
          });
          const { BluefinService } = await import('@/lib/services/sui/BluefinService');
          const bf = BluefinService.getInstance();
          // Deduplicate by market — closeHedge closes the entire position for that symbol.
          const seen = new Set<string>();
          for (const s of stale) {
            if (seen.has(s.market)) continue;
            seen.add(s.market);
            try {
              const closed = await bf.closeHedge({
                symbol: s.market,
              });
              if (closed?.success) {
                stalePositionCloses++;
                logger.info('[SUI Cron] Stale perp force-closed', {
                  market: s.market,
                  side: s.side,
                  ageH: (s.ageMs / 3600000).toFixed(1),
                });
              } else {
                logger.warn('[SUI Cron] Stale perp close failed', {
                  market: s.market,
                  side: s.side,
                  error: closed?.error,
                });
              }
            } catch (closeErr) {
              logger.warn('[SUI Cron] Stale perp close threw (non-critical)', {
                market: s.market,
                error: closeErr instanceof Error ? closeErr.message : String(closeErr),
              });
            }
          }
        }
      }
    } catch (staleErr) {
      logger.warn('[SUI Cron] position-age timeout failed (non-critical)', {
        error: staleErr instanceof Error ? staleErr.message : String(staleErr),
      });
    }

    // Step 7: Plan + Execute rebalance via SuiPoolAgent
    // Trigger swaps when:
    //  a) AI detects allocation drift and recommends rebalancing, OR
    //  b) Pool has USDC that hasn't been converted to assets yet (first allocation)
    //     If all previous DB-stored allocations are 0, it's the first run and all USDC
    //     needs to be swapped/hedged into assets. Also force rebalance when the pool has
    //     never had successful swaps (no DB swap records).
    let rebalanceSwaps: SuiCronResult['rebalanceSwaps'] = undefined;
    const hasUnallocatedUsdc = navUsd > 30 && (
      currentAllocations.BTC === 0 &&
      currentAllocations.ETH === 0 &&
      currentAllocations.SUI === 0
    );
    // Minimum pool NAV to execute swaps.
    // At $30 each swap gets ~$10 per asset (acceptable DEX pricing on SUI mainnet).
    // Below $30 the per-asset amounts are too small — fee drag exceeds any realistic gain.
    // When bearish the shouldRebalance gate (above) will block new buys anyway.
    const MIN_SWAP_NAV_USD = 30;
    // Per-asset minimum: skip any single swap below $8 to avoid high-fee micro-routes.
    const MIN_PER_ASSET_SWAP_USD = 8;
    const shouldExecuteSwaps = navUsd >= MIN_SWAP_NAV_USD && gasCheckPassed;
    if (hasUnallocatedUsdc) {
      logger.info('[SUI Cron] Unallocated USDC detected — triggering initial asset allocation', { navUsd });
    }
    if (navUsd > 0.50 && navUsd < MIN_SWAP_NAV_USD) {
      logger.info('[SUI Cron] Pool NAV $' + navUsd.toFixed(2) + ' below $' + MIN_SWAP_NAV_USD + ' swap minimum — skipping swaps to avoid slippage losses');
    }
    if (!gasCheckPassed) {
      logger.warn('[SUI Cron] Skipping swap execution — gas pre-check failed earlier', gasStatus || {});
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
            // Read max_hedge_ratio_bps from on-chain auto_hedge_config (DO NOT hardcode — admin may change it).
            // Default to 2500 bps (25%) which matches contract initialization.
            let maxHedgeRatioBps = 2500;
            // DAILY_HEDGE_CAP_BPS is a hardcoded constant in the Move contract.
            const DAILY_HEDGE_CAP_BPS_CONST = 5000; // 50% — must match Move const DAILY_HEDGE_CAP_BPS
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

                  // Read daily hedge counter & on-chain max_hedge_ratio_bps
                  const hedgeState = fields.hedge_state?.fields;
                  if (hedgeState) {
                    const currentDay = Math.floor(Date.now() / 86400000);
                    const onChainDay = Number(hedgeState.current_hedge_day || 0);
                    if (onChainDay === currentDay) {
                      dailyHedgedToday = Number(hedgeState.daily_hedge_total || 0) / 1e6;
                    }
                    const cfgBps = Number(
                      hedgeState.auto_hedge_config?.fields?.max_hedge_ratio_bps ?? 0,
                    );
                    if (cfgBps > 0 && cfgBps <= 5000) {
                      maxHedgeRatioBps = cfgBps;
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
            // Use on-chain max_hedge_ratio_bps (default 2500 = 25%). Admin may tune this.
            const maxHedgeTotal = contractNav * (maxHedgeRatioBps / 10000);
            const maxByHedgeRatio = Math.max(0, maxHedgeTotal - existingHedgedValue);
            const maxByReserve = contractBalance * 0.8;     // 20% reserve must stay in pool

            // Daily cap: DAILY_HEDGE_CAP_BPS (50%) of NAV minus what's already been hedged today
            // NOTE: contract resets daily_hedge_total at day boundary when open_hedge is called.
            const maxByDailyCap = Math.max(
              0,
              contractNav * (DAILY_HEDGE_CAP_BPS_CONST / 10000) - dailyHedgedToday,
            );

            const maxTransferable = Math.min(maxByHedgeRatio, maxByReserve, maxByDailyCap);
            // Use a tighter 5% safety margin and floor at 6 decimal precision.
            const cappedDeficit = Math.min(deficit, maxTransferable * 0.95);

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
            } else if (maxTransferable <= 0 || cappedDeficit < HEDGE_MIN_OPEN_USDC) {
              // Daily cap might be exhausted locally, but contract resets counter on day boundary.
              // Still attempt a SAFE transfer using on-chain max ratio (NOT a 50%-of-deficit guess).
              const safeAttempt = Math.min(
                deficit,
                Math.max(maxByHedgeRatio, 0) * 0.95,
                Math.max(maxByReserve, 0) * 0.95,
              );
              logger.info('[SUI Cron] Daily cap appears exhausted locally, attempting safe hedge (capped to on-chain max_hedge_ratio_bps)', {
                deficit: deficit.toFixed(2),
                maxTransferable: maxTransferable.toFixed(2),
                maxByDailyCap: maxByDailyCap.toFixed(2),
                maxHedgeRatioBps,
                safeAttempt: safeAttempt.toFixed(6),
              });

              if (safeAttempt < HEDGE_MIN_OPEN_USDC) {
                logger.warn('[SUI Cron] Skipping pool transfer — safe amount below dust floor', {
                  maxByHedgeRatio: maxByHedgeRatio.toFixed(6),
                  maxByReserve: maxByReserve.toFixed(6),
                  safeAttempt: safeAttempt.toFixed(6),
                  floor: HEDGE_MIN_OPEN_USDC,
                });
                (rebalanceSwaps as any).poolTransfer = {
                  requested: '0.00',
                  success: false,
                  error: 'No safe hedge amount available within on-chain limits',
                };
              } else {
                const transferResult = await transferUsdcFromPoolToAdmin(network, safeAttempt);
                (rebalanceSwaps as any).poolTransfer = {
                  requested: safeAttempt.toFixed(6),
                  success: transferResult.success,
                  txDigest: transferResult.txDigest,
                  error: transferResult.error,
                };
                if (transferResult.success) {
                  logger.info('[SUI Cron] Pool → admin USDC transfer successful (safe-attempt path)', {
                    txDigest: transferResult.txDigest,
                    amount: safeAttempt.toFixed(6),
                  });
                  await new Promise(r => setTimeout(r, 2000));
                } else {
                  logger.warn('[SUI Cron] Pool → admin USDC transfer failed (safe-attempt path)', {
                    error: transferResult.error,
                  });
                }
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

          // Drop any individual swap whose USDC value is below the per-asset minimum.
          // This prevents high-fee micro-routes when the pool is small.
          const filteredSwaps = swapPlan.swaps.filter(s => {
            const usdcValue = Number(s.amountIn) / 1e6;
            if (usdcValue < MIN_PER_ASSET_SWAP_USD) {
              logger.info(`[SUI Cron] Skipping ${s.asset} swap — $${usdcValue.toFixed(2)} below $${MIN_PER_ASSET_SWAP_USD} per-asset minimum`);
              return false;
            }
            return true;
          });
          if (filteredSwaps.length < swapPlan.swaps.length) {
            swapPlan = { ...swapPlan, swaps: filteredSwaps };
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

    // Step 8: Auto-Hedge via BlueFin perpetuals
    // DISABLED: BlueFin perp hedging is inappropriate for this pool:
    //  - Pool NAV is too small for viable perp positions
    //  - On-chain hedge system (open_hedge/close_hedge) already handles rebalancing
    //  - Perp hedges were spamming 241+ DB records with no real risk reduction
    // To re-enable: set risk_threshold >= 8 in auto_hedge_configs DB table
    let autoHedgeResult: { triggered: boolean; hedges?: Array<{ symbol: string; side: string; size: number; status: string; orderId?: string; error?: string }> } = { triggered: false };

    // ═══════════════════════════════════════════════════════════════════
    // KILL SWITCH — set KILL_SWITCH=true (or =1, =on) to halt all new
    // directional exposure. Existing positions still close on next cycle.
    // Also enforced inside swap planning via isTradingHalted().
    // ═══════════════════════════════════════════════════════════════════
    const { isTradingHalted } = await import('@/lib/services/hedging/calibration');
    if (isTradingHalted()) {
      logger.warn('[SUI Cron] KILL_SWITCH active — skipping all new perp hedges this cycle');
      autoHedgeResult = {
        triggered: false,
        hedges: [{ symbol: 'KILL_SWITCH', side: 'N/A', size: 0, status: 'HALTED',
          error: 'KILL_SWITCH env var is set — no new positions opened.' }],
      };
    } else if ((globalThis as Record<string, unknown>).__suiDailyLossHalted === true) {
      // Daily-loss circuit breaker tripped earlier in this cycle.
      logger.error('[SUI Cron] Daily-loss circuit breaker tripped — skipping new perp hedges');
      autoHedgeResult = {
        triggered: false,
        hedges: [{ symbol: 'DAILY_LOSS_HALT', side: 'N/A', size: 0, status: 'HALTED',
          error: 'Realized 24h loss exceeds HEDGE_DAILY_LOSS_CAP_USD — no new positions opened.' }],
      };
    } else if (navUsd >= 1000) {
      // Only attempt perp hedging when pool has meaningful NAV ($1000+)
      try {
        const allConfigs = await getAutoHedgeConfigs();
        const suiPoolConfig = allConfigs.find(c => 
          isSuiCommunityPool(c.portfolioId) || 
          c.portfolioId === SUI_COMMUNITY_POOL_PORTFOLIO_ID ||
          (c as any).poolAddress === process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID
        );

        if (suiPoolConfig?.enabled) {
          const riskScore = aiResult.riskScore ?? 0;
          const threshold = suiPoolConfig.riskThreshold ?? 8; // Default to HIGH threshold

          logger.info('[SUI Cron] Auto-hedge check', {
            enabled: true,
            riskScore,
            threshold,
            shouldHedge: riskScore >= threshold,
            navUsd: navUsd.toFixed(2),
          });

          if (riskScore >= threshold) {
          // Risk exceeds threshold - open protective hedges on BlueFin
          const hedges: typeof autoHedgeResult.hedges = [];
          
          // Only hedge if BlueFin credentials are configured
          if (process.env.BLUEFIN_PRIVATE_KEY) {
            try {
              const bluefin = BluefinService.getInstance();
              const leverage = safeLeverage(suiPoolConfig.maxLeverage || 3, 5);

              // ═══ PREFLIGHT — verify Bluefin account is funded & reachable ═══
              // Skip the entire hedge block (not just one asset) if the account
              // can't trade or has no margin. Avoids 3 sequential 404s per cron tick.
              let freeCollateral = 0;
              try {
                freeCollateral = await bluefin.getBalance();
              } catch (balErr) {
                logger.error('[SUI Cron] Bluefin getBalance failed — aborting hedge cycle', {
                  error: balErr instanceof Error ? balErr.message : String(balErr),
                  walletAddress: bluefin.getAddress(),
                });
                autoHedgeResult = {
                  triggered: false,
                  hedges: [{ symbol: 'PREFLIGHT', side: 'N/A', size: 0, status: 'BLOCKED',
                    error: `Bluefin account check failed: ${balErr instanceof Error ? balErr.message : String(balErr)}` }],
                };
                throw new Error('preflight-failed');
              }

              // ═══ AUTO TOP-UP — keep margin >= MIN by depositing from spot wallet ═══
              // Pulls from the operator's spot USDC into Bluefin Margin Bank when
              // freeCollateral falls below BLUEFIN_MIN_MARGIN_USD (default $20).
              // Top-up is opt-out: set BLUEFIN_AUTO_TOPUP=false to disable.
              const autoTopUpEnabled = (process.env.BLUEFIN_AUTO_TOPUP || 'true').toLowerCase() !== 'false';
              const minMargin = Number(process.env.BLUEFIN_MIN_MARGIN_USD || 20);
              const targetMargin = Number(process.env.BLUEFIN_TARGET_MARGIN_USD || 50);
              const spotReserve = Number(process.env.BLUEFIN_SPOT_RESERVE_USD || 1);
              const swapFromSui = (process.env.BLUEFIN_TOPUP_SWAP_FROM_SUI || 'true').toLowerCase() !== 'false';
              const suiReserve = Number(process.env.BLUEFIN_SUI_RESERVE || 0.5);
              const maxSwapSui = Number(process.env.BLUEFIN_MAX_SWAP_SUI || 25);
              if (autoTopUpEnabled && freeCollateral < minMargin) {
                try {
                  const topUp = await bluefinTreasury.autoTopUp({
                    minMargin, targetMargin, spotReserve,
                    swapFromSui, suiReserve, maxSwapSui,
                  });
                  if ('skipped' in topUp) {
                    logger.warn('[SUI Cron] Auto top-up skipped', topUp);
                  } else {
                    logger.info('[SUI Cron] Auto top-up executed', topUp);
                    if (topUp.ok) {
                      // Refresh free collateral after on-chain settlement
                      try { freeCollateral = await bluefin.getBalance(); } catch { /* keep stale */ }
                    }
                  }
                } catch (topUpErr) {
                  logger.error('[SUI Cron] Auto top-up failed (non-fatal)', {
                    error: topUpErr instanceof Error ? topUpErr.message : String(topUpErr),
                  });
                }
              }

              if (freeCollateral <= 0) {
                logger.warn('[SUI Cron] Bluefin freeCollateral=0 — aborting hedge cycle', {
                  walletAddress: bluefin.getAddress(),
                });
                autoHedgeResult = {
                  triggered: false,
                  hedges: [{ symbol: 'PREFLIGHT', side: 'N/A', size: 0, status: 'BLOCKED',
                    error: `Bluefin wallet ${bluefin.getAddress()} has 0 free collateral after top-up attempt. Fund operator wallet with USDC.` }],
                };
                throw new Error('preflight-no-margin');
              }
              logger.info('[SUI Cron] Bluefin preflight OK', {
                walletAddress: bluefin.getAddress(),
                freeCollateral,
              });

              // ═══════════════════════════════════════════════════════════════════
              // PREDICTION-SIGNAL GATE (defensive) — only open NEW SHORT hedges
              // when the Polymarket BTC 5-min market is qualified DOWN.
              //
              // Rationale: SHORT hedges *cost* funding + slippage. If we open one
              // and the market actually goes UP, the hedge loses money while spot
              // appreciates (wash) — but we still pay funding + execution fees.
              // To enforce "near 0 loss", we ONLY open a hedge when an external,
              // calibrated, sufficiently-confident signal agrees with the
              // protective direction (DOWN ⇒ short profitable).
              //
              // BTC signal is used as the macro proxy for ETH and SUI as well
              // (correlation > 0.7 historically). Override per-asset signals can
              // be added later, but for now BTC = market regime.
              //
              // Disable this gate (NOT RECOMMENDED) by setting
              //   HEDGE_REQUIRE_PREDICTION_SIGNAL=false
              // Tighten further with HEDGE_MIN_POLY_CONFIDENCE (default 70).
              // ═══════════════════════════════════════════════════════════════════
              const requireSignal = (process.env.HEDGE_REQUIRE_PREDICTION_SIGNAL || 'true').toLowerCase() !== 'false';
              let qualifiedHedgeSignal: { direction: 'UP' | 'DOWN'; confidence: number; probability: number; weight: number } | null = null;
              if (requireSignal) {
                try {
                  const { Polymarket5MinService } = await import('@/lib/services/market-data/Polymarket5MinService');
                  const { qualifyPolymarketSignal, SIZING_LIMITS } = await import('@/lib/services/hedging/calibration');
                  const rawSig = await Polymarket5MinService.getLatest5MinSignal();
                  const qualified = qualifyPolymarketSignal(rawSig ?? undefined);
                  if (qualified && rawSig) {
                    qualifiedHedgeSignal = {
                      direction: qualified.direction,
                      confidence: rawSig.confidence,
                      probability: qualified.probability,
                      weight: qualified.weight,
                    };
                    logger.info('[SUI Cron] Qualified Polymarket signal for hedge gate', {
                      ...qualifiedHedgeSignal,
                      minConfidence: SIZING_LIMITS.MIN_POLY_CONFIDENCE,
                      minEdge: SIZING_LIMITS.MIN_EDGE,
                    });
                  } else {
                    logger.warn('[SUI Cron] No qualified Polymarket signal — skipping all NEW hedges (defensive)', {
                      rawSignalPresent: !!rawSig,
                      rawDirection: rawSig?.direction,
                      rawConfidence: rawSig?.confidence,
                      rawStrength: rawSig?.signalStrength,
                    });
                  }
                } catch (sigErr) {
                  logger.warn('[SUI Cron] Polymarket signal fetch failed — skipping all NEW hedges (defensive)', {
                    error: sigErr instanceof Error ? sigErr.message : String(sigErr),
                  });
                }

                // Hard gate: no qualified signal → no new exposure. Period.
                if (!qualifiedHedgeSignal || qualifiedHedgeSignal.direction !== 'DOWN') {
                  autoHedgeResult = {
                    triggered: false,
                    hedges: [{
                      symbol: 'SIGNAL_GATE',
                      side: 'N/A',
                      size: 0,
                      status: 'BLOCKED',
                      error: qualifiedHedgeSignal
                        ? `Polymarket signal direction is ${qualifiedHedgeSignal.direction} (need DOWN for protective SHORT). No hedge opened.`
                        : 'No qualified Polymarket DOWN signal — no hedge opened. (HEDGE_REQUIRE_PREDICTION_SIGNAL=true)',
                    }],
                  };
                  throw new Error('signal-gate-blocked');
                }
              }

              // BlueFin minimum order sizes and step sizes
              const PERP_SPECS: Record<string, { minQty: number; stepSize: number }> = {
                BTC: { minQty: 0.001, stepSize: 0.001 },
                ETH: { minQty: 0.01, stepSize: 0.01 },
                SUI: { minQty: 1, stepSize: 1 },
              };

              // Sweep expired idempotency tokens at start of cycle
              const nowMs = Date.now();
              for (const [k, exp] of recentHedgeTokens) if (exp <= nowMs) recentHedgeTokens.delete(k);

              // Track collateral budget consumed across this cycle so we don't
              // over-commit if multiple assets cross the threshold simultaneously.
              let collateralBudgetUsed = 0;
              const collateralBudget = freeCollateral * 0.9; // keep 10% margin headroom

              // Calculate hedge sizes based on pool NAV and allocations
              // Open SHORT hedges on any asset with >5% allocation to protect against downside.
              // Sizing is scaled by Polymarket signal weight × edge so weakly-confident
              // signals produce smaller hedges (further reduces near-zero loss risk).
              const signalScale = qualifiedHedgeSignal
                ? Math.max(0.25, Math.min(1.0, qualifiedHedgeSignal.weight * (qualifiedHedgeSignal.probability * 2 - 1)))
                : 0.5;
              for (const asset of ['BTC', 'ETH', 'SUI'] as const) {
                const allocation = aiResult.allocations[asset] || 0;
                if (allocation < 5) continue; // Hedge any meaningful allocation (>5%)

                const hedgeValueUSD = navUsd * (allocation / 100) * 0.5 * signalScale; // scaled by signal strength
                // Use leverage to amplify small hedges into viable sizes
                const effectiveValue = hedgeValueUSD * leverage;
                const sizingPrice = pricesUSD[asset] || 0;
                if (sizingPrice <= 0) {
                  logger.warn(`[SUI Cron] Skip ${asset}-PERP: no reference price`);
                  continue;
                }
                const hedgeSizeBase = effectiveValue / sizingPrice;

                // Snap to step size and check against actual BlueFin minimum
                const spec = PERP_SPECS[asset] || { minQty: 0.001, stepSize: 0.001 };
                const snappedSize = Math.floor(hedgeSizeBase / spec.stepSize) * spec.stepSize;

                if (snappedSize < spec.minQty) {
                  logger.info(`[SUI Cron] Skip ${asset}-PERP: snappedSize ${snappedSize} < minQty ${spec.minQty} (raw=${hedgeSizeBase}, leverage=${leverage})`);
                  continue;
                }

                // ═══ IDEMPOTENCY GATE — drop duplicate decisions in same window ═══
                const decisionToken = buildDecisionToken({
                  portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
                  asset,
                  side: 'SHORT',
                  riskScore,
                  now: nowMs,
                });
                if (recentHedgeTokens.has(decisionToken)) {
                  logger.info(`[SUI Cron] Skip ${asset}-PERP: duplicate decision token`, { token: decisionToken });
                  continue;
                }

                // ═══ COLLATERAL BUDGET — don't exceed wallet's free collateral ═══
                // Required margin ≈ notional / leverage (plus a small buffer for fees/funding)
                const requiredMargin = (snappedSize * sizingPrice / leverage) * 1.02;
                if (collateralBudgetUsed + requiredMargin > collateralBudget) {
                  logger.warn(`[SUI Cron] Skip ${asset}-PERP: required margin ${requiredMargin.toFixed(2)} would exceed budget`, {
                    used: collateralBudgetUsed.toFixed(2),
                    budget: collateralBudget.toFixed(2),
                    requiredMargin: requiredMargin.toFixed(2),
                  });
                  continue;
                }

                // ═══ SLIPPAGE GATE — abort if Bluefin's mark diverges from our sizing price ═══
                let bluefinPrice = sizingPrice;
                try {
                  const md = await bluefin.getMarketData(`${asset}-PERP`);
                  if (md && Number.isFinite(md.price) && md.price > 0) bluefinPrice = md.price;
                } catch (mdErr) {
                  logger.warn(`[SUI Cron] Could not fetch Bluefin mark for ${asset}-PERP, using sizingPrice`, {
                    error: mdErr instanceof Error ? mdErr.message : String(mdErr),
                  });
                }
                const slippagePct = Math.abs(bluefinPrice - sizingPrice) / sizingPrice * 100;
                if (slippagePct > HEDGE_MAX_SLIPPAGE_PCT) {
                  logger.error(`[SUI Cron] Skip ${asset}-PERP: slippage ${slippagePct.toFixed(3)}% > ${HEDGE_MAX_SLIPPAGE_PCT}%`, {
                    sizingPrice,
                    bluefinPrice,
                  });
                  continue;
                }

                try {
                  logger.info(`[SUI Cron] Attempting ${asset}-PERP hedge`, {
                    allocation, hedgeValueUSD, effectiveValue, hedgeSizeBase, snappedSize, leverage,
                    minQty: spec.minQty,
                    sizingPrice,
                    bluefinPrice,
                    slippagePct: slippagePct.toFixed(3),
                    requiredMargin: requiredMargin.toFixed(2),
                    decisionToken,
                  });

                  // Reserve token BEFORE calling Bluefin so a concurrent run can't double-fire
                  recentHedgeTokens.set(decisionToken, nowMs + HEDGE_TOKEN_TTL_MS);

                  const result = await bluefin.openHedge({
                    symbol: `${asset}-PERP`,
                    side: 'SHORT', // Protective short to hedge long spot exposure
                    size: snappedSize, // Use snapped size that meets BlueFin minimums
                    leverage,
                    portfolioId: -2, // SUI pool special ID
                    reason: `Auto-hedge: Risk ${riskScore}/10 > threshold ${threshold}/10 (token=${decisionToken})`,
                  });

                  if (!result.success) {
                    // Failed — release the token so the next cycle can retry
                    recentHedgeTokens.delete(decisionToken);
                  } else {
                    collateralBudgetUsed += requiredMargin;
                  }

                  hedges.push({
                    symbol: `${asset}-PERP`,
                    side: 'SHORT',
                    size: snappedSize,
                    status: result.success ? 'OPENED' : 'FAILED',
                    orderId: result.orderId,
                    error: result.error,
                  });

                  // Persist successful hedges to DB for UI display
                  if (result.success && result.orderId) {
                    try {
                      await createHedge({
                        orderId: result.orderId,
                        portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
                        walletAddress: (process.env.SUI_ADMIN_ADDRESS || '').trim(),
                        asset,
                        market: `${asset}-PERP`,
                        side: 'SHORT',
                        size: snappedSize,
                        notionalValue: hedgeValueUSD,
                        leverage,
                        entryPrice: bluefinPrice || sizingPrice,
                        simulationMode: false,
                        chain: 'sui',
                        reason: `Auto-hedge: Risk ${riskScore}/10 > threshold ${threshold}/10`,
                      });
                      logger.info(`[SUI Cron] Hedge saved to DB`, { asset, orderId: result.orderId });
                    } catch (dbErr) {
                      logger.warn(`[SUI Cron] Failed to save hedge to DB (non-critical)`, { asset, error: dbErr });
                    }
                  }

                  logger.info(`[SUI Cron] Opened ${asset} hedge`, {
                    symbol: `${asset}-PERP`,
                    side: 'SHORT',
                    size: snappedSize,
                    leverage,
                    success: result.success,
                    orderId: result.orderId,
                  });
                } catch (hedgeErr) {
                  // Always release token on exception
                  recentHedgeTokens.delete(decisionToken);
                  hedges.push({
                    symbol: `${asset}-PERP`,
                    side: 'SHORT',
                    size: snappedSize,
                    status: 'ERROR',
                    error: hedgeErr instanceof Error ? hedgeErr.message : String(hedgeErr),
                  });
                  logger.error(`[SUI Cron] Failed to hedge ${asset}`, { error: hedgeErr });
                }
              }

              autoHedgeResult = { triggered: true, hedges };
            } catch (bfErr) {
              const msg = bfErr instanceof Error ? bfErr.message : String(bfErr);
              // preflight-failed / preflight-no-margin / signal-gate-blocked already populated autoHedgeResult above
              if (msg !== 'preflight-failed' && msg !== 'preflight-no-margin' && msg !== 'signal-gate-blocked') {
                logger.error('[SUI Cron] BlueFin hedging failed', { error: bfErr });
                autoHedgeResult = {
                  triggered: true,
                  hedges: [{ symbol: 'ALL', side: 'N/A', size: 0, status: 'ERROR', error: msg }]
                };
              }
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
    } else if (navUsd > 0.50) {
      logger.info('[SUI Cron] Pool NAV $' + navUsd.toFixed(2) + ' too low for perp hedging (min $1000) — skipping Step 8');
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

    // Reconcile on-chain hedge state into the DB. The Move pool's
    // `hedge_state.active_hedges` is the source of truth — this mirrors any
    // new on-chain HedgePosition objects (real hedges + operational rebalance
    // transfers) into the `hedges` table and closes DB rows whose on-chain
    // counterpart is gone. Idempotent and non-fatal.
    let reconcile: { inserted: number; closed: number; errors: number } | undefined;
    try {
      const { reconcileSuiHedges } = await import('@/lib/services/sui/SuiHedgeReconciler');
      const r = await reconcileSuiHedges();
      reconcile = { inserted: r.inserted, closed: r.closed, errors: r.errors.length };
      if (r.inserted > 0 || r.closed > 0) {
        logger.info('[SUI Cron] Hedge reconciliation', reconcile);
      }
    } catch (recErr) {
      logger.warn('[SUI Cron] Hedge reconciliation failed (non-critical)', { error: recErr });
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
      ...(gasStatus && { operatorGas: { ...gasStatus, sufficient: gasCheckPassed } }),
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
