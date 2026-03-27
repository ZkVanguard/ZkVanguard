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
    if (isSui) {
      // USDC pool: display in USD
      const totalUsdc = Number(poolData.totalValueUSD) || Number(poolData.totalShares) || 0;
      return formatUSD(totalUsdc);
    }
    return formatUSD(poolData.totalValueUSD);
  }, [isSui, poolData.totalValueUSD, poolData.totalShares]);

  const totalValueSubtext = useMemo(() => {
    if (isSui) return 'Total Pool Value (USDC)';
    return 'Total Value';
  }, [isSui]);

  const sharePriceDisplay = useMemo(() => {
    if (isSui) return '$1.00'; // 1 share = 1 USDC
    const price = Number(poolData.sharePrice) || 0;
    return `$${price.toFixed(4)}`;
  }, [isSui, poolData.sharePrice]);

  const sharePriceSubtext = useMemo(() => {
    if (isSui) return 'Share Price (1 share = 1 USDC)';
    return 'Share Price';
  }, [isSui]);

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
          {(Number(poolData.totalShares) || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Total Shares</p>
      </div>
    </div>
  );
});
