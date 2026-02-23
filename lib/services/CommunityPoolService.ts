/**
 * Community Pool Service (Off-Chain / Database-backed)
 * 
 * ⚠️  FOR PRODUCTION: Use CommunityPoolOnChainService.ts instead!
 *     This service stores state in Neon PostgreSQL for UI/tracking.
 *     The on-chain contract (CommunityPool.sol) should be source of truth.
 * 
 * This service provides:
 * - Share-based ownership (deposit → shares, withdraw → burn shares)
 * - ERC-4626 style virtual shares for inflation attack protection
 * - Fair proportional withdrawals with slippage protection
 * - AI-driven asset allocation decisions
 * - Real-time price tracking and NAV calculation
 * 
 * FAIRNESS MECHANISMS (matching on-chain contract):
 * - Virtual shares offset to prevent first depositor attacks
 * - mulDiv-style calculations to prevent rounding manipulation
 * - Minimum first deposit to prevent inflation attacks
 * - Slippage protection on withdrawals
 */

import { logger } from '../utils/logger';
import { getMarketDataService, type ExtendedMarketData } from './RealMarketDataService';
import {
  getPoolState,
  savePoolState,
  getUserShares,
  saveUserShares,
  addPoolTransaction,
  getAllUserShares,
  calculateOwnership,
  txHashExists,
  SUPPORTED_ASSETS,
  type PoolState,
  type UserShares,
  type SupportedAsset,
} from '../storage/community-pool-storage';

// ═══════════════════════════════════════════════════════════════
// FAIRNESS CONSTANTS (matching CommunityPool.sol on-chain contract)
// ═══════════════════════════════════════════════════════════════

// Minimum deposits to prevent dust/inflation attacks
const MIN_DEPOSIT_USD = 10;           // $10 minimum subsequent deposits
const MIN_FIRST_DEPOSIT_USD = 10;     // $10 minimum FIRST deposit (virtual shares provide inflation attack protection)
const MIN_WITHDRAWAL_SHARES = 0.01;

// Virtual shares/assets offset (ERC-4626 inflation attack protection)
// MUST MATCH ON-CHAIN CONTRACT VALUES (in human-readable format):
// Contract: VIRTUAL_SHARES = 1e18 (1 share), VIRTUAL_ASSETS = 1e6 ($1 USDC)
// Off-chain (human-readable): 1 share, $1
const VIRTUAL_SHARES = 1;             // 1 virtual share
const VIRTUAL_ASSETS_USD = 1;         // $1 virtual assets

// Slippage protection
const DEFAULT_SLIPPAGE_BPS = 100;     // 1% default slippage tolerance
const MAX_SLIPPAGE_BPS = 500;         // 5% max slippage

// Extended market data cache - minimal TTL, relies on RealMarketDataService caching
let extendedDataCache: Map<string, ExtendedMarketData> | null = null;
let dataCacheTime = 0;
const DATA_CACHE_TTL = 5000; // 5 seconds - very fresh prices for fund operations

/**
 * Fetch live prices using central RealMarketDataService
 * 
 * ⚠️ SECURITY: For billion-dollar fund, NEVER use hardcoded fallback prices.
 * Uses the unified price service with proper caching and deduplication.
 * Always returns fresh prices (<10s old via stale-while-revalidate).
 */
export async function fetchLivePrices(): Promise<Record<SupportedAsset, number>> {
  const now = Date.now();
  
  // Return cached prices if fresh
  if (extendedDataCache && now - dataCacheTime < DATA_CACHE_TTL) {
    const prices: Partial<Record<SupportedAsset, number>> = {};
    for (const asset of SUPPORTED_ASSETS) {
      const data = extendedDataCache.get(asset);
      if (data) prices[asset] = data.price;
    }
    if (Object.keys(prices).length === SUPPORTED_ASSETS.length) {
      return prices as Record<SupportedAsset, number>;
    }
  }
  
  // Use central RealMarketDataService
  const marketService = getMarketDataService();
  const extendedData = await marketService.getExtendedPrices(SUPPORTED_ASSETS);
  
  // Validate we got all required prices
  const prices: Partial<Record<SupportedAsset, number>> = {};
  const missingAssets: string[] = [];
  
  for (const asset of SUPPORTED_ASSETS) {
    const data = extendedData.get(asset);
    if (data && data.price > 0) {
      prices[asset] = data.price;
    } else {
      missingAssets.push(asset);
    }
  }
  
  if (missingAssets.length > 0) {
    throw new Error(`Missing prices for: ${missingAssets.join(', ')}. Operations halted for fund security.`);
  }
  
  // Update cache
  extendedDataCache = extendedData;
  dataCacheTime = now;
  
  logger.info(`[CommunityPool] Prices via RealMarketDataService: BTC=$${prices.BTC}, ETH=$${prices.ETH}`);
  return prices as Record<SupportedAsset, number>;
}

