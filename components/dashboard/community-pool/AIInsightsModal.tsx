'use client';

import React, { memo } from 'react';
import { Brain, ArrowRightLeft, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AIRecommendation } from './types';
import { ASSET_COLORS } from './utils';

interface AIInsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: AIRecommendation | null;
}

export const AIInsightsModal = memo(function AIInsightsModal({
  isOpen,
  onClose,
  recommendation,
}: AIInsightsModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-indigo-600 to-purple-600">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Brain className="w-5 h-5" />
                AI Allocation Insights
              </h3>
            </div>

            <div className="p-4">
              {recommendation ? (
                <>
                  <div className="mb-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                      Confidence: {recommendation.confidence}%
                    </p>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all"
                        style={{ width: `${recommendation.confidence}%` }}
                      />
                    </div>
                  </div>

                  <div className="prose dark:prose-invert text-sm whitespace-pre-wrap mb-4">
                    {recommendation.reasoning}
                  </div>

                  <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Proposed Changes:</h4>
                  <div className="space-y-2">
                    {recommendation.changes.map((change) => (
                      <div
                        key={change.asset}
                        className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${ASSET_COLORS[change.asset]}`} />
                          <span className="font-medium">{change.asset}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-gray-500">{change.currentPercent}%</span>
                          <ArrowRightLeft className="w-4 h-4 text-gray-400" />
                          <span
                            className={
                              change.change > 0
                                ? 'text-green-600'
                                : change.change < 0
                                ? 'text-red-600'
                                : ''
                            }
                          >
                            {change.proposedPercent}%
                          </span>
                          {change.change !== 0 && (
                            <span
                              className={`text-xs ${change.change > 0 ? 'text-green-600' : 'text-red-600'}`}
                            >
                              ({change.change > 0 ? '+' : ''}
                              {change.change}%)
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-2" />
                  <p className="text-gray-500">Loading AI analysis...</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
