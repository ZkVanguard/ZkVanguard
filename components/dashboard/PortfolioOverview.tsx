'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity, RefreshCw } from 'lucide-react';
import { usePortfolioCount, usePortfolio } from '@/lib/contracts/hooks';
import { formatEther } from 'viem';

interface PortfolioData {
  totalValue: number;
  dailyChange: number;
  dailyChangePercent: number;
  positions: number;
  activeHedges: number;
}

export function PortfolioOverview({ address }: { address: string }) {
  const { data: portfolioCount, isLoading: countLoading, refetch } = usePortfolioCount();
  const [loading, setLoading] = useState(true);
  
  // Demo data for UI (since portfolios might be empty)
  const [data, setData] = useState<PortfolioData>({
    totalValue: 0,
    dailyChange: 0,
    dailyChangePercent: 0,
    positions: 0,
    activeHedges: 0,
  });

  useEffect(() => {
    setLoading(countLoading);
    if (portfolioCount !== undefined) {
      setData(prev => ({
        ...prev,
        positions: Number(portfolioCount),
      }));
    }
  }, [portfolioCount, countLoading]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-64" />;
  }

  const isPositive = data.dailyChange >= 0;

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center space-x-2">
            <span>Portfolio Overview</span>
            {portfolioCount !== undefined && (
              <span className="text-xs px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded-full border border-cyan-500/30">
                Live Data
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-2">
            Reading from Cronos Testnet • On-chain portfolio data
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title="Refresh data"
        >
          <RefreshCw className="w-5 h-5 text-gray-400 hover:text-cyan-400" />
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Value */}
        <div className="col-span-2">
          <div className="text-sm text-gray-400 mb-2">On-Chain Portfolios</div>
          <div className="text-4xl font-bold mb-2">
            {portfolioCount !== undefined ? portfolioCount.toString() : '...'}
          </div>
          <div className="text-gray-400 text-sm">
            Total portfolios created on smart contract
          </div>
        </div>

        {/* Quick Stats */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center space-x-2">
              <DollarSign className="w-5 h-5 text-blue-500" />
              <span className="text-sm text-gray-400">Your Portfolios</span>
            </div>
            <span className="text-lg font-semibold">{data.positions}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-green-500" />
              <span className="text-sm text-gray-400">Contract Status</span>
            </div>
            <span className="text-lg font-semibold text-green-400">Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}