/**
 * Fetch extended market data (includes 24h change, high, low)
 * Used by AI decisions and risk analysis
 */
export async function fetchExtendedMarketData(): Promise<Map<string, ExtendedMarketData>> {
  const now = Date.now();
  
  // Return cached if fresh
  if (extendedDataCache && now - dataCacheTime < DATA_CACHE_TTL) {
    return extendedDataCache;
  }
  
  const marketService = getMarketDataService();
  const extendedData = await marketService.getExtendedPrices(SUPPORTED_ASSETS);
  
  extendedDataCache = extendedData;
  dataCacheTime = now;
  
  return extendedData;
}

/**
 * Calculate current NAV (Net Asset Value) of the pool
 */
export async function calculatePoolNAV(): Promise<{
  totalValueUSD: number;
  sharePrice: number;
  allocations: PoolState['allocations'];
}> {
  const poolState = await getPoolState();
  const prices = await fetchLivePrices();
  
  let totalValueUSD = 0;
  const allocations = { ...poolState.allocations };
  
  for (const asset of SUPPORTED_ASSETS) {
    const amount = allocations[asset].amount;
    const price = prices[asset];
    const valueUSD = amount * price;
    
    allocations[asset].price = price;
    allocations[asset].valueUSD = valueUSD;
    totalValueUSD += valueUSD;
  }
  
  // Update percentages based on current values
  for (const asset of SUPPORTED_ASSETS) {
    allocations[asset].percentage = totalValueUSD > 0 
      ? (allocations[asset].valueUSD / totalValueUSD) * 100 
      : poolState.allocations[asset].percentage;
  }
  
  // Calculate share price
  const sharePrice = poolState.totalShares > 0 
    ? totalValueUSD / poolState.totalShares 
    : 1.0;
  
  return { totalValueUSD, sharePrice, allocations };
}

/**
 * Deposit USDC into the community pool
 * Uses ERC-4626 virtual shares mechanism for fair share calculation
 * 
 * FAIRNESS: Virtual shares prevent first depositor inflation attacks
 * shares = (amount * (totalShares + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS)
 */
