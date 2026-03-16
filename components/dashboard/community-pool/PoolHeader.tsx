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
    <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Community Pool</h2>
            <p className="text-sm text-white/80">AI-Managed Collective Investment</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Chain Selector */}
          <div className="flex bg-white/20 rounded-lg p-0.5">
            {Object.entries(POOL_CHAIN_CONFIGS)
              .filter(([_, config]) => config.status === 'live' || config.status === 'testing')
              .map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => onChainSelect(key as ChainKey)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                    selectedChain === key
                      ? 'bg-white text-indigo-600'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                  title={`${config.name} ${config.status === 'testing' ? '(Testing)' : ''}`}
                >
                  <span>{config.icon}</span>
                  <span>{config.shortName}</span>
                  {config.status === 'testing' && (
                    <span className="ml-1 px-1 py-0.5 text-[10px] bg-yellow-500 text-white rounded">
                      TEST
                    </span>
                  )}
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
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className="w-5 h-5 text-white" />
                </button>
              )}
              {onAIClick && (
                <button
                  onClick={onAIClick}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                >
                  <Brain className="w-4 h-4 text-white" />
                  <span className="text-sm text-white">AI Insights</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Network indicator */}
      {chainName && network && (
        <div className="mt-2 flex items-center gap-2 text-xs text-white/70">
          <Globe className="w-3 h-3" />
          <span>
            {chainName} • {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
            {poolDeployed === false && <span className="ml-2 text-yellow-300">(Not Deployed)</span>}
          </span>
        </div>
      )}
    </div>
  );
});
