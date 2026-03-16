'use client';

import React, { memo, useMemo } from 'react';
import { PieChart } from 'lucide-react';
import type { PoolSummary } from './types';
import { ASSET_COLORS, ASSET_ICONS } from './utils';

interface AllocationChartProps {
  allocations: PoolSummary['allocations'];
  assets?: string[];
}

export const AllocationChart = memo(function AllocationChart({ allocations, assets }: AllocationChartProps) {
  const activeAllocations = useMemo(() => {
    if (!allocations) return [];
    return Object.entries(allocations)
      .map(([asset, alloc]) => ({
        asset,
        percent: typeof alloc === 'number' ? alloc : ((alloc as any)?.percentage ?? 0),
      }))
      .filter(({ percent }) => percent > 0);
  }, [allocations]);

  return (
    <div className="p-4 border-b border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <PieChart className="w-4 h-4" />
          Current Allocation
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {assets?.join(' • ') || 'Multi-Asset'}
        </span>
      </div>

      {activeAllocations.length > 0 ? (
        <>
          {/* Allocation Bar */}
          <div className="h-6 rounded-full overflow-hidden flex mb-3 bg-gray-200 dark:bg-gray-700">
            {activeAllocations.map(({ asset, percent }) => (
              <div
                key={asset}
                className={`${ASSET_COLORS[asset] || 'bg-gray-500'} flex items-center justify-center text-xs text-white font-semibold transition-all duration-500`}
                style={{ width: `${Math.max(percent, 5)}%` }}
              >
                {percent >= 10 && `${asset} ${Math.round(percent)}%`}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4">
            {activeAllocations.map(({ asset, percent }) => (
              <div key={asset} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${ASSET_COLORS[asset] || 'bg-gray-500'}`} />
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-medium">{ASSET_ICONS[asset] || ''} {asset}</span> {Math.round(percent)}%
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
          No allocations yet. Deposit to start earning.
        </div>
      )}
    </div>
  );
});
