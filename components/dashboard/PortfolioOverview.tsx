'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';

interface PortfolioData {
  totalValue: number;
  dailyChange: number;
  dailyChangePercent: number;
  positions: number;
  activeHedges: number;
}

export function PortfolioOverview({ address }: { address: string }) {
  const [data, setData] = useState<PortfolioData>({
    totalValue: 0,
    dailyChange: 0,
    dailyChangePercent: 0,
    positions: 0,
    activeHedges: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch real data from API
    setTimeout(() => {
      setData({
        totalValue: 125000,
        dailyChange: 2500,
        dailyChangePercent: 2.04,
        positions: 8,
        activeHedges: 3,
      });
      setLoading(false);
    }, 1000);
  }, [address]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-64" />;
  }

  const isPositive = data.dailyChange >= 0;

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold flex items-center space-x-2">
          <span>Portfolio Overview</span>
          <span className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded-full border border-yellow-500/30">
            Demo Data
          </span>
        </h2>
        <p className="text-xs text-gray-500 mt-2">
          Simulated portfolio showing platform capabilities • Real testnet infrastructure
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Value */}
        <div className="col-span-2">
          <div className="text-sm text-gray-400 mb-2">Total Portfolio Value</div>
          <div className="text-4xl font-bold mb-2">
            ${data.totalValue.toLocaleString()}
          </div>
          <div className={`flex items-center space-x-2 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            <span className="font-medium">
              ${Math.abs(data.dailyChange).toLocaleString()} ({data.dailyChangePercent}%)
            </span>
            <span className="text-gray-400 text-sm">24h</span>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center space-x-2">
              <DollarSign className="w-5 h-5 text-blue-500" />
              <span className="text-sm text-gray-400">Positions</span>
            </div>
            <span className="text-lg font-semibold">{data.positions}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg">
            <div className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-green-500" />
              <span className="text-sm text-gray-400">Active Hedges</span>
            </div>
            <span className="text-lg font-semibold">{data.activeHedges}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
