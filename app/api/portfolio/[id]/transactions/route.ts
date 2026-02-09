import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { createPublicClient, http, type PublicClient, type Block } from 'viem';
import { cronosTestnet } from 'viem/chains';
import { getContractAddresses } from '@/lib/contracts/addresses';

// Disable caching for this API route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Module-level singleton viem client (reused across requests)
let _viemClient: PublicClient | null = null;
function getViemClient(): PublicClient {
  if (!_viemClient) {
    _viemClient = createPublicClient({
      chain: cronosTestnet,
      transport: http('https://evm-t3.cronos.org', {
        retryCount: 3,
        retryDelay: 500,
        batch: { batchSize: 1 },
      }),
    });
  }
  return _viemClient;
}

// Token symbols mapping
const TOKEN_SYMBOLS: Record<string, string> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 'devUSDC',
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 'WCRO',
};

const TOKEN_DECIMALS: Record<string, number> = {
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': 6,
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': 18,
};

interface Transaction {
  type: 'deposit' | 'withdraw' | 'rebalance';
  timestamp: number;
  amount?: number;
  token?: string;
  changes?: { from: number; to: number; asset: string }[];
  txHash: string;
  blockNumber: number;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    logger.info('[Transactions API] Starting...');
    const { id } = await context.params;
    logger.info(`[Transactions API] Portfolio ID: ${id}`);
    const portfolioId = BigInt(id);
    
    logger.info(`[Transactions API] Fetching transactions for portfolio ${portfolioId}...`);
    
    const client = getViemClient();

    const addresses = getContractAddresses(338);
    logger.info(`[Transactions API] RWA Manager: ${addresses.rwaManager}`);
    
    // Get current block number
    const currentBlock = await client.getBlockNumber();
    logger.info(`[Transactions API] Current block: ${currentBlock}`);
    
    // Cronos testnet has a max range of 2000 blocks, scan in chunks
    const CHUNK_SIZE = 1999n;
    const lookback = 10000n;
    const fromBlock = currentBlock > lookback ? currentBlock - lookback : 0n;
    
    logger.info(`[Transactions API] Scanning blocks ${fromBlock} to ${currentBlock}`);

    const depositLogs = [];
    const withdrawLogs = [];
    const rebalanceLogs = [];

    // Scan in chunks to avoid RPC limits
    let start = fromBlock;
    while (start <= currentBlock) {
      const end = start + CHUNK_SIZE > currentBlock ? currentBlock : start + CHUNK_SIZE;
      
      logger.debug(`[Transactions API] Chunk: ${start} to ${end}`);

      // Fetch all 3 event types in parallel per chunk
      const [chunkDeposits, chunkWithdraws, chunkRebalances] = await Promise.all([
        client.getLogs({
          address: addresses.rwaManager as `0x${string}`,
          event: {
            type: 'event',
            name: 'Deposited',
            inputs: [
              { type: 'uint256', indexed: true, name: 'portfolioId' },
              { type: 'address', indexed: true, name: 'token' },
              { type: 'uint256', indexed: false, name: 'amount' },
              { type: 'address', indexed: true, name: 'depositor' },
            ],
          },
          args: { portfolioId },
          fromBlock: start,
          toBlock: end,
        }),
        client.getLogs({
          address: addresses.rwaManager as `0x${string}`,
          event: {
            type: 'event',
            name: 'Withdrawn',
            inputs: [
              { type: 'uint256', indexed: true, name: 'portfolioId' },
              { type: 'address', indexed: true, name: 'token' },
              { type: 'uint256', indexed: false, name: 'amount' },
              { type: 'address', indexed: true, name: 'recipient' },
            ],
          },
          args: { portfolioId },
          fromBlock: start,
          toBlock: end,
        }),
        client.getLogs({
          address: addresses.rwaManager as `0x${string}`,
          event: {
            type: 'event',
            name: 'Rebalanced',
            inputs: [
              { type: 'uint256', indexed: true, name: 'portfolioId' },
            ],
          },
          args: { portfolioId },
          fromBlock: start,
          toBlock: end,
        }),
      ]);

      depositLogs.push(...chunkDeposits);
      withdrawLogs.push(...chunkWithdraws);
      rebalanceLogs.push(...chunkRebalances);
      
      start = end + 1n;
    }

