'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { dedupedFetch } from '@/lib/utils/request-deduplication';
import { cache } from '@/lib/utils/cache';
import { useUserPortfolios } from '@/lib/contracts/hooks';
import { logger } from '@/lib/utils/logger';

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
}

interface PositionsContextType {
  positionsData: PositionsData | null;
  derived: DerivedData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const PositionsContext = createContext<PositionsContextType | undefined>(undefined);

export function PositionsProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { count: userPortfolioCount, isLoading: countLoading } = useUserPortfolios(address);
  const [positionsData, setPositionsData] = useState<PositionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeHedgesCount, setActiveHedgesCount] = useState<number>(0);
  const lastFetchRef = useRef<number>(0);
  const _fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      setPositionsData(data);
      
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

  // Reduced auto-refresh: Only refresh when user is actively viewing (page visible)
  // Increased interval to 2 minutes to reduce server load
  useEffect(() => {
    if (!address) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        logger.debug('Page visible - refreshing positions', { component: 'PositionsContext' });
        fetchPositions(true);
      }
    };

    // Refresh when page becomes visible
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Longer polling interval: 2 minutes instead of 1 minute
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        logger.debug('Auto-refreshing positions', { component: 'PositionsContext' });
        fetchPositions(true);
      }
    }, 120000); // 2 minutes

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [address, fetchPositions]);

  // Fetch active hedge count from database API (single source of truth)
  useEffect(() => {
    let isMounted = true;

    const fetchHedgeCount = async () => {
      try {
        const response = await fetch('/api/agents/hedging/pnl?summary=true');
        if (response.ok && isMounted) {
          const data = await response.json();
          if (data.success && data.summary && data.summary.details) {
            setActiveHedgesCount(data.summary.details.length);
          }
        }
      } catch (err) {
        logger.error('Error counting hedges from API', err instanceof Error ? err : undefined, { component: 'PositionsContext' });
      }
    };

    fetchHedgeCount();
    
    // Refresh hedge count every 30 seconds
    const interval = setInterval(fetchHedgeCount, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

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

    return {
      topAssets,
      totalChange24h,
      weightedVolatility,
      sharpeRatio,
      healthScore,
      riskScore,
      portfolioCount: userPortfolioCount,
      activeHedgesCount,
    };
  }, [positionsData, userPortfolioCount, activeHedgesCount]);

  const value: PositionsContextType = {
    positionsData,
    derived,
    loading: loading || countLoading,
    error,
    refetch: fetchPositions,
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
