'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { 
  Shield, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  AlertTriangle,
  BarChart2,
  Target,
  Zap,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolling } from '@/lib/hooks';
import { logger } from '@/lib/utils/logger';

interface RiskMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownDate: string | null;
  currentDrawdown: number;
  volatilityDaily: number;
  volatilityAnnualized: number;
  downsideVolatility: number;
  var95Daily: number;
  var95Weekly: number;
  cvar95: number;
  beta: number;
  alpha: number;
  treynorRatio: number;
  informationRatio: number;
  calmarRatio: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  returns7d: number;
  returns30d: number;
  returns90d: number;
  returnsYTD: number;
  returnsSinceInception: number;
  dataPoints: number;
  lastCalculated: string;
  insufficientData?: boolean;
  insufficientDataReason?: string;
}

interface RiskRating {
  rating: string;
  color: string;
  description: string;
}

interface RiskMetricsPanelProps {
  compact?: boolean;
}

// Color classes for metric values
const getMetricColor = (value: number, thresholds: { good: number; warning: number }, inverse = false) => {
  if (inverse) {
    if (value <= thresholds.good) return 'text-green-600 dark:text-green-400';
    if (value <= thresholds.warning) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  }
  if (value >= thresholds.good) return 'text-green-600 dark:text-green-400';
  if (value >= thresholds.warning) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
};

