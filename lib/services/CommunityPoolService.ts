/**
 * Community Pool Service
 * 
 * Core business logic for the community pool:
 * - Share-based ownership (deposit → shares, withdraw → burn shares)
 * - Fair proportional withdrawals
 * - AI-driven asset allocation decisions
 * - Real-time price tracking and NAV calculation
 */

import { logger } from '../utils/logger';
import {
  getPoolState,
  savePoolState,
  getUserShares,
  saveUserShares,
  addPoolTransaction,
  getAllUserShares,
  calculateOwnership,
  SUPPORTED_ASSETS,
  type PoolState,
  type UserShares,
  type SupportedAsset,
} from '../storage/community-pool-storage';

// Minimum deposit amount
const MIN_DEPOSIT_USD = 10;
const MIN_WITHDRAWAL_SHARES = 0.01;

// Live price cache
let priceCache: Record<SupportedAsset, number> = {
  BTC: 67400,
  ETH: 1942,
  SUI: 0.92,
  CRO: 0.076,
};
let priceCacheTime = 0;
const PRICE_CACHE_TTL = 30000; // 30 seconds

/**
 * Fetch live prices from Crypto.com API
 */
export async function fetchLivePrices(): Promise<Record<SupportedAsset, number>> {
  const now = Date.now();
  
  // Return cached prices if fresh
  if (now - priceCacheTime < PRICE_CACHE_TTL) {
    return priceCache;
  }
  
  try {
    const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    const tickers = data.result?.data || [];
    
    const tickerMap: Record<string, SupportedAsset> = {
      'BTC_USDT': 'BTC',
      'ETH_USDT': 'ETH',
      'SUI_USDT': 'SUI',
      'CRO_USDT': 'CRO',
    };
    
    for (const ticker of tickers) {
      const asset = tickerMap[ticker.i];
      if (asset && ticker.a) {
        priceCache[asset] = parseFloat(ticker.a);
      }
    }
    
    priceCacheTime = now;
    logger.info(`[CommunityPool] Prices updated: BTC=$${priceCache.BTC}, ETH=$${priceCache.ETH}`);
    
  } catch (error) {
    logger.warn('[CommunityPool] Price fetch failed, using cached:', error);
  }
  
  return priceCache;
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
 * Returns the number of shares received
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
  if (amountUSD < MIN_DEPOSIT_USD) {
    return {
      success: false,
      sharesReceived: 0,
      sharePrice: 0,
      newTotalShares: 0,
      ownershipPercentage: 0,
      error: `Minimum deposit is $${MIN_DEPOSIT_USD}`,
    };
  }
  
  try {
    const poolState = await getPoolState();
    const { totalValueUSD, sharePrice, allocations } = await calculatePoolNAV();
    
    // Calculate shares to issue
    const currentSharePrice = poolState.totalShares > 0 ? sharePrice : 1.0;
    const sharesReceived = amountUSD / currentSharePrice;
    
    // Update pool state
    poolState.totalValueUSD = totalValueUSD + amountUSD;
    poolState.totalShares += sharesReceived;
    poolState.sharePrice = poolState.totalValueUSD / poolState.totalShares;
    
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
      sharePrice: currentSharePrice,
      txHash,
    });
    
    await saveUserShares(userShares);
    
    // Record transaction
    await addPoolTransaction({
      type: 'DEPOSIT',
      walletAddress,
      amountUSD,
      shares: sharesReceived,
      sharePrice: currentSharePrice,
      timestamp: Date.now(),
      txHash,
    });
    
    logger.info(`[CommunityPool] Deposit: ${walletAddress} deposited $${amountUSD}, received ${sharesReceived.toFixed(4)} shares`);
    
    return {
      success: true,
      sharesReceived,
      sharePrice: currentSharePrice,
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
 * Returns proportional USD value
 */
export async function withdraw(
  walletAddress: string,
  sharesToBurn: number,
  txHash?: string
): Promise<{
  success: boolean;
  amountUSD: number;
  sharesBurned: number;
  sharePrice: number;
  remainingShares: number;
  error?: string;
}> {
  try {
    const userShares = await getUserShares(walletAddress);
    
    if (!userShares || userShares.shares < sharesToBurn) {
      return {
        success: false,
        amountUSD: 0,
        sharesBurned: 0,
        sharePrice: 0,
        remainingShares: userShares?.shares || 0,
        error: `Insufficient shares. You have ${userShares?.shares.toFixed(4) || 0} shares`,
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
    const { totalValueUSD, sharePrice } = await calculatePoolNAV();
    
    // Calculate USD amount for shares
    const amountUSD = sharesToBurn * sharePrice;
    
    // Update pool state
    poolState.totalShares -= sharesToBurn;
    poolState.totalValueUSD = totalValueUSD - amountUSD;
    poolState.sharePrice = poolState.totalShares > 0 
      ? poolState.totalValueUSD / poolState.totalShares 
      : 1.0;
    
    // Reduce asset amounts proportionally
    const withdrawalPct = sharesToBurn / (poolState.totalShares + sharesToBurn);
    for (const asset of SUPPORTED_ASSETS) {
      const amountToReduce = poolState.allocations[asset].amount * withdrawalPct;
      poolState.allocations[asset].amount -= amountToReduce;
      poolState.allocations[asset].valueUSD = poolState.allocations[asset].amount * poolState.allocations[asset].price;
    }
    
    await savePoolState(poolState);
    
    // Update user shares
    userShares.shares -= sharesToBurn;
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
  
  // Performance calculation (simplified - would need historical data)
  const performance = {
    day: 0.5, // Placeholder
    week: 2.1,
    month: 8.3,
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
