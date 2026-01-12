'use client';

import { useState, useEffect } from 'react';
import { DollarSign, RefreshCw, ChevronRight, TrendingUp, Shield } from 'lucide-react';
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
  address?: string;
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
      if (!address) {
        setLoading(false);
        return;
      }
      
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
          
          // Calculate basic health score based on portfolio metrics
          let calculatedHealth = 80; // Base healthy score
          
          // Adjust based on diversification (more assets = healthier)
          if (topAssets.length >= 5) calculatedHealth += 10;
          else if (topAssets.length >= 3) calculatedHealth += 5;
          
          // Adjust based on concentration (less concentration = healthier)
          if (topAssets[0] && topAssets[0].percentage < 50) calculatedHealth += 5;
          
          // Adjust based on active hedges
          if (activeHedgesCount > 0) calculatedHealth += 5;
          
          setData(prev => ({
            ...prev,
            totalValue: portfolioData.totalValue,
            positions: Number(portfolioCount) || 0,
            activeHedges: activeHedgesCount,
            healthScore: Math.min(calculatedHealth, 100), // Always show health score
            topAssets,
          }));
          setRecentHedgeCount(activeHedgesCount);
        }
      } catch (error) {
        console.error('Portfolio data fetch failed completely:', error);
        // Still show the UI with portfolio count even if market data fails
        setData(prev => ({
          ...prev,
          totalValue: 0,
          positions: Number(portfolioCount) || 0,
          activeHedges: 0,
          topAssets: [],
        }));
      } finally {
        setLoading(false);
      }
    }

    setLoading(countLoading);
    if (portfolioCount !== undefined) {
      setData(prev => ({
        ...prev,
        positions: Number(portfolioCount),
      }));
      fetchAIAnalysis();
    } else {
      setLoading(false);
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
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!address) {
    return (
      <div className="bg-white rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/5 p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-semibold text-[#1d1d1f] mb-2 tracking-[-0.02em]">Dashboard</h1>
            <p className="text-[15px] text-[#86868b] leading-[1.4]">Connect your wallet to view portfolio</p>
          </div>
          <div className="w-14 h-14 bg-[#f5f5f7] rounded-[18px] flex items-center justify-center">
            <DollarSign className="w-7 h-7 text-[#86868b]" strokeWidth={2} />
          </div>
        </div>
      </div>
    );
  }

  // Get health status label
  const getHealthLabel = (score: number) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'At Risk';
  };

  return (
    <div className="bg-white rounded-[16px] sm:rounded-[24px] shadow-sm border border-black/5">
      {/* Main Content - Single Card Layout */}
      <div className="p-4 sm:p-6">
        {/* Header Row - Stack on mobile */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#007AFF] rounded-[12px] sm:rounded-[14px] flex items-center justify-center shadow-[0_4px_12px_rgba(0,122,255,0.25)]">
                <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-white" strokeWidth={2.5} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.06em]">Portfolio</span>
                  {portfolioCount !== undefined && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#34C759]/10 rounded-full">
                      <span className="w-1.5 h-1.5 bg-[#34C759] rounded-full animate-pulse" />
                      <span className="text-[9px] font-bold text-[#34C759]">LIVE</span>
                    </span>
                  )}
                </div>
                <div className="text-[28px] sm:text-[32px] md:text-[40px] font-bold text-[#1d1d1f] leading-tight tracking-[-0.02em]">
                  {data.totalValue >= 1000000 
                    ? `$${(data.totalValue / 1000000).toFixed(2)}M`
                    : data.totalValue >= 1000 
                      ? `$${(data.totalValue / 1000).toFixed(2)}K`
                      : `$${data.totalValue.toFixed(2)}`
                  }
                </div>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              className="sm:hidden w-9 h-9 flex items-center justify-center bg-[#f5f5f7] active:bg-[#e8e8ed] rounded-full transition-all active:scale-95"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4 text-[#86868b]" strokeWidth={2} />
            </button>
          </div>
          <button
            onClick={() => refetch()}
            className="hidden sm:flex w-10 h-10 items-center justify-center bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-full transition-all active:scale-95"
            title="Refresh"
          >
            <RefreshCw className="w-[18px] h-[18px] text-[#86868b]" strokeWidth={2} />
          </button>
        </div>

        {/* Stats Row - Responsive Grid */}
        <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
          {/* Portfolios */}
          <button
            onClick={onNavigateToPositions}
            className="flex-1 group flex items-center justify-between p-3 sm:p-4 bg-[#f5f5f7] active:bg-[#e8e8ed] sm:hover:bg-[#e8e8ed] rounded-[14px] sm:rounded-[16px] transition-all active:scale-[0.98]"
          >
            <div>
              <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-1">Portfolios</div>
              <div className="text-[22px] sm:text-[28px] font-bold text-[#1d1d1f] leading-none">{data.positions}</div>
            </div>
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-[#c7c7cc] group-hover:text-[#007AFF] transition-colors" strokeWidth={2} />
          </button>

          {/* Hedges */}
          <button
            onClick={onNavigateToHedges}
            className="flex-1 group flex items-center justify-between p-3 sm:p-4 bg-[#f5f5f7] active:bg-[#e8e8ed] sm:hover:bg-[#e8e8ed] rounded-[14px] sm:rounded-[16px] transition-all active:scale-[0.98] relative"
          >
            {recentHedgeCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-[#34C759] rounded-full flex items-center justify-center text-[9px] sm:text-[10px] font-bold text-white shadow-sm">
                {recentHedgeCount}
              </span>
            )}
            <div>
              <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-1">Hedges</div>
              <div className="text-[22px] sm:text-[28px] font-bold text-[#34C759] leading-none">{data.activeHedges}</div>
            </div>
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-[#c7c7cc] group-hover:text-[#34C759] transition-colors" strokeWidth={2} />
          </button>

          {/* Health */}
          {data.healthScore && (
            <div className="col-span-2 sm:col-span-1 flex-1 p-3 sm:p-4 bg-gradient-to-br from-[#34C759]/10 to-[#34C759]/5 rounded-[14px] sm:rounded-[16px] border border-[#34C759]/10">
              <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-1">Health</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] sm:text-[28px] font-bold text-[#34C759] leading-none">{data.healthScore.toFixed(0)}%</span>
                <span className="text-[12px] sm:text-[13px] font-medium text-[#34C759]/70">{getHealthLabel(data.healthScore)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Holdings Section - Inline within same card */}
      {data.topAssets && data.topAssets.length > 0 && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px] sm:text-[13px] font-semibold text-[#86868b]">Holdings</span>
            <span className="text-[12px] sm:text-[13px] font-medium text-[#86868b]">{data.topAssets.length} assets</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {data.topAssets.map((asset, idx) => {
              const displayValue = asset.value >= 1000 
                ? `$${(asset.value / 1000).toFixed(1)}K` 
                : `$${asset.value.toFixed(2)}`;
              
              return (
                <div 
                  key={idx} 
                  className="flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 bg-[#f5f5f7] rounded-[10px] min-w-[140px] sm:min-w-[160px]"
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 bg-[#007AFF] rounded-[8px] flex items-center justify-center">
                    <span className="text-white text-[11px] sm:text-[12px] font-bold">{asset.symbol.slice(0, 2)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] sm:text-[15px] font-semibold text-[#1d1d1f] truncate">{asset.symbol}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] sm:text-[13px] text-[#86868b]">{displayValue}</span>
                      <span className="text-[10px] sm:text-[11px] font-medium text-[#007AFF]">{asset.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
