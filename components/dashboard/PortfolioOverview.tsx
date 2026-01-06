'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Activity, RefreshCw, Brain } from 'lucide-react';
import { usePortfolioCount } from '../../lib/contracts/hooks';
import { getCryptocomAIService } from '../../lib/ai/cryptocom-service';
import { getMarketDataService } from '../../lib/services/RealMarketDataService';
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

interface PortfolioOverviewProps {
  address: string;
  onNavigateToPositions?: () => void;
  onNavigateToHedges?: () => void;
}

export function PortfolioOverview({ address, onNavigateToPositions, onNavigateToHedges }: PortfolioOverviewProps) {
  const { data: portfolioCount, isLoading: countLoading, refetch } = usePortfolioCount();
  const [loading, setLoading] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [recentHedgeCount, setRecentHedgeCount] = useState(0);
  
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
        // Count active hedges from settlement history
        const settlements = localStorage.getItem('settlement_history');
        let activeHedgesCount = 0;
        if (settlements) {
          const settlementData = JSON.parse(settlements);
          activeHedgesCount = Object.values(settlementData).filter(
            (batch: any) => batch.type === 'hedge' && batch.status !== 'closed'
          ).length;
        }
        
        // Always use RealMarketDataService for portfolio data (real prices)
        const marketData = getMarketDataService();
        const portfolioData = await marketData.getPortfolioData(address);
        
        console.log('📊 [PortfolioOverview] Portfolio data:', portfolioData);
        
        // Calculate top assets with safety checks
        const topAssets = portfolioData.tokens
          .slice(0, 5)
          .map(t => ({
            symbol: t.symbol,
            value: t.usdValue || 0,
            percentage: portfolioData.totalValue > 0 
              ? ((t.usdValue || 0) / portfolioData.totalValue) * 100 
              : 0,
          }))
          .filter(asset => asset.value > 0); // Only show assets with value
        
        // Try AI service for health score and recommendations only
        try {
          const aiService = getCryptocomAIService();
          const analysis = await aiService.analyzePortfolio(address, { portfolioCount });
          setAiAnalysis(analysis);
          setData(prev => ({
            ...prev,
            totalValue: portfolioData.totalValue, // Always use real market data
            positions: Number(portfolioCount) || 0,
            healthScore: analysis.healthScore || 85, // AI-generated or default
            topAssets,
            activeHedges: activeHedgesCount,
          }));
          setRecentHedgeCount(activeHedgesCount);
        } catch (aiError) {
          console.warn('AI analysis failed, using real market data only:', aiError);
          
          setData(prev => ({
            ...prev,
            totalValue: portfolioData.totalValue,
            positions: Number(portfolioCount) || 0,
            activeHedges: activeHedgesCount,
            topAssets,
          }));
          setRecentHedgeCount(activeHedgesCount);
        }
      } catch (error) {
        console.error('Portfolio data fetch failed completely:', error);
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

    // Listen for hedge updates to refresh count
    const handleHedgeUpdate = () => {
      console.log('📊 [PortfolioOverview] Hedge updated, refreshing...');
      fetchAIAnalysis();
    };

    window.addEventListener('hedgeAdded', handleHedgeUpdate);
    
    return () => {
      window.removeEventListener('hedgeAdded', handleHedgeUpdate);
    };
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
          <button
            onClick={onNavigateToPositions}
            className="w-full flex items-center justify-between p-3 bg-gray-900 rounded-lg hover:bg-gray-800 hover:border-cyan-500/50 border border-transparent transition-all group cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <DollarSign className="w-5 h-5 text-blue-500 group-hover:text-cyan-400 transition-colors" />
              <span className="text-sm text-gray-400 group-hover:text-white transition-colors">Your Portfolios</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold group-hover:text-cyan-400 transition-colors">{data.positions}</span>
              <span className="text-xs text-gray-500 group-hover:text-cyan-400 transition-opacity opacity-0 group-hover:opacity-100">→</span>
            </div>
          </button>
          <button
            onClick={onNavigateToHedges}
            className="w-full flex items-center justify-between p-3 bg-gray-900 rounded-lg hover:bg-gray-800 hover:border-emerald-500/50 border border-transparent transition-all group cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-green-500 group-hover:text-emerald-400 transition-colors" />
              <span className="text-sm text-gray-400 group-hover:text-white transition-colors">Active Hedges</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-semibold text-emerald-400 group-hover:text-emerald-300 transition-colors">{data.activeHedges}</span>
              {recentHedgeCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full animate-pulse">
                  NEW
                </span>
              )}
              <span className="text-xs text-gray-500 group-hover:text-emerald-400 transition-opacity opacity-0 group-hover:opacity-100">→</span>
            </div>
          </button>
        </div>
      </div>
      
      {/* Top Assets */}
      {data.topAssets && data.topAssets.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-700">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Top Assets</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.topAssets.map((asset, idx) => {
              const valueInK = asset.value / 1000;
              const displayValue = valueInK >= 0.1 
                ? `$${valueInK.toFixed(1)}K` 
                : asset.value >= 1 
                  ? `$${asset.value.toFixed(2)}`
                  : `$${asset.value.toFixed(4)}`;
              
              return (
                <div key={idx} className="p-3 bg-gray-900 rounded-lg">
                  <div className="text-xs text-gray-400">{asset.symbol}</div>
                  <div className="text-lg font-semibold">{displayValue}</div>
                  <div className="text-xs text-cyan-400">{asset.percentage.toFixed(1)}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
