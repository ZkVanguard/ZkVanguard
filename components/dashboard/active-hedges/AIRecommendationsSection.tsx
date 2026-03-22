'use client';

import { memo } from 'react';
import { Brain, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import type { AIRecommendation } from './types';

interface AIRecommendationsSectionProps {
  recommendations: AIRecommendation[];
  loading: boolean;
  executingRecommendation: string | null;
  onRefresh: (force: boolean) => void;
  onExecute: (rec: AIRecommendation) => void;
}

export const AIRecommendationsSection = memo(function AIRecommendationsSection({
  recommendations,
  loading,
  executingRecommendation,
  onRefresh,
  onExecute,
}: AIRecommendationsSectionProps) {
  return (
    <div className="bg-gradient-to-br from-[#f8f9ff] to-[#f0f4ff] rounded-[16px] sm:rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[#007AFF]/10 p-3 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-[12px] flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
              AI Multi-Agent Recommendations
            </h3>
            <span className="text-[11px] text-[#86868b]">
              LeadAgent • RiskAgent • HedgingAgent orchestration
            </span>
          </div>
        </div>
        <button
          onClick={() => onRefresh(true)}
          disabled={loading}
          className="p-2 rounded-[10px] hover:bg-[#007AFF]/10 transition-colors disabled:opacity-50"
          title="Refresh recommendations"
        >
          <RefreshCw className={`w-4 h-4 text-[#007AFF] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#007AFF]/30 border-t-[#007AFF] rounded-full animate-spin" />
            <span className="text-[13px] text-[#86868b]">Multi-agent analysis in progress...</span>
          </div>
        </div>
      ) : recommendations.length > 0 ? (
        <div className="space-y-3">
          {recommendations.map((rec, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="p-4 bg-white rounded-[14px] border border-[#007AFF]/10 hover:border-[#007AFF]/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[14px] font-semibold text-[#1d1d1f]">
                      {rec.strategy}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      rec.confidence >= 0.7 
                        ? 'bg-[#34C759]/10 text-[#34C759]' 
                        : rec.confidence >= 0.5 
                          ? 'bg-[#FF9500]/10 text-[#FF9500]'
                          : 'bg-[#86868b]/10 text-[#86868b]'
                    }`}>
                      {(rec.confidence * 100).toFixed(0)}% Confidence
                    </span>
                  </div>
                  <p className="text-[12px] text-[#86868b] leading-relaxed">
                    {rec.description}
                  </p>
                  {rec.agentSource && (
                    <div className="flex items-center gap-1 mt-2">
                      <Sparkles className="w-3 h-3 text-[#5856D6]" />
                      <span className="text-[10px] text-[#5856D6] font-medium">
                        {rec.agentSource}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-[#86868b] mb-1">Risk Reduction</div>
                  <div className="text-[15px] font-bold text-[#34C759]">
                    {((rec.expectedReduction || 0) * 100).toFixed(0)}%
                  </div>
                </div>
              </div>

              {rec.actions && rec.actions.length > 0 && (
                <div className="flex items-center justify-between pt-3 border-t border-[#e8e8ed]">
                  <div className="flex items-center gap-3 text-[11px] text-[#86868b]">
                    <span className={`font-semibold ${
                      rec.actions[0].action === 'SHORT' ? 'text-[#FF3B30]' : 'text-[#34C759]'
                    }`}>
                      {rec.actions[0].action} {rec.actions[0].asset}
                    </span>
                    <span>Size: {rec.actions[0].size?.toFixed(4) || '0.25'}</span>
                    <span>{rec.actions[0].leverage || 5}x leverage</span>
                  </div>
                  <button
                    onClick={() => onExecute(rec)}
                    disabled={executingRecommendation === rec.strategy}
                    className="px-4 py-2 bg-[#007AFF] text-white rounded-[10px] text-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {executingRecommendation === rec.strategy ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        Execute
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-12 h-12 bg-[#f5f5f7] rounded-[14px] flex items-center justify-center mx-auto mb-3">
            <Brain className="w-6 h-6 text-[#86868b]" />
          </div>
          <p className="text-[13px] text-[#86868b] mb-3">
            No recommendations yet. Click refresh to run multi-agent analysis.
          </p>
          <button
            onClick={() => onRefresh(true)}
            className="px-4 py-2 bg-[#007AFF] text-white rounded-[10px] text-[13px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
          >
            Run AI Analysis
          </button>
        </div>
      )}
    </div>
  );
});
