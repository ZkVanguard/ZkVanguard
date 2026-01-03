'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, ExternalLink, Wallet } from 'lucide-react';
import { useAccount } from 'wagmi';
import { usePortfolioCount } from '../../lib/contracts/hooks';

interface Position {
  id: string;
  asset: string;
  type: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  leverage: number;
}

export function PositionsList({ address }: { address: string }) {
  const { isConnected } = useAccount();
  const { data: portfolioCount } = usePortfolioCount();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch real positions from on-chain portfolios only
    async function fetchPositions() {
      try {
        // TODO: Implement real on-chain position fetching
        // For now, show empty state until positions are added
        setPositions([]);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch positions:', error);
        setPositions([]);
        setLoading(false);
      }
    }
    
    fetchPositions();
  }, [address, portfolioCount]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-96 border border-gray-700" />;
  }

  if (!isConnected) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="text-center py-12">
          <Wallet className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
          <p className="text-gray-400">
            Connect your wallet to view positions from your on-chain portfolios
          </p>
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold">Portfolio Positions</h2>
          <p className="text-xs text-gray-500 mt-1">
            Positions from your on-chain portfolios • {portfolioCount?.toString() || '0'} portfolios found
          </p>
        </div>
        <div className="text-center py-12">
          <TrendingUp className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Positions Yet</h3>
          <p className="text-gray-400 mb-4">
            Create a portfolio and deposit assets to see positions here
          </p>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="px-6 py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 rounded-lg font-semibold transition-colors"
          >
            Create Portfolio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-2xl font-semibold">Portfolio Positions</h2>
            <span className="text-xs px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded-full border border-cyan-500/30">
              Live Data
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Positions from your on-chain portfolios
          </p>
        </div>
        <a 
          href="https://moonlander.io" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-sm text-blue-500 hover:text-blue-400 flex items-center space-x-1"
        >
          <span>Trade on Moonlander</span>
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
              <th className="pb-3">Asset</th>
              <th className="pb-3">Type</th>
              <th className="pb-3">Size</th>
              <th className="pb-3">Entry</th>
              <th className="pb-3">Current</th>
              <th className="pb-3">PnL</th>
              <th className="pb-3">Leverage</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const isProfitable = position.pnl >= 0;
              return (
                <tr key={position.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="py-4 font-medium">{position.asset}</td>
                  <td className="py-4">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        position.type === 'LONG'
                          ? 'bg-green-500/20 text-green-500'
                          : 'bg-red-500/20 text-red-500'
                      }`}
                    >
                      {position.type}
                    </span>
                  </td>
                  <td className="py-4">{position.size}</td>
                  <td className="py-4">${position.entryPrice.toLocaleString()}</td>
                  <td className="py-4">${position.currentPrice.toLocaleString()}</td>
                  <td className="py-4">
                    <div className={`flex items-center space-x-1 ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
                      {isProfitable ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      <span className="font-medium">
                        ${Math.abs(position.pnl).toLocaleString()} ({position.pnlPercent}%)
                      </span>
                    </div>
                  </td>
                  <td className="py-4">{position.leverage}x</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
