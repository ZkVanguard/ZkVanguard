'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';

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

interface PositionsContextType {
  positionsData: PositionsData | null;
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

  const fetchPositions = useCallback(async () => {
    if (!address) {
      setPositionsData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log(`🔄 [PositionsContext] Fetching positions for ${address} (single source of truth)`);
      const res = await fetch(`/api/positions?address=${address}`);
      
      if (!res.ok) {
        throw new Error(`Failed to fetch positions: ${res.status}`);
      }

      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      console.log(`✅ [PositionsContext] Loaded ${data.positions?.length || 0} positions, total: $${data.totalValue?.toFixed(2)}`);
      setPositionsData(data);
    } catch (err) {
      console.error('❌ [PositionsContext] Error fetching positions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
      setPositionsData(null);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Fetch on mount and when address changes
  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!address) return;

    const interval = setInterval(() => {
      console.log('⏰ [PositionsContext] Auto-refreshing positions...');
      fetchPositions();
    }, 30000);

    return () => clearInterval(interval);
  }, [address, fetchPositions]);

  const value: PositionsContextType = {
    positionsData,
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
