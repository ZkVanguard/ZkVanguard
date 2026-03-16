'use client';

import React, { memo } from 'react';
import { Award } from 'lucide-react';
import type { LeaderboardEntry } from './types';
import { formatPercent } from './utils';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

const RANK_STYLES = [
  'bg-yellow-500 text-white',
  'bg-gray-400 text-white',
  'bg-orange-600 text-white',
];

export const Leaderboard = memo(function Leaderboard({ entries }: LeaderboardProps) {
  if (entries.length === 0) return null;

  return (
    <div className="p-4">
      <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
        <Award className="w-4 h-4 text-yellow-500" />
        Top Shareholders
      </h3>
      <div className="space-y-2">
        {entries
          .filter((user) => user?.walletAddress)
          .map((user, index) => (
            <div
              key={user.walletAddress}
              className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                    RANK_STYLES[index] || 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-300 font-mono">
                  {user.walletAddress?.slice(0, 6)}...{user.walletAddress?.slice(-4)}
                </span>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {user.shares.toFixed(2)} shares
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatPercent(user.percentage)}
                </p>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
});
