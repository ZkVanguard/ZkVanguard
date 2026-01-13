'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { dedupedFetch } from '@/lib/utils/request-deduplication';
import { cache } from '@/lib/utils/cache';
import { useUserPortfolios } from '@/lib/contracts/hooks';

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
  const lastFetchRef = useRef<number>(0);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPositions = useCallback(async (isBackgroundRefresh = false) => {
    if (!address) {
      setPositionsData(null);
      return;
    }

    // Check cache first (30s TTL) - show immediately, refresh in background
    const cacheKey = `positions-${address}`;
    const cached = cache.get<PositionsData>(cacheKey);
    
    // OPTIMIZATION: Show cached data immediately if available (stale-while-revalidate)
    if (cached) {
      console.log('⚡ [PositionsContext] Using cached positions (will refresh in background)');
      setPositionsData(cached);
      setLoading(false);
      
      // Check if cache is fresh enough (< 30s), skip refresh if so
      const now = Date.now();
      if (now - lastFetchRef.current < 30000 && !isBackgroundRefresh) {
        console.log('⏭️ [PositionsContext] Cache is fresh, skipping background refresh');
        return;
      }
      
      // Continue to fetch fresh data in background
      isBackgroundRefresh = true;
    }

    // Debounce: prevent fetching more than once per 1 second (reduced from 2s)
    const now = Date.now();
    if (now - lastFetchRef.current < 1000 && !isBackgroundRefresh) {
      console.log('⏭️ [PositionsContext] Skipping fetch - too soon after last request');
      return;
    }

    // Only show loading state for initial fetch without cache
    if (!isBackgroundRefresh && !cached) {
      setLoading(true);
    }
    setError(null);

    try {
      console.log(`🔄 [PositionsContext] Fetching positions for ${address} (deduped)`);
      console.log(`📊 [PositionsContext] Loading: CRO, devUSDC, WCRO balances...`);
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
      console.log(`📊 [PositionsContext] Positions:`, data.positions?.map((p: any) => `${p.symbol}: $${p.balanceUSD}`).join(', '));
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

    // Count active hedges from localStorage
    let activeHedgesCount = 0;
    try {
      const settlements = localStorage.getItem('settlement_history');
      if (settlements) {
        const settlementData = JSON.parse(settlements);
        activeHedgesCount = Object.values(settlementData).filter(
          (batch: any) => batch.type === 'hedge' && batch.status !== 'closed'
        ).length;
      }
    } catch (err) {
      console.error('[PositionsContext] Error counting hedges:', err);
    }

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
  }, [positionsData, userPortfolioCount]);

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
