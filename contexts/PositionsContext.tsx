'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, useTransition } from 'react';
import { useWallet } from '@/lib/hooks/useWallet';
import { dedupedFetch } from '@/lib/utils/request-deduplication';
import { cache } from '@/lib/utils/cache';
import { useUserPortfolios } from '@/lib/contracts/hooks';
import { logger } from '@/lib/utils/logger';
import { refreshCoordinator } from '@/lib/services/refresh-coordinator';

// Performance metrics from on-chain history API
interface PerformanceMetrics {
  currentValue: number;
  initialValue: number;
  highestValue: number;
  lowestValue: number;
  totalPnL: number;
  totalPnLPercentage: number;
  dailyPnL: number;
  dailyPnLPercentage: number;
  weeklyPnL: number;
  weeklyPnLPercentage: number;
  monthlyPnL: number;
  monthlyPnLPercentage: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
}

interface Position {
  symbol: string;
  balance: string;
  balanceUSD: string;
  price: string;
  change24h: number;
}

interface PositionsData {
  address: string;
  totalValue: number;
  positions: Position[];
  lastUpdated: number;
}

// Derived/computed data to avoid recalculation
interface DerivedData {
  topAssets: Array<{ symbol: string; value: number; percentage: number }>;
  totalChange24h: number;
  weightedVolatility: number;
  sharpeRatio: number;
  healthScore: number;
  riskScore: number;
  portfolioCount: number;
  activeHedgesCount: number;
  // PnL metrics
  pnl: {
    daily: number;
    dailyPercentage: number;
    weekly: number;
    weeklyPercentage: number;
    total: number;
    totalPercentage: number;
  };
}

interface PositionsContextType {
  positionsData: PositionsData | null;
  derived: DerivedData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  isPending: boolean; // True during transition updates
}

const PositionsContext = createContext<PositionsContextType | undefined>(undefined);

