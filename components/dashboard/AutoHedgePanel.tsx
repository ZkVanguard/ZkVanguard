'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Shield, 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap,
  Settings,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ActiveHedge {
  id: number;
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notionalValue: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  createdAt: string;
}

interface AIDecision {
  id: string;
  action: string;
  reasoning: string;
  riskScore: number;
  executed: boolean;
  timestamp: string;
}

interface PredictionSource {
  name: string;
  available: boolean;
  weight: number;
  direction?: string;
  confidence?: number;
}

interface AggregatedPrediction {
  direction: string;
  confidence: number;
  consensus: number;
  recommendation: string;
  sizeMultiplier: number;
  sources: PredictionSource[];
}

interface RiskAssessment {
  riskScore: number;
  drawdownPercent: number;
  volatility: number;
  recommendations: number;
  lastUpdated: string;
  aggregatedPrediction?: AggregatedPrediction | null;
}

interface AutoHedgeData {
  enabled: boolean;
  config: {
    riskThreshold: number;
    maxLeverage: number;
    allowedAssets: string[];
  } | null;
  activeHedges: ActiveHedge[];
  recentDecisions: AIDecision[];
  riskAssessment: RiskAssessment | null;
  stats: {
    totalHedgeValue: number;
    totalPnL: number;
    hedgeCount: number;
    decisionsToday: number;
  };
}

const RISK_COLORS = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  critical: 'text-red-400',
};

const getRiskLevel = (score: number): keyof typeof RISK_COLORS => {
  if (score <= 2) return 'low';
  if (score <= 4) return 'medium';
  if (score <= 6) return 'high';
  return 'critical';
};

interface AutoHedgePanelProps {
  chain?: string;
}