    logger.info(`[Transactions API] Found ${depositLogs.length} deposits, ${withdrawLogs.length} withdrawals, ${rebalanceLogs.length} rebalances`);

    const transactions: Transaction[] = [];

    // Deduplicate block fetches: collect all unique block numbers, fetch each once
    const allLogs = [
      ...depositLogs.map(l => ({ ...l, _type: 'deposit' as const })),
      ...withdrawLogs.map(l => ({ ...l, _type: 'withdraw' as const })),
      ...rebalanceLogs.map(l => ({ ...l, _type: 'rebalance' as const })),
    ];
    const uniqueBlockNumbers = [...new Set(allLogs.map(l => l.blockNumber))];
    const blockMap = new Map<bigint, Block>();
    
    // Fetch blocks in parallel batches of 5
    for (let i = 0; i < uniqueBlockNumbers.length; i += 5) {
      const batch = uniqueBlockNumbers.slice(i, i + 5);
      const blocks = await Promise.all(
        batch.map(bn => client.getBlock({ blockNumber: bn }).catch(() => null))
      );
      for (let j = 0; j < batch.length; j++) {
        if (blocks[j]) blockMap.set(batch[j], blocks[j]!);
      }
    }

    // Process deposits
    for (const log of depositLogs) {
      try {
        const block = blockMap.get(log.blockNumber);
        if (!block) continue;
        const token = log.args.token?.toLowerCase() || '';
        const amount = log.args.amount || 0n;
        const decimals = TOKEN_DECIMALS[token] || 18;
        const symbol = TOKEN_SYMBOLS[token] || 'Unknown';
        
        logger.debug(`Processing deposit: ${symbol} ${amount} at block ${log.blockNumber}`);
        
        transactions.push({
          type: 'deposit',
          timestamp: Number(block.timestamp) * 1000,
          amount: Number(amount) / Math.pow(10, decimals),
          token: symbol,
          txHash: log.transactionHash || '',
          blockNumber: Number(log.blockNumber),
        });
      } catch (err: unknown) {
        logger.error('Error processing deposit log', err);
      }
    }

    // Process withdrawals
    for (const log of withdrawLogs) {
      try {
        const block = blockMap.get(log.blockNumber);
        if (!block) continue;
        const token = log.args.token?.toLowerCase() || '';
        const amount = log.args.amount || 0n;
        const decimals = TOKEN_DECIMALS[token] || 18;
        const symbol = TOKEN_SYMBOLS[token] || 'Unknown';
        
        transactions.push({
          type: 'withdraw',
          timestamp: Number(block.timestamp) * 1000,
          amount: Number(amount) / Math.pow(10, decimals),
          token: symbol,
          txHash: log.transactionHash || '',
          blockNumber: Number(log.blockNumber),
        });
      } catch (err: unknown) {
        logger.error('Error processing withdrawal log', err);
      }
    }

    // Process rebalances
    for (const log of rebalanceLogs) {
      try {
        const block = blockMap.get(log.blockNumber);
        if (!block) continue;
        
        transactions.push({
          type: 'rebalance',
          timestamp: Number(block.timestamp) * 1000,
          txHash: log.transactionHash || '',
          blockNumber: Number(log.blockNumber),
        });
      } catch (err: unknown) {
        logger.error('Error processing rebalance log', err);
      }
    }

    // Sort by timestamp descending (most recent first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    logger.info(`[Transactions API] Returning ${transactions.length} transactions`);
    if (transactions.length > 0) {
      logger.debug('Sample transaction', { data: transactions[0] });
    }

    return NextResponse.json({ transactions }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: unknown) {
    logger.error('[Transactions API] Error', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
