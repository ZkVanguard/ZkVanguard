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
    // Both EVM and SUI pools: show the live computed share price
    // (NAV / totalShares). For SUI USDC pools the value starts at $1.00
    // (1 share = 1 USDC at inception) and appreciates as the AI manages
    // BTC/ETH/SUI allocations.
    const price = Number(poolData.sharePrice) || (isSui ? 1 : 0);
    return `$${price.toFixed(4)}`;
  }, [isSui, poolData.sharePrice]);

  const sharePriceSubtext = useMemo(() => {
    if (isSui) return 'Current Share Price (USDC at inception)';
    return 'Share Price';
  }, [isSui]);

  // SUI USDC pool profit metrics. Inception share price = $1.00 (1 share = 1 USDC),
  // so total return per share = sharePrice − 1. Pool-level $ profit = NAV − net
  // capital deposited (lifetime deposits − withdrawals).
  const profit = useMemo(() => {
    if (!isSui) return null;
    const sharePrice = Number(poolData.sharePrice) || 1;
    const returnPct = (sharePrice - 1) * 100;
    const nav = Number(poolData.totalValueUSD) || 0;
    const netCapital = (Number(poolData.totalDeposited) || 0) - (Number(poolData.totalWithdrawn) || 0);
    // Only meaningful once capital has actually been deposited.
    const profitUsd = netCapital > 0 ? nav - netCapital : null;
    const ath = Number(poolData.allTimeHighNav) || 0;
    const offAthPct = ath > 0 ? (sharePrice / ath - 1) * 100 : null;
    return { returnPct, profitUsd, offAthPct };
  }, [isSui, poolData.sharePrice, poolData.totalValueUSD, poolData.totalDeposited, poolData.totalWithdrawn, poolData.allTimeHighNav]);

  const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const signedUsd = (v: number) => `${v >= 0 ? '+' : '-'}${formatUSD(Math.abs(v))}`;
  const pnlColor = (v: number) =>
    v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';

  // Mobile: 2 hero cards + compact 3-metric strip below.
  // Desktop: full grid (3 or 5 cols depending on chain).
  return (
    <div className="p-3 sm:p-4 md:p-5 border-b border-gray-100 dark:border-gray-700 min-w-0">
      {/* Mobile hero row */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <div className="text-center min-w-0 rounded-2xl bg-gray-50 dark:bg-gray-700/40 p-3">
          <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums break-all">{totalValueDisplay}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-tight">{totalValueSubtext}</p>
        </div>
        {isSui && profit ? (
          <div className="text-center min-w-0 rounded-2xl bg-gray-50 dark:bg-gray-700/40 p-3">
            <p className={`text-lg font-bold tabular-nums break-all ${pnlColor(profit.returnPct)}`}>{signedPct(profit.returnPct)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">Total Return</p>
          </div>
        ) : (
          <div className="text-center min-w-0 rounded-2xl bg-gray-50 dark:bg-gray-700/40 p-3">
            <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums break-all">{sharePriceDisplay}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-tight">Share Price</p>
          </div>
        )}
      </div>

      {/* Mobile compact secondary strip */}
      <div className="grid grid-cols-3 gap-2 mt-2 sm:hidden">
        {isSui && profit && profit.profitUsd !== null && (
          <div className="text-center min-w-0">
            <p className={`text-xs font-semibold tabular-nums break-all ${pnlColor(profit.profitUsd)}`}>{signedUsd(profit.profitUsd)}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight truncate">Profit</p>
          </div>
        )}
        {isSui && profit && (
          <div className="text-center min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums break-all">{sharePriceDisplay}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight truncate">Share Price</p>
          </div>
        )}
        <div className="text-center min-w-0">
          <p className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums">{poolData.memberCount}</p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight truncate">Members</p>
        </div>
        {(!isSui || !profit) && (
          <div className="text-center min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums break-all">
              {(Number(poolData.totalShares) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight truncate">Shares</p>
          </div>
        )}
      </div>

      {/* Desktop grid — full detail from sm+ */}
      <div className={`hidden sm:grid gap-3 sm:gap-4 ${isSui ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <div className="text-center min-w-0">
          <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white tabular-nums break-all">{totalValueDisplay}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-tight">{totalValueSubtext}</p>
        </div>
        {isSui && profit && (
          <div className="text-center min-w-0">
            <p className={`text-xl md:text-2xl font-bold tabular-nums ${pnlColor(profit.returnPct)}`}>{signedPct(profit.returnPct)}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
              Total Return
              {profit.offAthPct !== null && profit.offAthPct < -0.01 && (
                <span className="block text-[10px] text-gray-400 dark:text-gray-500">
                  {profit.offAthPct.toFixed(1)}% off ATH
                </span>
              )}
            </p>
          </div>
        )}
        {isSui && profit && profit.profitUsd !== null && (
          <div className="text-center min-w-0">
            <p className={`text-xl md:text-2xl font-bold tabular-nums break-all ${pnlColor(profit.profitUsd)}`}>{signedUsd(profit.profitUsd)}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">Total Profit (USDC)</p>
          </div>
        )}
        <div className="text-center min-w-0">
          <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{poolData.memberCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">Pool Members</p>
        </div>
        <div className="text-center min-w-0">
          <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white tabular-nums break-all">{sharePriceDisplay}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-tight">{sharePriceSubtext}</p>
        </div>
        <div className="text-center min-w-0">
          <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white tabular-nums break-all">
            {(Number(poolData.totalShares) || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">Total Shares</p>
        </div>
      </div>
    </div>
  );
});