export function PositionsProvider({ children }: { children: React.ReactNode }) {
  const { address, evmAddress } = useWallet();
  // For EVM contract hooks, use EVM address specifically
  const { count: userPortfolioCount, isLoading: countLoading } = useUserPortfolios(evmAddress as `0x${string}` | undefined);
  const [positionsData, setPositionsData] = useState<PositionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeHedgesCount, setActiveHedgesCount] = useState<number>(0);
  const [pnlMetrics, setPnlMetrics] = useState<PerformanceMetrics | null>(null);
  const lastFetchRef = useRef<number>(0);
  const _fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // useTransition for smooth UI updates during data refresh
  const [isPending, startTransition] = useTransition();

  // Debug: Log when address changes
  useEffect(() => {
    logger.debug('Address changed', { component: 'PositionsContext', data: address || 'NOT CONNECTED' });
  }, [address]);

  const fetchPositions = useCallback(async (isBackgroundRefresh = false) => {
    if (!address) {
      logger.debug('No address, skipping fetch', { component: 'PositionsContext' });
      setPositionsData(null);
      return;
    }

    // Check cache first (45s TTL for more aggressive caching) - show immediately, refresh in background
    const cacheKey = `positions-${address}`;
    const cached = cache.get<PositionsData>(cacheKey);
    
    // OPTIMIZATION: Show cached data immediately if available (stale-while-revalidate)
    if (cached) {
      logger.debug('Using cached positions (will refresh in background)', { component: 'PositionsContext' });
      setPositionsData(cached);
      setLoading(false);
      
      // Check if cache is fresh enough (< 45s), skip refresh if so
      const now = Date.now();
      if (now - lastFetchRef.current < 45000 && !isBackgroundRefresh) {
        logger.debug('Cache is fresh, skipping background refresh', { component: 'PositionsContext' });
        return;
      }
      
      // Continue to fetch fresh data in background
      isBackgroundRefresh = true;
    }

    // Debounce: prevent fetching more than once per 2 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 2000 && !isBackgroundRefresh) {
      logger.debug('Skipping fetch - too soon after last request', { component: 'PositionsContext' });
      return;
    }

    // Only show loading state for initial fetch without cache
    if (!isBackgroundRefresh && !cached) {
      setLoading(true);
    }
    setError(null);

    try {
      logger.info('Fetching positions (deduped)', { component: 'PositionsContext', data: address });
      logger.debug('Loading: CRO, devUSDC, WCRO balances', { component: 'PositionsContext' });
      lastFetchRef.current = now;
      
      // Use deduped fetch to prevent duplicate requests
      const res = await dedupedFetch(`/api/positions?address=${address}`);
      
      if (!res.ok) {
        throw new Error(`Failed to fetch positions: ${res.status}`);
      }

      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      logger.info(`Loaded ${data.positions?.length || 0} positions, total: $${data.totalValue?.toFixed(2)}`, { component: 'PositionsContext' });
      logger.debug('Positions detail', { component: 'PositionsContext', data: data.positions?.map((p: Position) => `${p.symbol}: $${p.balanceUSD}`).join(', ') });
      
      // Use startTransition for smooth UI updates
      startTransition(() => {
        setPositionsData(data);
      });
      
      // Record snapshot via API (stores in PostgreSQL with real hedge PnL)
      if (data.totalValue > 0) {
        try {
          const snapshotRes = await fetch('/api/portfolio/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              address,
              totalValue: data.totalValue,
              positions: data.positions || [],
            }),
          });
          
          if (snapshotRes.ok) {
            const snapshotData = await snapshotRes.json();
            if (snapshotData.metrics) {
              // Update PnL metrics from API response (real on-chain data)
              setPnlMetrics({
                currentValue: data.totalValue,
                initialValue: snapshotData.metrics.initialValue || data.totalValue,
                highestValue: data.totalValue,
                lowestValue: data.totalValue,
                totalPnL: snapshotData.metrics.totalPnL || 0,
                totalPnLPercentage: snapshotData.metrics.totalPnLPercentage || 0,
                dailyPnL: snapshotData.metrics.dailyPnL || 0,
                dailyPnLPercentage: snapshotData.metrics.dailyPnLPercentage || 0,
                weeklyPnL: 0,
                weeklyPnLPercentage: 0,
                monthlyPnL: 0,
                monthlyPnLPercentage: 0,
                volatility: 0,
                sharpeRatio: 0,
                maxDrawdown: 0,
                winRate: 50,
              });
              
              // Note: hedge count is now sourced from on-chain API only (see fetchHedgeCount)
              // Do NOT override from snapshot DB data — it may be stale
            }
          }
        } catch (historyError) {
          logger.warn('Failed to record portfolio snapshot', { error: String(historyError) });
        }
      }
      
      // Cache for 45 seconds (increased from 30s)
      cache.set(cacheKey, data, 45000);
    } catch (err) {
      logger.error('Error fetching positions', err instanceof Error ? err : undefined, { component: 'PositionsContext' });
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
      // Only clear data on initial load errors, keep stale data on refresh errors
      if (!isBackgroundRefresh) {
        setPositionsData(null);
      }
    } finally {
      if (!isBackgroundRefresh) {
        setLoading(false);
      }
    }
  }, [address]);

  // Fetch on mount and when address changes
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Coordinates refresh timing with other components via centralized RefreshCoordinator
  // This prevents render storms from multiple components refreshing simultaneously
  useEffect(() => {
    if (!address) return;

    // Listen to centralized refresh coordinator
    const handleRefresh = () => {
      if (document.visibilityState === 'visible') {
        logger.debug('Coordinator triggered positions refresh', { component: 'PositionsContext' });
        fetchPositions(true);
      }
    };

    refreshCoordinator.on('refresh:positions', handleRefresh);

    // Also handle visibility changes for immediate refresh on tab focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        logger.debug('Page visible - refreshing positions', { component: 'PositionsContext' });
        fetchPositions(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      refreshCoordinator.off('refresh:positions', handleRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [address, fetchPositions]);

  // Fetch active hedge count from on-chain ZK hedge API
  // Architecture: DB-first (Neon cache) → RPC fallback (HedgeExecutor contract)
  // The /api/agents/hedging/onchain endpoint serves from DB cache (instant, no RPC)
  // and only falls back to on-chain RPC when the DB is empty.
  // ZK proxy wallet ownership is resolved via hedge_ownership table,
  // so gasless ZK hedges are correctly attributed to the user's wallet.
  useEffect(() => {
    if (!address) {
      setActiveHedgesCount(0);
      return;
    }

    let isMounted = true;
    let lastHedgeFetch = 0;

    const fetchHedgeCount = async (force = false) => {
      // Client-side debounce: skip if fetched within last 5s (unless forced by hedgeAdded event)
      const now = Date.now();
      if (!force && now - lastHedgeFetch < 5000) return;

      // Client-side cache: show cached count immediately, refresh in background
      const hedgeCacheKey = `hedge-count-${address}`;
      const cachedCount = cache.get<number>(hedgeCacheKey);
      if (cachedCount !== null && cachedCount !== undefined && !force) {
        setActiveHedgesCount(cachedCount);
        // If cache is fresh (< 30s), skip network call
        if (now - lastHedgeFetch < 30000) return;
      }

      try {
        lastHedgeFetch = now;
        // DB-first on-chain endpoint — same source as ActiveHedges component
        const response = await dedupedFetch(`/api/agents/hedging/onchain?stats=true&walletAddress=${address}`);
        if (response.ok && isMounted) {
          const data = await response.json();
          if (data.success && data.summary) {
            const count = data.summary.activeCount ?? data.summary.details?.length ?? 0;
            setActiveHedgesCount(count);
            // Cache for 30s (matches server-side DB cache TTL)
            cache.set(hedgeCacheKey, count, 30000);
          } else {
            setActiveHedgesCount(0);
            cache.set(hedgeCacheKey, 0, 30000);
          }
        }
      } catch (err) {
        logger.error('Error counting on-chain ZK hedges', err instanceof Error ? err : undefined, { component: 'PositionsContext' });
      }
    };

    fetchHedgeCount();
    
    // Refresh hedge count every 30 seconds (aligned with server-side DB cache TTL)
    const interval = setInterval(() => fetchHedgeCount(), 30000);

    // Listen for hedgeAdded events — force refresh bypassing client cache
    const handleHedgeAdded = () => {
      logger.debug('🔄 Hedge added event received, refreshing count...', { component: 'PositionsContext' });
      fetchHedgeCount(true);
    };
    window.addEventListener('hedgeAdded', handleHedgeAdded);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('hedgeAdded', handleHedgeAdded);
    };
  }, [address]);

  // Memoized derived data - calculated once when positions change
  const derived = useMemo<DerivedData | null>(() => {
    if (!positionsData || positionsData.positions.length === 0) return null;

    const { positions, totalValue } = positionsData;

    // Top 5 assets by value
    const topAssets = positions
      .map(p => ({
        symbol: p.symbol,
        value: parseFloat(p.balanceUSD || '0'),
        percentage: totalValue > 0 ? (parseFloat(p.balanceUSD || '0') / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Weighted 24h change
    const totalChange24h = totalValue > 0
      ? positions.reduce((acc, pos) => {
          const posValue = parseFloat(pos.balanceUSD || '0');
          const weight = posValue / totalValue;
          return acc + (pos.change24h * weight);
        }, 0)
      : 0;

    // Volatility estimates per asset type
    const volatilityMap: Record<string, number> = {
      'BTC': 0.45, 'WBTC': 0.45,
      'ETH': 0.50, 'WETH': 0.50,
      'CRO': 0.55, 'WCRO': 0.55,
      'SUI': 0.60,
      'USDC': 0.01, 'USDT': 0.01, 'DAI': 0.01,
    };

    // Weighted portfolio volatility
    const weightedVolatility = totalValue > 0
      ? positions.reduce((acc, pos) => {
          const weight = parseFloat(pos.balanceUSD || '0') / totalValue;
          const vol = volatilityMap[pos.symbol] || 0.30;
          return acc + (vol * weight);
        }, 0)
      : 0;

    // Sharpe ratio approximation (using 24h return and volatility)
    const riskFreeRate = 0.05 / 365; // ~5% annual / 365 days
    const dailyReturn = totalChange24h / 100;
    const sharpeRatio = weightedVolatility > 0
      ? (dailyReturn - riskFreeRate) / (weightedVolatility / Math.sqrt(365))
      : 0;

    // Calculate concentration (top asset percentage)
    const concentration = topAssets[0]?.percentage || 0;

    // Risk Score: (volatility × 50) + (concentration × 50)
    const riskScore = Math.round((weightedVolatility * 50) + (concentration / 2));

    // Health Score calculation
    let healthScore = 80; // Base healthy score
    
    // Adjust based on diversification (more assets = healthier)
    if (topAssets.length >= 5) healthScore += 10;
    else if (topAssets.length >= 3) healthScore += 5;
    
    // Adjust based on concentration (less concentration = healthier)
    if (concentration < 40) healthScore += 5;
    else if (concentration > 70) healthScore -= 10;
    
    // Adjust based on volatility (lower = healthier)
    if (weightedVolatility < 0.2) healthScore += 5;
    else if (weightedVolatility > 0.5) healthScore -= 5;
    
    // Adjust based on active hedges (protection = healthier)
    if (activeHedgesCount > 0) healthScore += 5;
    
    // Adjust based on Sharpe ratio (better risk-adjusted returns = healthier)
    if (sharpeRatio > 1.5) healthScore += 5;
    else if (sharpeRatio < 0) healthScore -= 5;
    
    healthScore = Math.max(0, Math.min(100, healthScore));

    // PnL metrics from history service
    const pnl = pnlMetrics ? {
      daily: pnlMetrics.dailyPnL,
      dailyPercentage: pnlMetrics.dailyPnLPercentage,
      weekly: pnlMetrics.weeklyPnL,
      weeklyPercentage: pnlMetrics.weeklyPnLPercentage,
      total: pnlMetrics.totalPnL,
      totalPercentage: pnlMetrics.totalPnLPercentage,
    } : {
      daily: 0,
      dailyPercentage: 0,
      weekly: 0,
      weeklyPercentage: 0,
      total: 0,
      totalPercentage: 0,
    };

    return {
      topAssets,
      totalChange24h,
      weightedVolatility,
      sharpeRatio,
      healthScore,
      riskScore,
      portfolioCount: userPortfolioCount,
      activeHedgesCount,
      pnl,
    };
  }, [positionsData, userPortfolioCount, activeHedgesCount, pnlMetrics]);

  const value: PositionsContextType = {
    positionsData,
    derived,
    loading: loading || countLoading,
    error,
    refetch: fetchPositions,
    isPending, // Smooth transition indicator
  };

  return (
    <PositionsContext.Provider value={value}>
      {children}
    </PositionsContext.Provider>
  );
}

export function usePositions() {
  const context = useContext(PositionsContext);
  if (context === undefined) {
    throw new Error('usePositions must be used within a PositionsProvider');
  }
  return context;
}
