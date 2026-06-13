'use client';

import React, { memo } from 'react';
import { TrendingUp, TrendingDown, Shield } from 'lucide-react';
import type { PoolHedge } from './types';

interface HedgesPanelProps {
  hedges: PoolHedge[] | undefined;
}

/**
 * Compact display of the SUI pool's active BlueFin perp hedges.
 *
 * The pool runs a directional perp leg on BlueFin alongside the spot
 * allocation (e.g. ETH-PERP SHORT against the prediction-market signal).
 * These positions contribute to the pool's NAV but aren't part of the
 * spot allocation chart, so without surfacing them here members had no
 * way to see "what hedges am I exposed to?".
 *
 * Operational micro-hedges (notional < $1, transport entries used by the
 * cron to move USDC pool→admin) are filtered server-side and never show
 * up here — they're accounting artifacts, not directional bets.
 */
export const HedgesPanel = memo(function HedgesPanel({ hedges }: HedgesPanelProps) {
  if (!hedges || hedges.length === 0) return null;

  const totalNotional = hedges.reduce((s, h) => s + h.notionalValue, 0);
  const totalPnl = hedges.reduce((s, h) => s + h.currentPnl, 0);
  const pnlColor = totalPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';

  return (
    <div className="p-4 border-b border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-purple-500" />
          Active Hedges (BlueFin)
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-2">
            {hedges.length} position{hedges.length === 1 ? '' : 's'}
          </span>
        </h3>
        <div className="text-right text-xs">
          <div className="text-gray-500 dark:text-gray-400">Total notional</div>
          <div className="font-medium text-gray-900 dark:text-white">${totalNotional.toFixed(2)}</div>
        </div>
      </div>

      <div className="space-y-2">
        {hedges.map((h) => {
          const isLong = h.side === 'LONG';
          const sideColor = isLong
            ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
            : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
          const hedgePnlColor = h.currentPnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
          const SideIcon = isLong ? TrendingUp : TrendingDown;
          return (
            <div
              key={h.id}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700"
            >
              <div className="flex items-center gap-3">
                <div className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 ${sideColor}`}>
                  <SideIcon className="w-3 h-3" />
                  {h.side}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{h.market}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {h.size.toFixed(h.market.startsWith('BTC') ? 6 : h.market.startsWith('ETH') ? 5 : 2)}
                    {' @ '}
                    {h.leverage}x
                    {h.entryPrice > 0 && ` • entry $${h.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  ${h.notionalValue.toFixed(2)}
                </div>
                <div className={`text-xs font-medium ${hedgePnlColor}`}>
                  {h.currentPnl >= 0 ? '+' : ''}${h.currentPnl.toFixed(2)} PnL
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs">
        <span className="text-gray-500 dark:text-gray-400">
          Direction-driven hedges, settled via BlueFin perps. Counts toward pool NAV.
        </span>
        <span className={`font-medium ${pnlColor}`}>
          Total {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
        </span>
      </div>
    </div>
  );
});
