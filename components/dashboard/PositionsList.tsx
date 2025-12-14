'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';

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
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch real data from API
    setTimeout(() => {
      setPositions([
        {
          id: '1',
          asset: 'BTC-PERP',
          type: 'SHORT',
          size: 0.5,
          entryPrice: 42000,
          currentPrice: 41500,
          pnl: 250,
          pnlPercent: 1.19,
          leverage: 5,
        },
        {
          id: '2',
          asset: 'ETH-PERP',
          type: 'LONG',
          size: 2.5,
          entryPrice: 2200,
          currentPrice: 2250,
          pnl: 125,
          pnlPercent: 2.27,
          leverage: 3,
        },
      ]);
      setLoading(false);
    }, 1000);
  }, [address]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-96" />;
  }

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-2xl font-semibold">Open Positions</h2>
            <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-400 rounded-full border border-purple-500/30">
              Testnet Demo
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Example positions showing risk management capabilities
          </p>
        </div>
        <a 
          href="https://moonlander.io" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-sm text-blue-500 hover:text-blue-400 flex items-center space-x-1"
        >
          <span>View on Moonlander</span>
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
