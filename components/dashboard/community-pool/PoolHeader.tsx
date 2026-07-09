'use client';

import React, { memo } from 'react';
import { Users, RefreshCw, Brain, Globe, Loader2 } from 'lucide-react';
import { POOL_CHAIN_CONFIGS } from '@/lib/contracts/community-pool-config';
import type { ChainKey } from './types';

interface PoolHeaderProps {
  selectedChain: ChainKey;
  onChainSelect: (key: ChainKey) => void;
  onRefresh?: () => void;
  onAIClick?: () => void;
  chainName?: string;
  network?: string;
  poolDeployed?: boolean;
  isLoading?: boolean;
}

// Mobile-first PoolHeader: title stacks above the action row on ≤ 640px so
// nothing overflows on narrow screens. Buttons collapse to icon-only on
// mobile so 3 controls (chain / refresh / AI) fit alongside the title.
export const PoolHeader = memo(function PoolHeader({
  selectedChain,
  onChainSelect,
  onRefresh,
  onAIClick,
  chainName,
  network,
  poolDeployed,
  isLoading,
}: PoolHeaderProps) {
  return (
    <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        {/* Title row */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-white/20 rounded-lg flex-shrink-0">
            <Users className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white truncate">Community Pool</h2>
            <p className="text-xs sm:text-sm text-white/80 truncate">AI-Managed Collective Investment</p>
          </div>
        </div>

        {/* Actions row — wraps to a second line on mobile if all three don't fit */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2 sm:flex-nowrap sm:flex-shrink-0">
          {/* Chain Selector - SUI-only mode */}
          <div className="flex bg-white/20 rounded-lg p-0.5">
            {Object.entries(POOL_CHAIN_CONFIGS)
              .filter(([key, config]) => key === 'sui' && (config.status === 'live' || config.status === 'testing'))
              .map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => onChainSelect(key as ChainKey)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 active:scale-[0.98] ${
                    selectedChain === key
                      ? 'bg-white text-indigo-600'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                  title={`${config.name}`}
                >
                  <span>{config.icon}</span>
                  <span>{config.shortName}</span>
                </button>
              ))}
          </div>
          {isLoading ? (
            <div className="p-2 rounded-lg">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          ) : (
            <>
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors active:scale-[0.96]"
                  title="Refresh"
                  aria-label="Refresh"
                >
                  <RefreshCw className="w-5 h-5 text-white" />
                </button>
              )}
              {onAIClick && (
                <button
                  onClick={onAIClick}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors active:scale-[0.98]"
                  aria-label="AI Insights"
                >
                  <Brain className="w-4 h-4 text-white" />
                  <span className="text-xs sm:text-sm text-white hidden xs:inline">AI Insights</span>
                  <span className="text-xs sm:text-sm text-white xs:hidden">AI</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Network indicator */}
      {chainName && network && (
        <div className="mt-2 sm:mt-2 flex items-center gap-2 text-[11px] sm:text-xs text-white/70">
          <Globe className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">
            {chainName} • {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
            {poolDeployed === false && <span className="ml-2 text-yellow-300">(Not Deployed)</span>}
          </span>
        </div>
      )}
    </div>
  );
});