// Format percentage with sign
const formatPct = (value: number, showSign = true) => {
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

// Metric card component
const MetricCard = memo(function MetricCard({ 
  label, 
  value, 
  tooltip, 
  icon: Icon,
  color = 'text-gray-900 dark:text-white',
  subValue,
}: { 
  label: string; 
  value: string | number; 
  tooltip?: string;
  icon?: any;
  color?: string;
  subValue?: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <div 
      className="relative p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-gray-400" />}
          <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
          {tooltip && (
            <Info className="w-3 h-3 text-gray-400 cursor-help" />
          )}
        </div>
      </div>
      <p className={`text-lg font-bold mt-1 ${color}`}>{value}</p>
      {subValue && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subValue}</p>
      )}
      
      {/* Tooltip */}
      <AnimatePresence>
        {showTooltip && tooltip && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute z-50 bottom-full left-0 mb-2 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg max-w-xs"
          >
            {tooltip}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export const RiskMetricsPanel = memo(function RiskMetricsPanel({ compact = false }: RiskMetricsPanelProps) {
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [riskRating, setRiskRating] = useState<RiskRating | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!compact);
  const [error, setError] = useState<string | null>(null);
  
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/community-pool/risk-metrics');
      const json = await res.json();
      
      if (json.success) {
        setMetrics(json.metrics);
        setRiskRating(json.riskRating);
        setError(null);
      } else {
        setError(json.error);
      }
    } catch (err: any) {
      logger.error('[RiskMetrics] Fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);
  
  // Refresh every 5 minutes
  usePolling(fetchMetrics, 5 * 60 * 1000);
  
  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    );
  }
  
  if (error || !metrics) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4">
        <p className="text-red-500 text-sm">Failed to load risk metrics</p>
      </div>
    );
  }
  
  // Show message when insufficient data
  if (metrics.insufficientData) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-slate-700 to-slate-900 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-white" />
              <div>
                <h3 className="text-white font-semibold">Risk Analytics</h3>
                <p className="text-slate-300 text-xs">Institutional-grade risk metrics</p>
              </div>
            </div>
          </div>
        </div>
        <div className="p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
          <h4 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">
            Insufficient Performance Data
          </h4>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
            {metrics.insufficientDataReason || 'Risk metrics require historical share price data to calculate.'}
          </p>
          <div className="text-xs text-gray-500 dark:text-gray-500">
            Risk metrics will become available as the pool accumulates performance history with actual share price changes.
          </div>
        </div>
      </div>
    );
  }
  
  const riskColorClass = riskRating?.rating === 'Low' ? 'text-green-500' 
    : riskRating?.rating === 'Moderate' ? 'text-yellow-500' 
    : 'text-red-500';
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div 
        className="bg-gradient-to-r from-slate-700 to-slate-900 p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Risk Analytics</h2>
              <p className="text-xs text-gray-300">Institutional-grade risk metrics</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Risk Rating Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg">
              <AlertTriangle className={`w-4 h-4 ${riskColorClass}`} />
              <span className={`font-semibold ${riskColorClass}`}>
                {riskRating?.rating} Risk
              </span>
            </div>
            
            <button
              onClick={(e) => { e.stopPropagation(); fetchMetrics(); }}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="Refresh metrics"
            >
              <RefreshCw className="w-4 h-4 text-white" />
            </button>
            
            {expanded ? (
              <ChevronUp className="w-5 h-5 text-white" />
            ) : (
              <ChevronDown className="w-5 h-5 text-white" />
            )}
          </div>
        </div>
      </div>
      
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Key Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-900">
              <div className="bg-white dark:bg-gray-800 p-4 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Sharpe Ratio</p>
                <p className={`text-2xl font-bold ${getMetricColor(metrics.sharpeRatio, { good: 1.0, warning: 0.5 })}`}>
                  {metrics.sharpeRatio.toFixed(2)}
                </p>
                <p className="text-xs text-gray-400 mt-1">Risk-adjusted</p>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Max Drawdown</p>
                <p className={`text-2xl font-bold ${getMetricColor(metrics.maxDrawdown, { good: 10, warning: 25 }, true)}`}>
                  -{metrics.maxDrawdown.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400 mt-1">Peak to trough</p>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">VaR (95%)</p>
                <p className={`text-2xl font-bold ${getMetricColor(metrics.var95Daily, { good: 3, warning: 5 }, true)}`}>
                  -{metrics.var95Daily.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400 mt-1">Daily max loss</p>
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Win Rate</p>
                <p className={`text-2xl font-bold ${getMetricColor(metrics.winRate, { good: 55, warning: 45 })}`}>
                  {metrics.winRate.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400 mt-1">Daily returns</p>
              </div>
            </div>
            
            {/* Performance Returns */}
            <div className="p-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Performance Returns
              </h3>
              <div className="grid grid-cols-5 gap-2">
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">7D</p>
                  <p className={`font-bold ${metrics.returns7d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPct(metrics.returns7d)}
                  </p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">30D</p>
                  <p className={`font-bold ${metrics.returns30d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPct(metrics.returns30d)}
                  </p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">90D</p>
                  <p className={`font-bold ${metrics.returns90d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPct(metrics.returns90d)}
                  </p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">YTD</p>
                  <p className={`font-bold ${metrics.returnsYTD >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPct(metrics.returnsYTD)}
                  </p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400">All Time</p>
                  <p className={`font-bold ${metrics.returnsSinceInception >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPct(metrics.returnsSinceInception)}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Risk Metrics Grid */}
            <div className="p-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Risk Metrics
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard 
                  label="Sortino Ratio"
                  value={metrics.sortinoRatio.toFixed(2)}
                  tooltip="Risk-adjusted return using only downside volatility. Higher is better."
                  icon={Target}
                  color={getMetricColor(metrics.sortinoRatio, { good: 1.5, warning: 0.8 })}
                />
                <MetricCard 
                  label="Volatility (Ann.)"
                  value={`${metrics.volatilityAnnualized.toFixed(1)}%`}
                  tooltip="Annualized standard deviation of daily returns. Lower indicates more stable returns."
                  icon={Activity}
                  color={getMetricColor(metrics.volatilityAnnualized, { good: 25, warning: 40 }, true)}
                />
                <MetricCard 
                  label="Current Drawdown"
                  value={`-${metrics.currentDrawdown.toFixed(1)}%`}
                  tooltip="Current distance from all-time high NAV."
                  icon={TrendingDown}
                  color={getMetricColor(metrics.currentDrawdown, { good: 5, warning: 15 }, true)}
                />
                <MetricCard 
                  label="CVaR (95%)"
                  value={`-${metrics.cvar95.toFixed(1)}%`}
                  tooltip="Expected Shortfall - average loss when losses exceed VaR threshold."
                  icon={AlertTriangle}
                  color={getMetricColor(metrics.cvar95, { good: 4, warning: 7 }, true)}
                />
              </div>
            </div>
            
            {/* Market Exposure */}
            <div className="p-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <BarChart2 className="w-4 h-4" />
                Market Exposure (vs BTC Benchmark)
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard 
                  label="Beta"
                  value={metrics.beta.toFixed(2)}
                  tooltip="Sensitivity to benchmark movements. 1.0 = same as benchmark. <1 = lower volatility."
                  icon={Activity}
                  subValue={metrics.beta < 0.8 ? 'Defensive' : metrics.beta > 1.2 ? 'Aggressive' : 'Neutral'}
                />
                <MetricCard 
                  label="Alpha (Ann.)"
                  value={`${metrics.alpha >= 0 ? '+' : ''}${metrics.alpha.toFixed(1)}%`}
                  tooltip="Jensen's Alpha - excess return over CAPM expected return. Positive = outperforming."
                  icon={Zap}
                  color={metrics.alpha >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                />
                <MetricCard 
                  label="Treynor Ratio"
                  value={metrics.treynorRatio.toFixed(2)}
                  tooltip="Excess return per unit of systematic risk (beta). Higher is better."
                  icon={Target}
                  color={getMetricColor(metrics.treynorRatio, { good: 0.1, warning: 0.05 })}
                />
                <MetricCard 
                  label="Information Ratio"
                  value={metrics.informationRatio.toFixed(2)}
                  tooltip="Excess return per unit of tracking error vs benchmark. Higher shows better active management."
                  icon={BarChart2}
                  color={getMetricColor(metrics.informationRatio, { good: 0.5, warning: 0.2 })}
                />
              </div>
            </div>
            
            {/* Trading Statistics */}
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Trading Statistics
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard 
                  label="Calmar Ratio"
                  value={metrics.calmarRatio.toFixed(2)}
                  tooltip="Annual return divided by max drawdown. Higher indicates better risk-adjusted performance."
                  icon={Target}
                  color={getMetricColor(metrics.calmarRatio, { good: 1.0, warning: 0.5 })}
                />
                <MetricCard 
                  label="Profit Factor"
                  value={metrics.profitFactor.toFixed(2)}
                  tooltip="Ratio of gross profits to gross losses. >1.5 is good, >2 is excellent."
                  icon={TrendingUp}
                  color={getMetricColor(metrics.profitFactor, { good: 1.5, warning: 1.0 })}
                />
                <MetricCard 
                  label="Avg Win"
                  value={`+${metrics.avgWin.toFixed(2)}%`}
                  tooltip="Average return on profitable days."
                  icon={TrendingUp}
                  color="text-green-600 dark:text-green-400"
                />
                <MetricCard 
                  label="Avg Loss"
                  value={`-${metrics.avgLoss.toFixed(2)}%`}
                  tooltip="Average return on losing days."
                  icon={TrendingDown}
                  color="text-red-600 dark:text-red-400"
                />
              </div>
            </div>
            
            {/* Footer */}
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between">
              <span>
                Based on {metrics.dataPoints} data points • Risk-free rate: 5.0% • Benchmark: BTC
              </span>
              <span>
                Updated: {new Date(metrics.lastCalculated).toLocaleString()}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
