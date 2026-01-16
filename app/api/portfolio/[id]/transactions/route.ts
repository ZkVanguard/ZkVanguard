import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { cronosTestnet } from 'viem/chains';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { RWA_MANAGER_ABI } from '@/lib/contracts/abis';

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
  blockNumber: bigint;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const portfolioId = BigInt(id);
    
    console.log(`[Transactions API] Fetching transactions for portfolio ${portfolioId}...`);
    
    const client = createPublicClient({
      chain: cronosTestnet,
      transport: http('https://evm-t3.cronos.org'),
    });

    const addresses = getContractAddresses(338);
    
    // Get current block number
    const currentBlock = await client.getBlockNumber();
    const fromBlock = currentBlock - 10000n; // Look back ~10000 blocks (adjust based on chain)
    
    console.log(`[Transactions API] Scanning blocks ${fromBlock} to ${currentBlock}`);

    // Fetch deposit events
    const depositLogs = await client.getLogs({
      address: addresses.rwaManager as `0x${string}`,
      event: {
        type: 'event',
        name: 'Deposited',
        inputs: [
          { type: 'uint256', indexed: true, name: 'portfolioId' },
          { type: 'address', indexed: true, name: 'token' },
          { type: 'uint256', indexed: false, name: 'amount' },
        ],
      },
      args: {
        portfolioId,
      },
      fromBlock,
      toBlock: 'latest',
    });

    // Fetch withdrawal events
    const withdrawLogs = await client.getLogs({
      address: addresses.rwaManager as `0x${string}`,
      event: {
        type: 'event',
        name: 'Withdrawn',
        inputs: [
          { type: 'uint256', indexed: true, name: 'portfolioId' },
          { type: 'address', indexed: true, name: 'token' },
          { type: 'uint256', indexed: false, name: 'amount' },
        ],
      },
      args: {
        portfolioId,
      },
      fromBlock,
      toBlock: 'latest',
    });

    // Fetch rebalance events
    const rebalanceLogs = await client.getLogs({
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
      fromBlock,
      toBlock: 'latest',
    });

    console.log(`[Transactions API] Found ${depositLogs.length} deposits, ${withdrawLogs.length} withdrawals, ${rebalanceLogs.length} rebalances`);

    const transactions: Transaction[] = [];

    // Process deposits
    for (const log of depositLogs) {
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      const token = log.args.token?.toLowerCase() || '';
      const amount = log.args.amount || 0n;
      const decimals = TOKEN_DECIMALS[token] || 18;
      const symbol = TOKEN_SYMBOLS[token] || 'Unknown';
      
      transactions.push({
        type: 'deposit',
        timestamp: Number(block.timestamp) * 1000,
        amount: Number(amount) / Math.pow(10, decimals),
        token: symbol,
        txHash: log.transactionHash || '',
        blockNumber: log.blockNumber,
      });
    }

    // Process withdrawals
    for (const log of withdrawLogs) {
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
        blockNumber: log.blockNumber,
      });
    }

    // Process rebalances
    for (const log of rebalanceLogs) {
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      
      transactions.push({
        type: 'rebalance',
        timestamp: Number(block.timestamp) * 1000,
        txHash: log.transactionHash || '',
        blockNumber: log.blockNumber,
      });
    }

    // Sort by timestamp descending (most recent first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`✅ [Transactions API] Returning ${transactions.length} transactions`);

    return NextResponse.json({ transactions });
  } catch (error: any) {
    console.error('[Transactions API] Error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: error?.message },
      { status: 500 }
    );
  }
}