export function AutoHedgePanel({ chain }: AutoHedgePanelProps = {}) {
  const [data, setData] = useState<AutoHedgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [updating, setUpdating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const params = chain ? `?chain=${chain}` : '';
      const res = await fetch(`/api/community-pool/auto-hedge${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || 'Failed to fetch');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [chain]);

  useEffect(() => {
    fetchData();
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!interval) interval = setInterval(fetchData, 30000); };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVis = () => document.hidden ? stop() : start();
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchData]);

  const toggleAutoHedge = async () => {
    if (!data) return;
    setUpdating(true);
    try {
      const res = await fetch('/api/community-pool/auto-hedge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !data.enabled }),
      });
      const json = await res.json();
      if (json.success) {
        setData(prev => prev ? { ...prev, enabled: json.config.enabled } : null);
      }
    } catch (err) {
      console.error('Failed to toggle auto-hedge:', err);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-6 h-6 text-cyan-400 animate-pulse" />
          <h3 className="text-lg font-semibold text-white">Community Pool Auto-Hedge</h3>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-700 rounded w-3/4"></div>
          <div className="h-4 bg-slate-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-6 border border-red-700/50">
        <div className="flex items-center gap-3 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <span>{error || 'Failed to load auto-hedge status'}</span>
        </div>
      </div>
    );
  }

  const riskLevel = data.riskAssessment ? getRiskLevel(data.riskAssessment.riskScore) : 'low';

  return (
    <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-700/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${data.enabled ? 'bg-cyan-500/20' : 'bg-slate-700/50'}`}>
            <Brain className={`w-5 h-5 ${data.enabled ? 'text-cyan-400' : 'text-slate-400'}`} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              Community Pool Auto-Hedge
              {data.enabled && (
                <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full">
                  Active
                </span>
              )}
            </h3>
            <p className="text-sm text-slate-400">
              AI-managed hedges protecting pool assets • {data.stats.hedgeCount} positions • {data.stats.decisionsToday} decisions today
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); fetchData(); }}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
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
            <div className="px-4 pb-4 space-y-4">
              {/* Toggle and Stats Row */}
              <div className="flex items-center justify-between bg-slate-900/50 rounded-lg p-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={toggleAutoHedge}
                    disabled={updating}
                    className={`relative w-14 h-7 rounded-full transition-colors ${
                      data.enabled ? 'bg-cyan-500' : 'bg-slate-600'
                    }`}
                  >
                    <motion.div
                      className="absolute top-1 w-5 h-5 bg-white rounded-full shadow"
                      animate={{ left: data.enabled ? '32px' : '4px' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </button>
                  <span className="text-sm text-slate-300">
                    Auto-hedging {data.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                
                {data.config && (
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <Settings className="w-4 h-4 text-slate-500" />
                      <span className="text-slate-400">Threshold:</span>
                      <span className="text-white font-medium">{data.config.riskThreshold}/10</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-slate-500" />
                      <span className="text-slate-400">Max Leverage:</span>
                      <span className="text-white font-medium">{data.config.maxLeverage}x</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Risk Assessment */}
              {data.riskAssessment && (
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Pool Risk Assessment
                    </h4>
                    <span className="text-xs text-slate-500">
                      Updated {new Date(data.riskAssessment.lastUpdated).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${RISK_COLORS[riskLevel]}`}>
                        {data.riskAssessment.riskScore}/10
                      </div>
                      <div className="text-xs text-slate-500">Risk Score</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white">
                        {data.riskAssessment.drawdownPercent.toFixed(2)}%
                      </div>
                      <div className="text-xs text-slate-500">Drawdown</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white">
                        {data.riskAssessment.volatility.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500">Volatility</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-cyan-400">
                        {data.riskAssessment.recommendations}
                      </div>
                      <div className="text-xs text-slate-500">Recommendations</div>
                    </div>
                  </div>
                  
                  {/* Multi-Source Prediction Aggregation */}
                  {data.riskAssessment.aggregatedPrediction && (
                    <div className="mt-4 pt-4 border-t border-slate-700/50">
                      <h5 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5" />
                        Multi-Source AI Prediction
                      </h5>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="bg-slate-800/50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-500">Direction</span>
                            <span className={`flex items-center gap-1 font-medium ${
                              data.riskAssessment.aggregatedPrediction.direction === 'UP' 
                                ? 'text-green-400' 
                                : data.riskAssessment.aggregatedPrediction.direction === 'DOWN'
                                ? 'text-red-400'
                                : 'text-slate-400'
                            }`}>
                              {data.riskAssessment.aggregatedPrediction.direction === 'UP' && <TrendingUp className="w-4 h-4" />}
                              {data.riskAssessment.aggregatedPrediction.direction === 'DOWN' && <TrendingDown className="w-4 h-4" />}
                              {data.riskAssessment.aggregatedPrediction.direction}
                            </span>
                          </div>
                          <div className="text-lg font-bold text-white">
                            {data.riskAssessment.aggregatedPrediction.confidence}%
                            <span className="text-xs text-slate-500 ml-1">confidence</span>
                          </div>
                        </div>
                        <div className="bg-slate-800/50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-500">Consensus</span>
                            <span className="text-xs text-slate-400">
                              {data.riskAssessment.aggregatedPrediction.sources.filter(s => s.available).length} sources
                            </span>
                          </div>
                          <div className="text-lg font-bold text-white">
                            {data.riskAssessment.aggregatedPrediction.consensus}%
                            <span className="text-xs text-slate-500 ml-1">agreement</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Recommendation Badge */}
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                        data.riskAssessment.aggregatedPrediction.recommendation.includes('STRONG') 
                          ? data.riskAssessment.aggregatedPrediction.recommendation.includes('SHORT')
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-green-500/20 text-green-400'
                          : data.riskAssessment.aggregatedPrediction.recommendation.includes('SHORT')
                            ? 'bg-orange-500/20 text-orange-400'
                            : data.riskAssessment.aggregatedPrediction.recommendation.includes('LONG')
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-slate-500/20 text-slate-400'
                      }`}>
                        <Zap className="w-3.5 h-3.5" />
                        {data.riskAssessment.aggregatedPrediction.recommendation.replace(/_/g, ' ')}
                        <span className="text-xs opacity-70">
                          ({data.riskAssessment.aggregatedPrediction.sizeMultiplier}x size)
                        </span>
                      </div>
                      
                      {/* Source Breakdown */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {data.riskAssessment.aggregatedPrediction.sources.map((source) => (
                          <div 
                            key={source.name}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                              source.available 
                                ? 'bg-slate-700/50 text-slate-300' 
                                : 'bg-slate-800/30 text-slate-500'
                            }`}
                          >
                            {source.available ? (
                              <CheckCircle className="w-3 h-3 text-green-400" />
                            ) : (
                              <Clock className="w-3 h-3 text-slate-600" />
                            )}
                            <span>{source.name}</span>
                            {source.available && source.direction && (
                              <span className={`font-medium ${
                                source.direction === 'UP' ? 'text-green-400' : 
                                source.direction === 'DOWN' ? 'text-red-400' : 'text-slate-400'
                              }`}>
                                {source.direction === 'UP' ? '↑' : source.direction === 'DOWN' ? '↓' : '-'}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Active Hedges */}
              {data.activeHedges.length > 0 && (
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4" />
                    Pool Hedge Positions ({data.activeHedges.length})
                  </h4>
                  <div className="space-y-2">
                    {data.activeHedges.map((hedge) => (
                      <div 
                        key={hedge.id}
                        className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            hedge.side === 'LONG' 
                              ? 'bg-green-500/20 text-green-400' 
                              : 'bg-red-500/20 text-red-400'
                          }`}>
                            {hedge.side}
                          </span>
                          <span className="text-white font-medium">{hedge.asset}</span>
                          <span className="text-slate-400 text-sm">
                            ${hedge.notionalValue.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className={`font-medium ${
                              hedge.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {hedge.pnl >= 0 ? '+' : ''}${hedge.pnl.toFixed(2)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {hedge.pnlPercent >= 0 ? '+' : ''}{hedge.pnlPercent.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between text-sm">
                    <span className="text-slate-400">Total Hedge Value</span>
                    <span className="text-white font-medium">
                      ${data.stats.totalHedgeValue.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total P&L</span>
                    <span className={`font-medium ${
                      data.stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {data.stats.totalPnL >= 0 ? '+' : ''}${data.stats.totalPnL.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* No Hedges State */}
              {data.activeHedges.length === 0 && (
                <div className="bg-slate-900/50 rounded-lg p-6 text-center">
                  <Shield className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No active pool hedges</p>
                  <p className="text-slate-500 text-xs">
                    AI agents will open hedges when pool risk exceeds threshold
                  </p>
                </div>
              )}

              {/* Recent AI Decisions */}
              {data.recentDecisions.length > 0 && (
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2 mb-3">
                    <Brain className="w-4 h-4" />
                    Pool AI Decisions
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {data.recentDecisions.slice(0, 5).map((decision) => (
                      <div 
                        key={decision.id}
                        className="flex items-start gap-3 bg-slate-800/50 rounded-lg p-3"
                      >
                        <div className={`p-1.5 rounded-full ${
                          decision.action === 'REBALANCE' || decision.action === 'HEDGE'
                            ? 'bg-cyan-500/20'
                            : 'bg-slate-700'
                        }`}>
                          {decision.executed ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : (
                            <Clock className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              decision.action === 'HOLD' 
                                ? 'bg-slate-600 text-slate-300'
                                : decision.action === 'REBALANCE'
                                ? 'bg-cyan-500/20 text-cyan-400'
                                : 'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {decision.action}
                            </span>
                            <span className={`text-xs ${RISK_COLORS[getRiskLevel(decision.riskScore)]}`}>
                              Risk: {decision.riskScore}/10
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 mt-1 line-clamp-2">
                            {decision.reasoning}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {new Date(decision.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No Decisions State */}
              {data.recentDecisions.length === 0 && (
                <div className="bg-slate-900/50 rounded-lg p-6 text-center">
                  <Brain className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No AI decisions yet</p>
                  <p className="text-slate-500 text-xs">
                    AI evaluates pool risk every 5 minutes
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
