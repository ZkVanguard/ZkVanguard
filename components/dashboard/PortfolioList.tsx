'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { usePortfolio, usePortfolioAssets } from '../../lib/contracts/hooks';
import { formatEther } from 'viem';
import { RefreshCw } from 'lucide-react';

interface PortfolioCardProps {
  portfolioId: bigint;
}

export function PortfolioCard({ portfolioId }: PortfolioCardProps) {
  const { data: portfolio, isLoading, refetch } = usePortfolio(portfolioId);
  const { data: assets } = usePortfolioAssets(portfolioId);
  const { address } = useAccount();

  if (isLoading) {
    return (
      <div className="bg-white p-6 rounded-xl border border-[#E5E5EA] shadow-sm animate-pulse">
        <div className="h-24 bg-[#F5F5F7] rounded"></div>
      </div>
    );
  }

  if (!portfolio) {
    return null;
  }

  // Contract returns tuple: [owner, totalValue, targetYield, riskTolerance, lastRebalance, isActive]
  const [owner, totalValue, targetYield, riskTolerance, lastRebalance, isActive] = portfolio as [
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean
  ];
  const isOwner = address?.toLowerCase() === owner.toLowerCase();

  return (
    <div className="bg-white p-6 rounded-xl border border-[#E5E5EA] hover:border-[#007AFF]/30 transition-all duration-300 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xl font-bold text-[#1D1D1F]">Portfolio #{portfolioId.toString()}</h3>
            {isOwner && (
              <span className="px-2 py-1 bg-[#007AFF]/10 text-[#007AFF] text-xs rounded-full border border-[#007AFF]/30">
                Owned
              </span>
            )}
            {isActive && (
              <span className="px-2 py-1 bg-green-500/20 text-[#34C759] text-xs rounded-full border border-green-500/30">
                Active
              </span>
            )}
          </div>
          <p className="text-[#86868b] text-sm font-mono">
            {owner.slice(0, 6)}...{owner.slice(-4)}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-[#F5F5F7] rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4 text-[#86868b] hover:text-[#007AFF]" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#f5f5f7] p-3 rounded-lg">
          <div className="text-xs text-[#86868b] mb-1">Target Yield</div>
          <div className="text-lg font-bold text-[#34C759]">
            {(Number(targetYield) / 100).toFixed(2)}%
          </div>
        </div>

        <div className="bg-[#f5f5f7] p-3 rounded-lg">
          <div className="text-xs text-[#86868b] mb-1">Risk Tolerance</div>
          <div className="text-lg font-bold text-amber-400">
            {riskTolerance.toString()}%
          </div>
        </div>

        <div className="bg-[#f5f5f7] p-3 rounded-lg">
          <div className="text-xs text-[#86868b] mb-1">Total Value</div>
          <div className="text-lg font-bold text-[#1D1D1F]">
            {formatEther(totalValue)} CRO
          </div>
        </div>

        <div className="bg-[#f5f5f7] p-3 rounded-lg">
          <div className="text-xs text-[#86868b] mb-1">Assets</div>
          <div className="text-lg font-bold text-[#1D1D1F]">
            {assets?.length ?? 0}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[#e8e8ed]">
        <div className="text-xs text-[#86868b]">
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
        <h2 className="text-2xl font-bold text-[#1D1D1F]">On-Chain Portfolios</h2>
        <span className="text-sm text-[#86868b]">
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
        className="w-full px-4 py-2 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-lg font-semibold transition-colors"
      >
        Load More
      </button>
    </div>
  );
}
