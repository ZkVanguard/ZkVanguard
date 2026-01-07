'use client';

import { useState, useEffect } from 'react';
import { DelphiMarketService, PredictionMarket } from '@/lib/services/DelphiMarketService';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle, 
  Eye,
  ExternalLink,
  RefreshCw,
  Loader2,
  Activity
} from 'lucide-react';

interface PredictionInsightsProps {
  assets?: string[];
  showAll?: boolean;
}

export function PredictionInsights({ assets = ['BTC', 'ETH', 'CRO', 'USDC'], showAll = false }: PredictionInsightsProps) {
  const [predictions, setPredictions] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'HIGH' | 'MODERATE' | 'LOW'>('all');
  const [error, setError] = useState<string | null>(null);

  const fetchPredictions = async (showRefreshIndicator = false) => {
    if (showRefreshIndicator) setRefreshing(true);
    setError(null);

    try {
      const markets = showAll 
        ? await DelphiMarketService.getTopMarkets(20)
        : await DelphiMarketService.getRelevantMarkets(assets);
      
      setPredictions(markets);
    } catch (err) {
      console.error('Error fetching Delphi predictions:', err);
      setError('Failed to fetch predictions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPredictions();
    
    // Auto-refresh every 60 seconds
    const interval = setInterval(() => fetchPredictions(false), 60000);
    return () => clearInterval(interval);
  }, [assets.join(',')]);

  const filteredPredictions = predictions.filter(p => {
    if (filter === 'all') return true;
    return p.impact === filter;
  });

  const getImpactColor = (impact: PredictionMarket['impact']) => {
    switch (impact) {
      case 'HIGH': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'MODERATE': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'LOW': return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getCategoryIcon = (category: PredictionMarket['category']) => {
    switch (category) {
      case 'volatility':
        return <Activity className="w-4 h-4" />;
      case 'price':
        return <TrendingUp className="w-4 h-4" />;
      case 'event':
        return <AlertTriangle className="w-4 h-4" />;
      case 'protocol':
        return <CheckCircle className="w-4 h-4" />;
    }
  };

  const getRecommendationBadge = (recommendation?: PredictionMarket['recommendation']) => {
    if (!recommendation) return null;
    
    const styles = {
      HEDGE: 'bg-red-500/20 text-red-300 border-red-500/40',
      MONITOR: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
      IGNORE: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
    };

    const icons = {
      HEDGE: '🛡️',
      MONITOR: '👁️',
      IGNORE: '✓',
    };

    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${styles[recommendation]}`}>
        {icons[recommendation]} {recommendation}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="glass rounded-2xl p-6 border border-white/10">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-2xl p-6 border border-white/10">
        <div className="text-center py-8 text-red-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p>{error}</p>
          <button
            onClick={() => fetchPredictions(true)}
            className="mt-2 text-sm text-cyan-400 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            🔮 Market Predictions
            <span className="text-xs font-normal px-2 py-1 bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">
              Powered by Delphi
            </span>
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Crowd-sourced probability estimates from prediction markets
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            {(['all', 'HIGH', 'MODERATE', 'LOW'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
          
          {/* Refresh */}
          <button
            onClick={() => fetchPredictions(true)}
            disabled={refreshing}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Refresh predictions"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Predictions List */}
      {filteredPredictions.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No predictions match your filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPredictions.map((prediction) => (
            <div
              key={prediction.id}
              className="p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 hover:border-purple-500/30 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: Question & Metadata */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-gray-400">
                      {getCategoryIcon(prediction.category)}
                    </span>
                    <h4 className="font-semibold text-sm line-clamp-2">
                      {prediction.question}
                    </h4>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {/* Impact Badge */}
                    <span className={`px-2 py-0.5 rounded border ${getImpactColor(prediction.impact)}`}>
                      {prediction.impact} IMPACT
                    </span>
                    
                    {/* Assets */}
                    {prediction.relatedAssets.length > 0 && (
                      <div className="flex items-center gap-1">
                        {prediction.relatedAssets.map(asset => (
                          <span key={asset} className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                            {asset}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {/* Volume */}
                    <span className="text-gray-500">
                      Vol: {prediction.volume}
                    </span>
                    
                    {/* Time */}
                    <span className="text-gray-500">
                      {DelphiMarketService.formatTimeAgo(prediction.lastUpdate)}
                    </span>
                  </div>
                </div>

                {/* Right: Probability & Action */}
                <div className="flex flex-col items-end gap-2 min-w-[120px]">
                  {/* Probability */}
                  <div className="text-center">
                    <div className={`text-2xl font-black ${
                      prediction.probability >= 70 ? 'text-red-400' :
                      prediction.probability >= 50 ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {prediction.probability}%
                    </div>
                    <div className="text-xs text-gray-500">
                      confidence: {prediction.confidence}%
                    </div>
                  </div>
                  
                  {/* Recommendation */}
                  {getRecommendationBadge(prediction.recommendation)}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mt-3 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    prediction.probability >= 70 ? 'bg-red-500' :
                    prediction.probability >= 50 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${prediction.probability}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer Stats */}
      {filteredPredictions.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>
              {filteredPredictions.length} prediction{filteredPredictions.length !== 1 ? 's' : ''}
            </span>
            <span>•</span>
            <span>
              {filteredPredictions.filter(p => p.recommendation === 'HEDGE').length} require hedging
            </span>
          </div>
          <a
            href="https://delphi.markets"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-purple-400 hover:underline flex items-center gap-1"
          >
            View on Delphi <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}
