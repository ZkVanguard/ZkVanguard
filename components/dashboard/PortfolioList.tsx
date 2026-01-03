'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { usePortfolio } from '../../lib/contracts/hooks';
import { formatEther } from 'viem';
import { RefreshCw } from 'lucide-react';

interface PortfolioCardProps {
  portfolioId: bigint;
}

export function PortfolioCard({ portfolioId }: PortfolioCardProps) {
  const { data: portfolio, isLoading, refetch } = usePortfolio(portfolioId);
  const { address } = useAccount();

  if (isLoading) {
    return (
      <div className="glass p-6 rounded-xl border border-white/10 animate-pulse">
        <div className="h-24 bg-gray-700 rounded"></div>
      </div>
    );
  }

  if (!portfolio) {
    return null;
  }

  const { owner, totalValue, targetYield, riskTolerance, lastRebalance, isActive, assets } = portfolio;
  const isOwner = address?.toLowerCase() === owner.toLowerCase();

  return (
    <div className="glass p-6 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xl font-bold">Portfolio #{portfolioId.toString()}</h3>
            {isOwner && (
              <span className="px-2 py-1 bg-cyan-500/20 text-cyan-400 text-xs rounded-full border border-cyan-500/30">
                Owned
              </span>
            )}
            {isActive && (
              <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30">
                Active
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm font-mono">
            {owner.slice(0, 6)}...{owner.slice(-4)}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4 text-gray-400 hover:text-cyan-400" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 p-3 rounded-lg">
          <div className="text-xs text-gray-400 mb-1">Target Yield</div>
          <div className="text-lg font-bold text-emerald-400">
            {(Number(targetYield) / 100).toFixed(2)}%
          </div>
        </div>

        <div className="bg-gray-900 p-3 rounded-lg">
          <div className="text-xs text-gray-400 mb-1">Risk Tolerance</div>
          <div className="text-lg font-bold text-amber-400">
            {riskTolerance.toString()}%
          </div>
        </div>

        <div className="bg-gray-900 p-3 rounded-lg">
          <div className="text-xs text-gray-400 mb-1">Total Value</div>
          <div className="text-lg font-bold">
            {formatEther(totalValue)} CRO
          </div>
        </div>

        <div className="bg-gray-900 p-3 rounded-lg">
          <div className="text-xs text-gray-400 mb-1">Assets</div>
          <div className="text-lg font-bold">
            {assets.length}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="text-xs text-gray-500">
          Last Rebalance: {new Date(Number(lastRebalance) * 1000).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

export function PortfolioList() {
  const [viewCount, setViewCount] = useState(3);

  // Generate array of portfolio IDs to display
  const portfolioIds = Array.from({ length: viewCount }, (_, i) => BigInt(i));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold gradient-text">On-Chain Portfolios</h2>
        <span className="text-sm text-gray-400">
          Showing latest {viewCount} portfolios
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {portfolioIds.map((id) => (
          <PortfolioCard key={id.toString()} portfolioId={id} />
        ))}
      </div>

      <button
        onClick={() => setViewCount(prev => prev + 5)}
        className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-colors"
      >
        Load More
      </button>
    </div>
  );
}
