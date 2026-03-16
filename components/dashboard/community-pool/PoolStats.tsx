'use client';

import React, { memo, useMemo } from 'react';
import type { PoolSummary, ChainKey } from './types';
import { formatUSD } from './utils';

interface PoolStatsProps {
  poolData: PoolSummary;
  selectedChain: ChainKey;
}

export const PoolStats = memo(function PoolStats({ poolData, selectedChain }: PoolStatsProps) {
  const isSui = selectedChain === 'sui';

  const totalValueDisplay = useMemo(() => {
    if (isSui && poolData.totalNAV) {
      return `${poolData.totalNAV.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`;
    }
    return formatUSD(poolData.totalValueUSD);
  }, [isSui, poolData.totalNAV, poolData.totalValueUSD]);

  const totalValueSubtext = useMemo(() => {
    if (isSui && poolData.totalValueUSD > 0) {
      return `Total Value (~${formatUSD(poolData.totalValueUSD)})`;
    }
    return 'Total Value';
  }, [isSui, poolData.totalValueUSD]);

  const sharePriceDisplay = useMemo(() => {
    if (isSui) {
      return `${poolData.sharePrice.toFixed(4)} SUI`;
    }
    return `$${poolData.sharePrice.toFixed(4)}`;
  }, [isSui, poolData.sharePrice]);

  const sharePriceSubtext = useMemo(() => {
    if (isSui && poolData.sharePriceUSD) {
      return `Share Price (~$${poolData.sharePriceUSD.toFixed(2)})`;
    }
    return 'Share Price';
  }, [isSui, poolData.sharePriceUSD]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border-b border-gray-100 dark:border-gray-700">
      <div className="text-center">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalValueDisplay}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{totalValueSubtext}</p>
      </div>
      <div className="text-center">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{poolData.memberCount}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Pool Members</p>
      </div>
      <div className="text-center">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{sharePriceDisplay}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{sharePriceSubtext}</p>
      </div>
      <div className="text-center">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          {poolData.totalShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Total Shares</p>
      </div>
    </div>
  );
});
