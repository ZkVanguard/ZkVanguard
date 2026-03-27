'use client';

import React, { memo, useMemo } from 'react';
import { Wallet } from 'lucide-react';
import type { UserPosition, ChainKey } from './types';
import { formatUSD, formatPercent } from './utils';

interface UserPositionCardProps {
  userPosition: UserPosition;
  selectedChain: ChainKey;
  chainName: string;
}

export const UserPositionCard = memo(function UserPositionCard({
  userPosition,
  selectedChain,
  chainName,
}: UserPositionCardProps) {
  const isSui = selectedChain === 'sui';

  const valueDisplay = useMemo(() => {
    if (isSui) {
      // USDC pool: 1 share = 1 USDC, show value in USD
      const usdcVal = Number(userPosition.valueUSD) || Number(userPosition.shares) || 0;
      return formatUSD(usdcVal);
    }
    return formatUSD(userPosition.valueUSD);
  }, [isSui, userPosition.valueUSD, userPosition.shares]);

  const valueSubtext = useMemo(() => {
    if (isSui) return 'Current Value (USDC)';
    return 'Current Value';
  }, [isSui]);

  const txCount = (userPosition.depositCount || 0) + (userPosition.withdrawalCount || 0);

  return (
    <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
      <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
        <Wallet className="w-4 h-4" />
        Your Position
        <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-2">
          on {chainName}
        </span>
      </h3>

      {userPosition.isMember ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
              {(Number(userPosition.shares) || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Your Shares</p>
          </div>
          <div>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{valueDisplay}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{valueSubtext}</p>
          </div>
          <div>
            <p className="text-xl font-bold text-purple-600 dark:text-purple-400">
              {formatPercent(userPosition.percentage)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Pool Ownership</p>
          </div>
          <div>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{txCount}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Transactions</p>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          You haven't joined the {chainName} pool yet. Deposit to receive shares.
        </p>
      )}
    </div>
  );
});
