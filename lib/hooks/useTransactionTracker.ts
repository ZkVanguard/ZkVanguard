/**
 * Transaction Tracker Hook
 * Automatically track and cache user transactions
 */

import { useEffect } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { logger } from '@/lib/utils/logger';
import { addTransactionToCache } from '../utils/transactionCache';

export function useTransactionTracker() {
  const publicClient = usePublicClient();
  const { address } = useAccount();

  useEffect(() => {
    if (!publicClient || !address) return;

    // Track wallet transaction receipts
    const unwatch = publicClient.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        try {
          // Get block with transactions
          const block = await publicClient.getBlock({ 
            blockNumber,
            includeTransactions: true 
          });

          // Filter transactions involving the user
          if (block.transactions) {
            for (const tx of block.transactions) {
              const txData = typeof tx === 'string' 
                ? await publicClient.getTransaction({ hash: tx })
                : tx;

              if (
                txData.from?.toLowerCase() === address.toLowerCase() ||
                txData.to?.toLowerCase() === address.toLowerCase()
              ) {
                // Cache user transaction
                addTransactionToCache({
                  hash: txData.hash,
                  type: 'unknown',
                  status: 'success',
                  timestamp: Date.now(),
                  from: txData.from || '',
                  to: txData.to || '',
                  value: txData.value?.toString() || '0',
                  blockNumber: Number(blockNumber),
                });
              }
            }
          }
        } catch (error) {
          // Silently fail - this is background tracking
          logger.debug('Transaction tracking error', { component: 'useTransactionTracker', error: String(error) });
        }
      },
    });

    return () => unwatch();
  }, [publicClient, address]);
}
