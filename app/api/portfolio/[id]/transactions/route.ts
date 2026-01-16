import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { cronosTestnet } from 'viem/chains';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';

// Disable caching for this API route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    console.log('[Transactions API] Starting...');
    const { id } = await context.params;
    console.log('[Transactions API] Portfolio ID:', id);
    const portfolioId = BigInt(id);
    
    console.log(`[Transactions API] Fetching transactions for portfolio ${portfolioId}...`);
    
    const client = createPublicClient({
      chain: cronosTestnet,
      transport: http('https://evm-t3.cronos.org'),
    });

    const addresses = getContractAddresses(338);
    console.log('[Transactions API] RWA Manager:', addresses.rwaManager);
    
    // Get current block number
    const currentBlock = await client.getBlockNumber();
    console.log('[Transactions API] Current block:', currentBlock);
    
    // Cronos testnet has a max range of 2000 blocks, scan in chunks
    const CHUNK_SIZE = 1999n;
    const lookback = 10000n;
    const fromBlock = currentBlock > lookback ? currentBlock - lookback : 0n;
    
    console.log(`[Transactions API] Scanning blocks ${fromBlock} to ${currentBlock}`);

    const depositLogs = [];
    const withdrawLogs = [];
    const rebalanceLogs = [];

    // Scan in chunks to avoid RPC limits
    let start = fromBlock;
    while (start <= currentBlock) {
      const end = start + CHUNK_SIZE > currentBlock ? currentBlock : start + CHUNK_SIZE;
      
      console.log(`[Transactions API] Chunk: ${start} to ${end}`);

      // Fetch deposit events for this chunk
      const chunkDeposits = await client.getLogs({
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
        args: {
          portfolioId,
        },
        fromBlock: start,
        toBlock: end,
      });
      depositLogs.push(...chunkDeposits);

      // Fetch withdrawal events for this chunk
      const chunkWithdraws = await client.getLogs({
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
        args: {
          portfolioId,
        },
        fromBlock: start,
        toBlock: end,
      });
      withdrawLogs.push(...chunkWithdraws);

      // Fetch rebalance events for this chunk
      const chunkRebalances = await client.getLogs({
        address: addresses.rwaManager as `0x${string}`,
        event: {
          type: 'event',
          name: 'Rebalanced',
          inputs: [
            { type: 'uint256', indexed: true, name: 'portfolioId' },
          ],
        },
        args: {
          portfolioId,
        },
        fromBlock: start,
        toBlock: end,
      });
      rebalanceLogs.push(...chunkRebalances);
      
      start = end + 1n;
    }

    console.log(`[Transactions API] Found ${depositLogs.length} deposits, ${withdrawLogs.length} withdrawals, ${rebalanceLogs.length} rebalances`);

    const transactions: Transaction[] = [];

    // Process deposits
    for (const log of depositLogs) {
      try {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        const token = log.args.token?.toLowerCase() || '';
        const amount = log.args.amount || 0n;
        const decimals = TOKEN_DECIMALS[token] || 18;
        const symbol = TOKEN_SYMBOLS[token] || 'Unknown';
        
        console.log(`Processing deposit: ${symbol} ${amount} at block ${log.blockNumber}`);
        
        transactions.push({
          type: 'deposit',
          timestamp: Number(block.timestamp) * 1000,
          amount: Number(amount) / Math.pow(10, decimals),
          token: symbol,
          txHash: log.transactionHash || '',
          blockNumber: Number(log.blockNumber),
        });
      } catch (err: any) {
        console.error(`Error processing deposit log:`, err.message);
      }
    }

    // Process withdrawals
    for (const log of withdrawLogs) {
      try {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
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
      } catch (err: any) {
        console.error(`Error processing withdrawal log:`, err.message);
      }
    }

    // Process rebalances
    for (const log of rebalanceLogs) {
      try {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        
        transactions.push({
          type: 'rebalance',
          timestamp: Number(block.timestamp) * 1000,
          txHash: log.transactionHash || '',
          blockNumber: Number(log.blockNumber),
        });
      } catch (err: any) {
        console.error(`Error processing rebalance log:`, err.message);
      }
    }

    // Sort by timestamp descending (most recent first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`✅ [Transactions API] Returning ${transactions.length} transactions`);
    if (transactions.length > 0) {
      console.log('Sample transaction:', transactions[0]);
    }

    return NextResponse.json({ transactions }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('[Transactions API] Error:', error?.message || error);
    console.error('[Transactions API] Stack:', error?.stack);
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: error?.message },
      { status: 500 }
    );
  }
}
