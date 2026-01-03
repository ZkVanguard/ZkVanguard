'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, Shield, Activity, Brain } from 'lucide-react';
import { assessPortfolioRisk } from '../../lib/api/agents';
import { getCryptocomAIService } from '../../lib/ai/cryptocom-service';

interface RiskMetric {
  label: string;
  value: string;
  status: 'low' | 'medium' | 'high';
  icon: React.ComponentType<{ className?: string }>;
}

export function RiskMetrics({ address }: { address: string }) {
  const [metrics, setMetrics] = useState<RiskMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiPowered, setAiPowered] = useState(false);

  useEffect(() => {
    // Fetch AI-enhanced risk assessment
    async function fetchRiskMetrics() {
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
          console.error('Failed to fetch risk metrics:', error);
          // Show empty state - no fallback demo data
          setMetrics([]);
          setLoading(false);
        }
      }
    }

    fetchRiskMetrics();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchRiskMetrics, 30000);
    return () => clearInterval(interval);
  }, [address]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-48" />;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'low': return 'text-green-500 bg-green-500/10';
      case 'medium': return 'text-yellow-500 bg-yellow-500/10';
      case 'high': return 'text-red-500 bg-red-500/10';
      default: return 'text-gray-500 bg-gray-500/10';
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Risk Metrics</h2>
        {aiPowered && (
          <div className="flex items-center gap-2 px-3 py-1 bg-cyan-500/10 rounded-full border border-cyan-500/30">
            <Brain className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-cyan-400">AI Analysis</span>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div key={index} className="p-4 bg-gray-900 rounded-lg">
              <div className={`inline-flex p-2 rounded-lg mb-2 ${getStatusColor(metric.status)}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="text-sm text-gray-400 mb-1">{metric.label}</div>
              <div className="text-xl font-semibold">{metric.value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
