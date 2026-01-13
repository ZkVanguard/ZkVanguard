'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { dedupedFetch } from '@/lib/utils/request-deduplication';
import { cache } from '@/lib/utils/cache';

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
  const [positionsData, setPositionsData] = useState<PositionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPositions = useCallback(async (isBackgroundRefresh = false) => {
    if (!address) {
      setPositionsData(null);
      return;
    }

    // Debounce: prevent fetching more than once per 5 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 5000 && !isBackgroundRefresh) {
      console.log('⏭️ [PositionsContext] Skipping fetch - too soon after last request');
      return;
    }

    // Check cache first (30s TTL)
    const cacheKey = `positions-${address}`;
    const cached = cache.get<PositionsData>(cacheKey);
    if (cached && !isBackgroundRefresh) {
      console.log('⚡ [PositionsContext] Using cached positions');
      setPositionsData(cached);
      return;
    }

    // Only show loading state for initial fetch, not background refreshes
    if (!isBackgroundRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      console.log(`🔄 [PositionsContext] Fetching positions for ${address} (deduped)`);
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

      console.log(`✅ [PositionsContext] Loaded ${data.positions?.length || 0} positions, total: $${data.totalValue?.toFixed(2)}`);
      setPositionsData(data);
      
      // Cache for 30 seconds
      cache.set(cacheKey, data);
    } catch (err) {
      console.error('❌ [PositionsContext] Error fetching positions:', err);
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
        console.log('👁️ [PositionsContext] Page visible - refreshing positions');
        fetchPositions(true);
      }
    };

    // Refresh when page becomes visible
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Longer polling interval: 2 minutes instead of 1 minute
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        console.log('⏰ [PositionsContext] Auto-refreshing positions...');
        fetchPositions(true);
      }
    }, 120000); // 2 minutes

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [address, fetchPositions]);

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

    return {
      topAssets,
      totalChange24h,
      weightedVolatility,
      sharpeRatio,
    };
  }, [positionsData]);

  const value: PositionsContextType = {
    positionsData,
    derived,
    loading,
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
