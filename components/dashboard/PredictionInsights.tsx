'use client';

import { useState, useCallback, memo } from 'react';
import { DelphiMarketService, PredictionMarket } from '@/lib/services/DelphiMarketService';
import { usePolling, useLoading } from '@/lib/hooks';
import { 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  Eye,
  ExternalLink,
  RefreshCw,
  Activity,
  Shield,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';

interface PredictionInsightsProps {
  assets?: string[];
  showAll?: boolean;
  onOpenHedge?: (market: PredictionMarket) => void;
  onTriggerAgentAnalysis?: (market: PredictionMarket) => void;
}

export const PredictionInsights = memo(function PredictionInsights({ 
  assets = ['BTC', 'ETH', 'CRO', 'USDC'], 
  showAll = false, 
  onOpenHedge, 
  onTriggerAgentAnalysis 
}: PredictionInsightsProps) {
  const [predictions, setPredictions] = useState<PredictionMarket[]>([]);
  const { isLoading: loading, error, setError } = useLoading(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'HIGH' | 'MODERATE' | 'LOW'>('all');
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionMarket | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; action: string } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAllPredictions, setShowAllPredictions] = useState(false);

  const fetchPredictions = useCallback(async (showRefreshIndicator = false) => {
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
      setRefreshing(false);
    }
  }, [showAll, assets, setError]);

  usePolling(fetchPredictions, 60000);

  const filteredPredictions = predictions.filter(p => {
    if (filter === 'all') return true;
    return p.impact === filter;
  });

  const getImpactStyles = (impact: PredictionMarket['impact']) => {
    switch (impact) {
      case 'HIGH': return { text: 'text-[#FF3B30]', bg: 'bg-[#FF3B30]/10', border: 'border-[#FF3B30]/20' };
      case 'MODERATE': return { text: 'text-[#FF9500]', bg: 'bg-[#FF9500]/10', border: 'border-[#FF9500]/20' };
      case 'LOW': return { text: 'text-[#86868b]', bg: 'bg-[#f5f5f7]', border: 'border-[#e8e8ed]' };
    }
  };

  const getCategoryIcon = (category: PredictionMarket['category']) => {
    switch (category) {
      case 'volatility': return <Activity className="w-3.5 h-3.5" />;
      case 'price': return <TrendingUp className="w-3.5 h-3.5" />;
      case 'event': return <AlertTriangle className="w-3.5 h-3.5" />;
      case 'protocol': return <CheckCircle className="w-3.5 h-3.5" />;
    }
  };

  const handleAction = (prediction: PredictionMarket, action: 'hedge' | 'monitor' | 'dismiss') => {
    if (onTriggerAgentAnalysis) {
      onTriggerAgentAnalysis(prediction);
    }
    
    setActionFeedback({ id: prediction.id, action });
    setTimeout(() => setActionFeedback(null), 3000);
    
    if (action === 'hedge' && onOpenHedge) {
      onOpenHedge(prediction);
    }
    
    setSelectedPrediction(null);
  };

  const hedgeCount = predictions.filter(p => p.recommendation === 'HEDGE').length;

  // Loading state
  if (loading) {
    return (
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="w-7 h-7 border-2 border-[#AF52DE] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 p-6">
        <div className="text-center py-6">
          <div className="w-12 h-12 bg-[#FF3B30]/10 rounded-[14px] flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-6 h-6 text-[#FF3B30]" />
          </div>
          <p className="text-[15px] text-[#1d1d1f] mb-2">{error}</p>
          <button
            onClick={() => fetchPredictions(true)}
            className="text-[13px] text-[#007AFF] font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 overflow-hidden">
      {/* Header - Collapseable */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between active:bg-[#f9f9f9] sm:hover:bg-[#f9f9f9] transition-colors"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-[#AF52DE] rounded-[10px] sm:rounded-[12px] flex items-center justify-center">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">Insights</h3>
              <span className="px-1.5 py-0.5 bg-[#AF52DE]/10 text-[#AF52DE] text-[10px] font-bold rounded-full">
                {predictions.length}
              </span>
              {hedgeCount > 0 && (
                <span className="px-1.5 py-0.5 bg-[#FF3B30]/10 text-[#FF3B30] text-[10px] font-bold rounded-full">
                  {hedgeCount} alerts
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-[12px] text-[#86868b]">Delphi prediction markets</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              fetchPredictions(true);
            }}
            disabled={refreshing}
            className="w-8 h-8 flex items-center justify-center bg-[#f5f5f7] rounded-full"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#86868b] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {isCollapsed ? (
            <ChevronDown className="w-5 h-5 text-[#86868b]" />
          ) : (
            <ChevronUp className="w-5 h-5 text-[#86868b]" />
          )}
        </div>
      </button>

      {!isCollapsed && (
        <>
          {/* Filter Pills */}
          <div className="px-4 sm:px-6 pb-3">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
              {(['all', 'HIGH', 'MODERATE', 'LOW'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all whitespace-nowrap ${
                    filter === f
                      ? 'bg-[#AF52DE] text-white'
                      : 'bg-[#f5f5f7] text-[#86868b] active:bg-[#e8e8ed]'
                  }`}
                >
                  {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Predictions List */}
          {filteredPredictions.length === 0 ? (
            <div className="px-4 sm:px-6 pb-6">
              <div className="text-center py-8 bg-[#f5f5f7] rounded-[14px]">
                <Eye className="w-8 h-8 text-[#86868b] mx-auto mb-2 opacity-50" />
                <p className="text-[14px] text-[#86868b]">No predictions match your filter</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-black/5">
              {filteredPredictions.slice(0, showAllPredictions ? undefined : 5).map((prediction) => {
                const impactStyles = getImpactStyles(prediction.impact);
                const showFeedback = actionFeedback?.id === prediction.id;
                
                return (
                  <div
                    key={prediction.id}
                    className="px-4 sm:px-6 py-3 sm:py-4 active:bg-[#f9f9f9] sm:hover:bg-[#f9f9f9] transition-colors"
                  >
                    {/* Top Row: Question & Probability */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`${impactStyles.text}`}>
                            {getCategoryIcon(prediction.category)}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${impactStyles.bg} ${impactStyles.text}`}>
                            {prediction.impact}
                          </span>
                        </div>
                        <h4 className="text-[13px] sm:text-[14px] font-medium text-[#1d1d1f] line-clamp-2 leading-snug">
                          {prediction.question}
                        </h4>
                      </div>
                      
                      {/* Probability Badge */}
                      <div className="flex-shrink-0 text-right">
                        <div className={`text-[20px] sm:text-[24px] font-bold leading-none ${
                          prediction.probability >= 70 ? 'text-[#FF3B30]' :
                          prediction.probability >= 50 ? 'text-[#FF9500]' :
                          'text-[#34C759]'
                        }`}>
                          {prediction.probability}%
                        </div>
                        <div className="text-[10px] text-[#86868b]">probability</div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-1 bg-[#f5f5f7] rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full transition-all ${
                          prediction.probability >= 70 ? 'bg-[#FF3B30]' :
                          prediction.probability >= 50 ? 'bg-[#FF9500]' :
                          'bg-[#34C759]'
                        }`}
                        style={{ width: `${prediction.probability}%` }}
                      />
                    </div>

                    {/* Bottom Row: Assets & Action */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {prediction.relatedAssets.slice(0, 3).map(asset => (
                          <span key={asset} className="px-1.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] rounded text-[10px] font-medium">
                            {asset}
                          </span>
                        ))}
                        <span className="text-[10px] text-[#86868b]">
                          {DelphiMarketService.formatTimeAgo(prediction.lastUpdate)}
                        </span>
                      </div>
                      
                      {prediction.recommendation !== 'IGNORE' && (
                        showFeedback ? (
                          <span className="flex items-center gap-1 px-2 py-1 bg-[#34C759]/10 text-[#34C759] rounded-full text-[11px] font-medium">
                            <CheckCircle className="w-3 h-3" />
                            Done
                          </span>
                        ) : (
                          <button
                            onClick={() => setSelectedPrediction(prediction)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold transition-all ${
                              prediction.recommendation === 'HEDGE'
                                ? 'bg-[#FF3B30]/10 text-[#FF3B30] active:bg-[#FF3B30]/20'
                                : 'bg-[#FF9500]/10 text-[#FF9500] active:bg-[#FF9500]/20'
                            }`}
                          >
                            {prediction.recommendation === 'HEDGE' ? (
                              <><Shield className="w-3 h-3" /> Hedge</>
                            ) : (
                              <><Eye className="w-3 h-3" /> Watch</>
                            )}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          {filteredPredictions.length > 5 && (
            <div className="px-4 sm:px-6 py-3 border-t border-black/5">
              <button 
                onClick={() => setShowAllPredictions(!showAllPredictions)}
                className="w-full py-2 text-[13px] font-medium text-[#007AFF] active:text-[#0051D5]"
              >
                {showAllPredictions ? 'Show less' : `View all ${filteredPredictions.length} predictions`}
              </button>
            </div>
          )}

          {filteredPredictions.length > 0 && filteredPredictions.length <= 5 && (
            <div className="px-4 sm:px-6 py-3 border-t border-black/5 flex items-center justify-between">
              <span className="text-[11px] text-[#86868b]">
                {hedgeCount > 0 ? `${hedgeCount} require action` : 'No immediate actions needed'}
              </span>
              <a
                href="https://delphi.markets"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[#AF52DE] font-medium"
              >
                Delphi <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </>
      )}

      {/* Action Modal */}
      {selectedPrediction && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" 
          onClick={() => setSelectedPrediction(null)}
        >
          <div 
            className="bg-white w-full sm:max-w-md sm:rounded-[20px] rounded-t-[20px] shadow-2xl" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-[12px] flex items-center justify-center ${
                  selectedPrediction.recommendation === 'HEDGE' 
                    ? 'bg-[#FF3B30]' 
                    : 'bg-[#FF9500]'
                }`}>
                  {selectedPrediction.recommendation === 'HEDGE' ? (
                    <Shield className="w-5 h-5 text-white" />
                  ) : (
                    <Eye className="w-5 h-5 text-white" />
                  )}
                </div>
                <div>
                  <h3 className="text-[17px] font-semibold text-[#1d1d1f]">
                    {selectedPrediction.recommendation === 'HEDGE' ? 'Open Hedge' : 'Add to Watchlist'}
                  </h3>
                  <p className="text-[12px] text-[#86868b]">AI Recommendation</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPrediction(null)}
                className="w-8 h-8 flex items-center justify-center bg-[#f5f5f7] rounded-full"
              >
                <X className="w-4 h-4 text-[#86868b]" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5">
              {/* Prediction Summary */}
              <div className="p-4 bg-[#f5f5f7] rounded-[14px] mb-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <p className="text-[14px] font-medium text-[#1d1d1f] leading-snug flex-1">
                    {selectedPrediction.question}
                  </p>
                  <div className={`text-[28px] font-bold ${
                    selectedPrediction.probability >= 70 ? 'text-[#FF3B30]' :
                    selectedPrediction.probability >= 50 ? 'text-[#FF9500]' :
                    'text-[#34C759]'
                  }`}>
                    {selectedPrediction.probability}%
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-[#86868b] uppercase tracking-wide mb-1">Impact</div>
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${getImpactStyles(selectedPrediction.impact).bg} ${getImpactStyles(selectedPrediction.impact).text}`}>
                      {selectedPrediction.impact}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#86868b] uppercase tracking-wide mb-1">Confidence</div>
                    <span className="text-[14px] font-semibold text-[#1d1d1f]">{selectedPrediction.confidence}%</span>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[10px] text-[#86868b] uppercase tracking-wide mb-1">Assets</div>
                    <div className="flex gap-1">
                      {selectedPrediction.relatedAssets.map(asset => (
                        <span key={asset} className="px-2 py-0.5 bg-[#007AFF]/10 text-[#007AFF] rounded text-[11px] font-medium">
                          {asset}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recommendation Text */}
              <div className="p-3 bg-[#AF52DE]/5 border border-[#AF52DE]/10 rounded-[12px] mb-5">
                <p className="text-[13px] text-[#1d1d1f] leading-relaxed">
                  {selectedPrediction.recommendation === 'HEDGE' ? (
                    <>This prediction has <strong>{selectedPrediction.probability}%</strong> probability with <strong>{selectedPrediction.impact}</strong> impact. Consider opening a hedge position to protect your <strong>{selectedPrediction.relatedAssets.join(', ')}</strong> holdings.</>
                  ) : (
                    <>This prediction has <strong>{selectedPrediction.probability}%</strong> probability. Monitor price action for <strong>{selectedPrediction.relatedAssets.join(', ')}</strong> closely.</>
                  )}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleAction(
                    selectedPrediction, 
                    selectedPrediction.recommendation === 'HEDGE' ? 'hedge' : 'monitor'
                  )}
                  className={`flex-1 py-3 rounded-[12px] text-[15px] font-semibold text-white transition-all active:scale-[0.98] ${
                    selectedPrediction.recommendation === 'HEDGE'
                      ? 'bg-[#FF3B30] active:bg-[#E0342B]'
                      : 'bg-[#FF9500] active:bg-[#E08600]'
                  }`}
                >
                  {selectedPrediction.recommendation === 'HEDGE' ? 'Open Hedge' : 'Add to Watchlist'}
                </button>
                <button
                  onClick={() => setSelectedPrediction(null)}
                  className="px-5 py-3 bg-[#f5f5f7] rounded-[12px] text-[15px] font-semibold text-[#1d1d1f] active:bg-[#e8e8ed] transition-all active:scale-[0.98]"
                >
                  Later
                </button>
              </div>
            </div>

            {/* Safe area for mobile */}
            <div className="h-6 sm:hidden" />
          </div>
        </div>
      )}
    </div>
  );
});
