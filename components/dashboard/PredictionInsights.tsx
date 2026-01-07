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
  Activity,
  Shield,
  X,
  ArrowRight
} from 'lucide-react';

interface PredictionInsightsProps {
  assets?: string[];
  showAll?: boolean;
  onOpenHedge?: (market: PredictionMarket) => void;
}

export function PredictionInsights({ assets = ['BTC', 'ETH', 'CRO', 'USDC'], showAll = false, onOpenHedge }: PredictionInsightsProps) {
  const [predictions, setPredictions] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'HIGH' | 'MODERATE' | 'LOW'>('all');
  const [error, setError] = useState<string | null>(null);
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionMarket | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; action: string } | null>(null);

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

  const handleAction = (prediction: PredictionMarket, action: 'hedge' | 'monitor' | 'dismiss') => {
    console.log(`User action: ${action} for prediction:`, prediction.question);
    
    // Show feedback
    setActionFeedback({ id: prediction.id, action });
    
    // Clear feedback after 3 seconds
    setTimeout(() => setActionFeedback(null), 3000);
    
    // Trigger hedge action if callback provided
    if (action === 'hedge' && onOpenHedge) {
      onOpenHedge(prediction);
    }
    
    // Close modal
    setSelectedPrediction(null);
  };

  const getActionRecommendation = (prediction: PredictionMarket) => {
    if (prediction.recommendation === 'HEDGE') {
      return {
        title: 'Open Hedge Position',
        description: `This prediction has ${prediction.probability}% probability and HIGH impact. Consider opening a SHORT position to protect your ${prediction.relatedAssets.join(', ')} holdings.`,
        primaryAction: 'hedge',
        primaryLabel: 'Open Hedge',
        primaryColor: 'bg-red-600 hover:bg-red-700',
      };
    } else if (prediction.recommendation === 'MONITOR') {
      return {
        title: 'Monitor Closely',
        description: `This prediction has ${prediction.probability}% probability. Set up alerts and monitor price action for ${prediction.relatedAssets.join(', ')}.`,
        primaryAction: 'monitor',
        primaryLabel: 'Add to Watchlist',
        primaryColor: 'bg-yellow-600 hover:bg-yellow-700',
      };
    } else {
      return {
        title: 'Low Risk',
        description: `This prediction has ${prediction.probability}% probability and ${prediction.impact} impact. No immediate action required.`,
        primaryAction: 'dismiss',
        primaryLabel: 'Acknowledge',
        primaryColor: 'bg-gray-600 hover:bg-gray-700',
      };
    }
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

              {/* Action Button */}
              {prediction.recommendation !== 'IGNORE' && (
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    AI Recommendation: <span className="text-white font-semibold">{prediction.recommendation}</span>
                  </div>
                  {actionFeedback?.id === prediction.id ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                      <CheckCircle className="w-3 h-3" />
                      {actionFeedback.action === 'hedge' ? 'Hedge Added' : 'Added to Watchlist'}
                    </div>
                  ) : (
                    <button
                      onClick={() => setSelectedPrediction(prediction)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                        prediction.recommendation === 'HEDGE'
                          ? 'bg-red-600/20 text-red-300 border border-red-500/40 hover:bg-red-600/30'
                          : 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/40 hover:bg-yellow-600/30'
                      }`}
                    >
                      <ArrowRight className="w-3 h-3" />
                      Review & Act
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action Modal */}
      {selectedPrediction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedPrediction(null)}>
          <div className="glass max-w-2xl w-full rounded-2xl border border-purple-500/30 p-6" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-5 h-5 text-purple-400" />
                  <h3 className="text-xl font-bold">
                    {getActionRecommendation(selectedPrediction).title}
                  </h3>
                </div>
                <p className="text-sm text-gray-400">
                  Based on Delphi prediction market analysis
                </p>
              </div>
              <button
                onClick={() => setSelectedPrediction(null)}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Prediction Details */}
            <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <h4 className="font-semibold text-white">{selectedPrediction.question}</h4>
                <div className="text-right">
                  <div className={`text-3xl font-black ${
                    selectedPrediction.probability >= 70 ? 'text-red-400' :
                    selectedPrediction.probability >= 50 ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>
                    {selectedPrediction.probability}%
                  </div>
                  <div className="text-xs text-gray-500">probability</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500 text-xs mb-1">Impact Level</div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getImpactColor(selectedPrediction.impact)}`}>
                    {selectedPrediction.impact}
                  </span>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">Market Volume</div>
                  <div className="text-white font-semibold">{selectedPrediction.volume}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">Affected Assets</div>
                  <div className="flex gap-1">
                    {selectedPrediction.relatedAssets.map(asset => (
                      <span key={asset} className="px-2 py-0.5 bg-gray-700 rounded text-white text-xs">
                        {asset}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">Confidence Score</div>
                  <div className="text-white font-semibold">{selectedPrediction.confidence}%</div>
                </div>
              </div>
            </div>

            {/* Recommendation */}
            <div className="mb-6">
              <div className="flex items-start gap-3 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-white mb-1">AI Recommendation</div>
                  <p className="text-sm text-gray-300">
                    {getActionRecommendation(selectedPrediction).description}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleAction(selectedPrediction, getActionRecommendation(selectedPrediction).primaryAction as any)}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${getActionRecommendation(selectedPrediction).primaryColor}`}
              >
                {selectedPrediction.recommendation === 'HEDGE' ? <Shield className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                {getActionRecommendation(selectedPrediction).primaryLabel}
              </button>
              <button
                onClick={() => setSelectedPrediction(null)}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold transition-all"
              >
                Not Now
              </button>
            </div>

            {/* Footer Info */}
            <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
              <div>
                Last updated: {DelphiMarketService.formatTimeAgo(selectedPrediction.lastUpdate)}
              </div>
              <a
                href="https://delphi.markets"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-purple-400 hover:underline"
              >
                View on Delphi <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
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
