'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Activity, RefreshCw, Brain } from 'lucide-react';
import { usePortfolioCount } from '../../lib/contracts/hooks';
import { getCryptocomAIService } from '../../lib/ai/cryptocom-service';
import type { PortfolioAnalysis } from '../../lib/ai/cryptocom-service';

interface PortfolioData {
  totalValue: number;
  dailyChange: number;
  dailyChangePercent: number;
  positions: number;
  activeHedges: number;
  healthScore?: number;
  topAssets?: Array<{
    symbol: string;
    value: number;
    percentage: number;
  }>;
}

export function PortfolioOverview({ address }: { address: string }) {
  const { data: portfolioCount, isLoading: countLoading, refetch } = usePortfolioCount();
  const [loading, setLoading] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState<PortfolioAnalysis | null>(null);
  
  // Real on-chain portfolio data only - no demo fallbacks
  const [data, setData] = useState<PortfolioData>({
    totalValue: 0, // Will be populated from real contract data
    dailyChange: 0,
    dailyChangePercent: 0,
    positions: 0, // Read from contract
    activeHedges: 0,
  });

  useEffect(() => {
    async function fetchAIAnalysis() {
      try {
        const aiService = getCryptocomAIService();
        const analysis = await aiService.analyzePortfolio(address, { portfolioCount });
        
        setAiAnalysis(analysis);
        // Use ONLY real on-chain data - no demo fallbacks
        setData(prev => ({
          ...prev,
          totalValue: analysis.totalValue || 0,
          positions: Number(portfolioCount) || 0,
          healthScore: analysis.healthScore,
          topAssets: analysis.topAssets,
        }));
      } catch (error) {
        console.error('AI analysis failed:', error);
      }
    }

    setLoading(countLoading);
    if (portfolioCount !== undefined) {
      setData(prev => ({
        ...prev,
        positions: Number(portfolioCount),
      }));
      fetchAIAnalysis();
    }
  }, [portfolioCount, countLoading, address]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-64" />;
  }

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
          <div className="text-sm text-gray-400 mb-2">Total Portfolio Value</div>
          <div className="text-4xl font-bold mb-2">
            ${data.totalValue ? (data.totalValue / 1000000).toFixed(2) : '0.00'}M
          </div>
          <div className="text-gray-400 text-sm">
            {portfolioCount !== undefined ? portfolioCount.toString() : '0'} portfolios on-chain
            {data.healthScore && (
              <span className="ml-2 text-green-400">• Health: {data.healthScore.toFixed(0)}%</span>
            )}
          </div>
          {aiAnalysis && (
            <div className="mt-3 flex items-center gap-2 text-xs text-cyan-400">
              <Brain className="w-4 h-4" />
              <span>AI-Powered Analysis</span>
            </div>
          )}
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
      
      {/* Top Assets */}
      {data.topAssets && data.topAssets.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-700">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Top Assets</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.topAssets.map((asset, idx) => (
              <div key={idx} className="p-3 bg-gray-900 rounded-lg">
                <div className="text-xs text-gray-400">{asset.symbol}</div>
                <div className="text-lg font-semibold">${(asset.value / 1000).toFixed(1)}K</div>
                <div className="text-xs text-cyan-400">{asset.percentage}%</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
