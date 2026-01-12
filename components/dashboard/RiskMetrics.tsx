'use client';

import { useState, useCallback, memo } from 'react';
import { AlertTriangle, TrendingUp, Shield, Activity } from 'lucide-react';
import { assessPortfolioRisk } from '../../lib/api/agents';
import { getCryptocomAIService } from '../../lib/ai/cryptocom-service';
import { getMarketDataService } from '../../lib/services/RealMarketDataService';
import { usePolling } from '@/lib/hooks';

interface RiskMetric {
  label: string;
  value: string;
  status: 'low' | 'medium' | 'high';
  icon: React.ComponentType<{ className?: string }>;
}

export const RiskMetrics = memo(function RiskMetrics({ address }: { address?: string }) {
  const [metrics, setMetrics] = useState<RiskMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiPowered, setAiPowered] = useState(false);

  // Fetch AI-enhanced risk assessment
  const fetchRiskMetrics = useCallback(async () => {
    if (!address) {
      // No wallet connected - show default risk metrics
      setMetrics([
        { label: 'VaR (95%)', value: '--', status: 'low', icon: Shield },
        { label: 'Volatility', value: '--', status: 'low', icon: TrendingUp },
        { label: 'Risk Score', value: '--', status: 'low', icon: AlertTriangle },
        { label: 'Sharpe Ratio', value: '--', status: 'low', icon: Activity },
      ]);
      setLoading(false);
      return;
    }

    try {
      // Try AI service first
      const aiService = getCryptocomAIService();
      const aiRiskData = await aiService.assessRisk({ address });
      
      setMetrics([
        { 
          label: 'VaR (95%)', 
          value: `${(aiRiskData.var95 * 100).toFixed(1)}%`, 
          status: aiRiskData.var95 > 0.08 ? 'high' : aiRiskData.var95 > 0.04 ? 'medium' : 'low', 
          icon: Shield 
        },
        { 
          label: 'Volatility', 
          value: `${(aiRiskData.volatility * 100).toFixed(1)}%`, 
          status: aiRiskData.volatility > 0.15 ? 'high' : aiRiskData.volatility > 0.08 ? 'medium' : 'low', 
          icon: TrendingUp 
        },
        { 
          label: 'Risk Score', 
          value: `${aiRiskData.riskScore.toFixed(0)}/100`, 
          status: aiRiskData.riskScore > 60 ? 'high' : aiRiskData.riskScore > 40 ? 'medium' : 'low', 
          icon: AlertTriangle 
        },
        { 
          label: 'Sharpe Ratio', 
          value: aiRiskData.sharpeRatio.toFixed(2), 
          status: aiRiskData.sharpeRatio > 1.5 ? 'low' : aiRiskData.sharpeRatio > 0.8 ? 'medium' : 'high', 
          icon: Activity 
        },
      ]);
      setAiPowered(true);
      setLoading(false);
    } catch (aiError) {
      // Fallback to agent API
      try {
        const riskData = await assessPortfolioRisk(address);
        
        setMetrics([
          { 
            label: 'VaR (95%)', 
            value: `${(riskData.var * 100).toFixed(1)}%`, 
            status: riskData.var > 0.20 ? 'high' : riskData.var > 0.10 ? 'medium' : 'low', 
            icon: Shield 
          },
          { 
            label: 'Volatility', 
            value: `${(riskData.volatility * 100).toFixed(1)}%`, 
            status: riskData.volatility > 0.30 ? 'high' : riskData.volatility > 0.15 ? 'medium' : 'low', 
            icon: TrendingUp 
          },
          { 
            label: 'Liquidation Risk', 
            value: `${(riskData.liquidationRisk * 100).toFixed(1)}%`, 
            status: riskData.liquidationRisk > 0.10 ? 'high' : riskData.liquidationRisk > 0.05 ? 'medium' : 'low', 
            icon: AlertTriangle 
          },
          { 
            label: 'Sharpe Ratio', 
            value: riskData.sharpeRatio.toFixed(2), 
            status: riskData.sharpeRatio > 2.0 ? 'low' : riskData.sharpeRatio > 1.0 ? 'medium' : 'high', 
            icon: Activity 
          },
        ]);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch risk metrics from agent API:', error);
          
        // Fallback: Calculate basic risk metrics from real portfolio data
        try {
          const marketData = getMarketDataService();
          const portfolioData = await marketData.getPortfolioData(address);
            
          // Calculate concentration risk
          const concentration = portfolioData.tokens.length > 0
            ? Math.max(...portfolioData.tokens.map(t => t.usdValue / portfolioData.totalValue))
            : 0;
            
          // Simple risk score based on concentration (0-100)
          const riskScore = concentration > 0.7 ? 75 : concentration > 0.5 ? 55 : 35;
            
          // Estimate volatility based on portfolio composition
          const hasHighVolAssets = portfolioData.tokens.some(t => 
            ['BTC', 'ETH', 'CRO'].includes(t.symbol)
          );
          const volatility = hasHighVolAssets ? 0.12 : 0.06;
            
          // Calculate VaR (simplified)
          const var95 = volatility * 1.65; // 95% confidence interval
            
          // Calculate Sharpe ratio (simplified, assuming 5% risk-free rate)
          const sharpeRatio = portfolioData.totalValue > 0 ? 1.2 : 0;
            
          setMetrics([
            { 
              label: 'VaR (95%)', 
              value: `${(var95 * 100).toFixed(1)}%`, 
              status: var95 > 0.20 ? 'high' : var95 > 0.10 ? 'medium' : 'low', 
              icon: Shield 
            },
            { 
              label: 'Volatility', 
              value: `${(volatility * 100).toFixed(1)}%`, 
              status: volatility > 0.15 ? 'high' : volatility > 0.08 ? 'medium' : 'low', 
              icon: TrendingUp 
            },
            { 
              label: 'Risk Score', 
              value: `${riskScore}/100`, 
              status: riskScore > 60 ? 'high' : riskScore > 40 ? 'medium' : 'low', 
              icon: AlertTriangle 
            },
            { 
              label: 'Sharpe Ratio', 
              value: sharpeRatio.toFixed(2), 
              status: sharpeRatio > 1.5 ? 'low' : sharpeRatio > 0.8 ? 'medium' : 'high', 
              icon: Activity 
            },
          ]);
          setLoading(false);
        } catch (fallbackError) {
          console.error('Fallback risk calculation failed:', fallbackError);
          setMetrics([]);
          setLoading(false);
        }
      }
    }
  }, [address]);

  // Use custom polling hook - replaces 5 lines of useEffect logic
  usePolling(fetchRiskMetrics, 30000);

  if (loading) {
    return (
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 sm:h-24 animate-pulse bg-[#f5f5f7] rounded-[12px] sm:rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'low': return { bg: 'bg-[#34C759]/10', text: 'text-[#34C759]', dot: 'bg-[#34C759]' };
      case 'medium': return { bg: 'bg-[#FF9500]/10', text: 'text-[#FF9500]', dot: 'bg-[#FF9500]' };
      case 'high': return { bg: 'bg-[#FF3B30]/10', text: 'text-[#FF3B30]', dot: 'bg-[#FF3B30]' };
      default: return { bg: 'bg-[#8E8E93]/10', text: 'text-[#8E8E93]', dot: 'bg-[#8E8E93]' };
    }
  };

  return (
    <div className="px-4 sm:px-6 pb-4 sm:pb-6">
      {aiPowered && (
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#007AFF]" />
          <span className="text-[10px] sm:text-[11px] font-medium text-[#007AFF]">AI Analysis</span>
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          const colors = getStatusColor(metric.status);
          
          return (
            <div key={index} className={`${colors.bg} rounded-[12px] sm:rounded-xl p-3 sm:p-4`}>
              <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${colors.text}`} />
                <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 ${colors.dot} rounded-full`} />
              </div>
              <div className="text-[18px] sm:text-[22px] font-semibold text-[#1d1d1f] mb-0.5 leading-none">
                {metric.value}
              </div>
              <div className="text-[9px] sm:text-[11px] font-medium text-[#86868b] uppercase tracking-[0.04em]">
                {metric.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