export async function deposit(
  walletAddress: string,
  amountUSD: number,
  txHash?: string
): Promise<{
  success: boolean;
  sharesReceived: number;
  sharePrice: number;
  newTotalShares: number;
  ownershipPercentage: number;
  error?: string;
}> {
  // IDEMPOTENCY: If txHash provided, check if already recorded
  if (txHash && await txHashExists(txHash)) {
    logger.info(`[CommunityPool] Duplicate deposit txHash ignored: ${txHash}`);
    return {
      success: true, // Already recorded, return success
      sharesReceived: 0,
      sharePrice: 0,
      newTotalShares: 0,
      ownershipPercentage: 0,
      error: 'Transaction already recorded',
    };
  }

  // FAIRNESS: First deposit requires higher minimum to prevent inflation attack
  const poolState = await getPoolState();
  const isFirstDeposit = poolState.totalShares === 0;
  const minRequired = isFirstDeposit ? MIN_FIRST_DEPOSIT_USD : MIN_DEPOSIT_USD;
  
  if (amountUSD < minRequired) {
    return {
      success: false,
      sharesReceived: 0,
      sharePrice: 0,
      newTotalShares: 0,
      ownershipPercentage: 0,
      error: isFirstDeposit 
        ? `First deposit must be at least $${MIN_FIRST_DEPOSIT_USD} to prevent manipulation`
        : `Minimum deposit is $${MIN_DEPOSIT_USD}`,
    };
  }
  
  try {
    const { totalValueUSD, allocations } = await calculatePoolNAV();
    
    // FAIRNESS: ERC-4626 virtual shares mechanism
    // Add virtual offset to prevent first depositor attacks
    const totalAssetsWithOffset = totalValueUSD + VIRTUAL_ASSETS_USD;
    const totalSharesWithOffset = poolState.totalShares + VIRTUAL_SHARES;
    
    // shares = (amount * totalSharesWithOffset) / totalAssetsWithOffset
    // Using floor division to favor the pool (same as mulDiv.Floor in Solidity)
    const sharesReceived = Math.floor((amountUSD * totalSharesWithOffset) / totalAssetsWithOffset);
    
    // Calculate actual share price for user reference
    const sharePrice = totalAssetsWithOffset / totalSharesWithOffset;
    
    // Validate shares received is reasonable
    if (sharesReceived <= 0) {
      throw new Error('Share calculation failed: would receive 0 shares');
    }
    
    // Update pool state
    poolState.totalValueUSD = totalValueUSD + amountUSD;
    poolState.totalShares += sharesReceived;
    poolState.sharePrice = (poolState.totalValueUSD + VIRTUAL_ASSETS_USD) / (poolState.totalShares + VIRTUAL_SHARES);
    
    // Allocate deposited funds according to target allocation
    const targetAllocations = poolState.lastAIDecision?.allocations || {
      BTC: 35, ETH: 30, SUI: 20, CRO: 15,
    };
    
    const prices = await fetchLivePrices();
    for (const asset of SUPPORTED_ASSETS) {
      const targetPct = targetAllocations[asset] / 100;
      const depositForAsset = amountUSD * targetPct;
      const amountToBuy = depositForAsset / prices[asset];
      poolState.allocations[asset].amount += amountToBuy;
      poolState.allocations[asset].valueUSD += depositForAsset;
      poolState.allocations[asset].price = prices[asset];
    }
    
    await savePoolState(poolState);
    
    // Update user shares
    let userShares = await getUserShares(walletAddress);
    if (!userShares) {
      userShares = {
        walletAddress,
        shares: 0,
        valueUSD: 0,
        percentage: 0,
        deposits: [],
        withdrawals: [],
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
    
    userShares.shares += sharesReceived;
    userShares.valueUSD = userShares.shares * poolState.sharePrice;
    userShares.percentage = calculateOwnership(userShares.shares, poolState.totalShares);
    userShares.deposits.push({
      timestamp: Date.now(),
      amountUSD,
      sharesReceived,
      sharePrice,
      txHash,
    });
    
    await saveUserShares(userShares);
    
    // Record transaction
    await addPoolTransaction({
      type: 'DEPOSIT',
      walletAddress,
      amountUSD,
      shares: sharesReceived,
      sharePrice,
      timestamp: Date.now(),
      txHash,
    });
    
    logger.info(`[CommunityPool] Deposit: ${walletAddress} deposited $${amountUSD}, received ${sharesReceived.toFixed(4)} shares`);
    
    return {
      success: true,
      sharesReceived,
      sharePrice,
      newTotalShares: poolState.totalShares,
      ownershipPercentage: userShares.percentage,
    };
    
  } catch (error: any) {
    logger.error('[CommunityPool] Deposit failed:', error);
    return {
      success: false,
      sharesReceived: 0,
      sharePrice: 0,
      newTotalShares: 0,
      ownershipPercentage: 0,
      error: error.message,
    };
  }
}

/**
 * Withdraw from the community pool by burning shares
 * Uses ERC-4626 virtual shares mechanism for fair withdrawal calculation
 * 
 * FAIRNESS: Virtual shares ensure symmetric deposit/withdrawal calculations
 * amountUSD = (sharesToBurn * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES)
 * 
 * @param minAmountOut Optional slippage protection - reverts if output is less
 */
export async function withdraw(
  walletAddress: string,
  sharesToBurn: number,
  txHash?: string,
  minAmountOut?: number
): Promise<{
  success: boolean;
  amountUSD: number;
  sharesBurned: number;
  sharePrice: number;
  remainingShares: number;
  error?: string;
}> {
  try {
    // IDEMPOTENCY: If txHash provided, check if already recorded
    if (txHash && await txHashExists(txHash)) {
      logger.info(`[CommunityPool] Duplicate withdrawal txHash ignored: ${txHash}`);
      return {
        success: true, // Already recorded, return success
        amountUSD: 0,
        sharesBurned: 0,
        sharePrice: 0,
        remainingShares: 0,
        error: 'Transaction already recorded',
      };
    }

    let userShares = await getUserShares(walletAddress);
    
    // If txHash is provided, the on-chain tx already succeeded
    // The smart contract verified ownership - just record the withdrawal
    const onChainVerified = !!txHash;
    
    // If no local record but on-chain succeeded, create a record to track
    if (!userShares && onChainVerified) {
      userShares = {
        walletAddress,
        shares: sharesToBurn, // Will be subtracted below
        valueUSD: 0,
        percentage: 0,
        joinedAt: Date.now(),
        updatedAt: Date.now(),
        deposits: [],
        withdrawals: [],
      };
    }
    
    // Only validate shares if NOT on-chain verified (pre-flight check)
    if (!onChainVerified && (!userShares || userShares.shares < sharesToBurn)) {
      return {
        success: false,
        amountUSD: 0,
        sharesBurned: 0,
        sharePrice: 0,
        remainingShares: userShares?.shares || 0,
        error: `Insufficient shares. You have ${userShares?.shares.toFixed(4) || 0} shares`,
      };
    }
    
    if (!userShares) {
      return {
        success: false,
        amountUSD: 0,
        sharesBurned: 0,
        sharePrice: 0,
        remainingShares: 0,
        error: 'No user shares found',
      };
    }
    
    if (sharesToBurn < MIN_WITHDRAWAL_SHARES) {
      return {
        success: false,
        amountUSD: 0,
        sharesBurned: 0,
        sharePrice: 0,
        remainingShares: userShares.shares,
        error: `Minimum withdrawal is ${MIN_WITHDRAWAL_SHARES} shares`,
      };
    }
    
    const poolState = await getPoolState();
    const { totalValueUSD } = await calculatePoolNAV();
    
    // FAIRNESS: ERC-4626 virtual shares mechanism (symmetric with deposit)
    const totalAssetsWithOffset = totalValueUSD + VIRTUAL_ASSETS_USD;
    const totalSharesWithOffset = poolState.totalShares + VIRTUAL_SHARES;
    
    // amountUSD = sharesToBurn * totalAssetsWithOffset / totalSharesWithOffset
    // Using floor division to favor the pool (same as mulDiv.Floor in Solidity)
    const amountUSD = Math.floor((sharesToBurn * totalAssetsWithOffset) / totalSharesWithOffset);
    const sharePrice = totalAssetsWithOffset / totalSharesWithOffset;
    
    // FAIRNESS: Slippage protection - user specifies minimum acceptable output
    if (minAmountOut !== undefined && amountUSD < minAmountOut) {
      return {
        success: false,
        amountUSD: 0,
        sharesBurned: 0,
        sharePrice,
        remainingShares: userShares.shares,
        error: `Slippage exceeded: would receive $${amountUSD.toFixed(2)} but minimum is $${minAmountOut.toFixed(2)}`,
      };
    }
    
    // Update pool state (ensure non-negative in case local storage was out of sync)
    poolState.totalShares = Math.max(0, poolState.totalShares - sharesToBurn);
    poolState.totalValueUSD = Math.max(0, totalValueUSD - amountUSD);
    poolState.sharePrice = (poolState.totalValueUSD + VIRTUAL_ASSETS_USD) / (poolState.totalShares + VIRTUAL_SHARES);
    
    // Reduce asset amounts proportionally
    const withdrawalPct = sharesToBurn / (poolState.totalShares + sharesToBurn);
    for (const asset of SUPPORTED_ASSETS) {
      const amountToReduce = poolState.allocations[asset].amount * withdrawalPct;
      poolState.allocations[asset].amount -= amountToReduce;
      poolState.allocations[asset].valueUSD = poolState.allocations[asset].amount * poolState.allocations[asset].price;
    }
    
    await savePoolState(poolState);
    
    // Update user shares (ensure non-negative in case local storage was out of sync)
    userShares.shares = Math.max(0, userShares.shares - sharesToBurn);
    userShares.valueUSD = userShares.shares * poolState.sharePrice;
    userShares.percentage = calculateOwnership(userShares.shares, poolState.totalShares);
    userShares.withdrawals.push({
      timestamp: Date.now(),
      sharesBurned: sharesToBurn,
      amountUSD,
      sharePrice,
      txHash,
    });
    
    await saveUserShares(userShares);
    
    // Record transaction
    await addPoolTransaction({
      type: 'WITHDRAWAL',
      walletAddress,
      amountUSD,
      shares: sharesToBurn,
      sharePrice,
      timestamp: Date.now(),
      txHash,
    });
    
    logger.info(`[CommunityPool] Withdrawal: ${walletAddress} burned ${sharesToBurn.toFixed(4)} shares, received $${amountUSD.toFixed(2)}`);
    
    return {
      success: true,
      amountUSD,
      sharesBurned: sharesToBurn,
      sharePrice,
      remainingShares: userShares.shares,
    };
    
  } catch (error: any) {
    logger.error('[CommunityPool] Withdrawal failed:', error);
    return {
      success: false,
      amountUSD: 0,
      sharesBurned: 0,
      sharePrice: 0,
      remainingShares: 0,
      error: error.message,
    };
  }
}

/**
 * Apply AI allocation decision and rebalance the pool
 */
export async function applyAIDecision(
  newAllocations: Record<SupportedAsset, number>,
  reasoning: string
): Promise<{
  success: boolean;
  previousAllocations: Record<SupportedAsset, number>;
  newAllocations: Record<SupportedAsset, number>;
  trades: { asset: SupportedAsset; action: 'BUY' | 'SELL'; amountUSD: number }[];
  error?: string;
}> {
  try {
    // Validate allocations sum to 100%
    const totalPct = Object.values(newAllocations).reduce((sum, pct) => sum + pct, 0);
    if (Math.abs(totalPct - 100) > 0.1) {
      return {
        success: false,
        previousAllocations: {} as any,
        newAllocations,
        trades: [],
        error: `Allocations must sum to 100%, got ${totalPct}%`,
      };
    }
    
    const poolState = await getPoolState();
    const { totalValueUSD } = await calculatePoolNAV();
    const prices = await fetchLivePrices();
    
    const previousAllocations: Record<SupportedAsset, number> = {} as any;
    const trades: { asset: SupportedAsset; action: 'BUY' | 'SELL'; amountUSD: number }[] = [];
    
    for (const asset of SUPPORTED_ASSETS) {
      previousAllocations[asset] = poolState.allocations[asset].percentage;
      
      const currentValueUSD = poolState.allocations[asset].valueUSD;
      const targetValueUSD = (newAllocations[asset] / 100) * totalValueUSD;
      const diffUSD = targetValueUSD - currentValueUSD;
      
      if (Math.abs(diffUSD) > 10) { // Ignore tiny differences
        trades.push({
          asset,
          action: diffUSD > 0 ? 'BUY' : 'SELL',
          amountUSD: Math.abs(diffUSD),
        });
        
        // Update allocation
        poolState.allocations[asset].amount = targetValueUSD / prices[asset];
        poolState.allocations[asset].valueUSD = targetValueUSD;
        poolState.allocations[asset].percentage = newAllocations[asset];
        poolState.allocations[asset].price = prices[asset];
      }
    }
    
    // Save AI decision
    poolState.lastAIDecision = {
      timestamp: Date.now(),
      reasoning,
      allocations: newAllocations,
    };
    poolState.lastRebalance = Date.now();
    
    await savePoolState(poolState);
    
    // Record transaction
    await addPoolTransaction({
      type: 'AI_DECISION',
      timestamp: Date.now(),
      details: {
        previousAllocations,
        newAllocations,
        reasoning,
        trades,
      },
    });
    
    logger.info(`[CommunityPool] AI decision applied: ${JSON.stringify(newAllocations)}`);
    
    return {
      success: true,
      previousAllocations,
      newAllocations,
      trades,
    };
    
  } catch (error: any) {
    logger.error('[CommunityPool] AI decision failed:', error);
    return {
      success: false,
      previousAllocations: {} as any,
      newAllocations,
      trades: [],
      error: error.message,
    };
  }
}

/**
 * Get pool summary for display
 */
export async function getPoolSummary(): Promise<{
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number;
  totalMembers: number;
  allocations: PoolState['allocations'];
  lastAIDecision: PoolState['lastAIDecision'];
  performance: {
    day: number;
    week: number;
    month: number;
  };
}> {
  const poolState = await getPoolState();
  const { totalValueUSD, sharePrice, allocations } = await calculatePoolNAV();
  const allUsers = await getAllUserShares();
  
  const activeMembers = allUsers.filter(u => u.shares > 0).length;
  
  // Performance is calculated from real NAV history via RiskMetricsService
  // We return null here to indicate "use RiskMetrics API for real performance data"
  // ⚠️ NEVER use hardcoded placeholder performance for billion-dollar fund
  const performance = {
    day: null as number | null,     // Use /api/community-pool/risk-metrics for real data
    week: null as number | null,
    month: null as number | null,
  };
  
  return {
    totalValueUSD,
    totalShares: poolState.totalShares,
    sharePrice,
    totalMembers: activeMembers,
    allocations,
    lastAIDecision: poolState.lastAIDecision,
    performance,
  };
}
