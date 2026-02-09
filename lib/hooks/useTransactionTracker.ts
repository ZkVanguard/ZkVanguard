/**
 * Transaction Tracker Hook
 * Automatically track and cache user transactions
 * 
 * Optimized: Only fetches receipts for user txs, not full blocks.
 * Polls every 3rd block (~15s on Cronos) to reduce RPC traffic.
 */

import { useEffect, useRef } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { logger } from '@/lib/utils/logger';
import { addTransactionToCache } from '../utils/transactionCache';

export function useTransactionTracker() {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const lastProcessedBlock = useRef<bigint>(0n);

  useEffect(() => {
    if (!publicClient || !address) return;

    // Track wallet transaction receipts — throttled to every 3rd block
    const unwatch = publicClient.watchBlockNumber({
      pollingInterval: 15_000, // Poll every 15 seconds instead of every block
      onBlockNumber: async (blockNumber) => {
        try {
          // Skip if we've already processed this block or a nearby one
          if (blockNumber <= lastProcessedBlock.current + 2n) return;
          lastProcessedBlock.current = blockNumber;

          // Only fetch the block header (no transactions) to check if it's relevant
          const block = await publicClient.getBlock({ 
            blockNumber,
            includeTransactions: false 
          });

          // If block has no transactions, skip entirely
          if (!block.transactions || block.transactions.length === 0) return;

          // Check each tx hash — only fetch full tx data for user's transactions
          for (const txHash of block.transactions) {
            if (typeof txHash !== 'string') continue;
            
            try {
              // Use getTransactionReceipt which is lighter than getTransaction
              const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
              
              if (
                receipt.from?.toLowerCase() === address.toLowerCase() ||
                receipt.to?.toLowerCase() === address.toLowerCase()
              ) {
                addTransactionToCache({
                  hash: txHash,
                  type: 'unknown',
                  status: receipt.status === 'success' ? 'success' : 'failed',
                  timestamp: Date.now(),
                  from: receipt.from || '',
                  to: receipt.to || '',
                  value: '0',
                  blockNumber: Number(blockNumber),
                });
              }
            } catch {
              // Skip individual tx errors
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
