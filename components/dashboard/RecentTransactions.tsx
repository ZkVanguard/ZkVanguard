'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePublicClient, useChainId } from 'wagmi';
import { formatUnits, formatEther } from 'viem';
import { 
  ArrowDownUp, 
  ArrowDown, 
  ArrowUp, 
  CheckCircle, 
  Clock, 
  XCircle, 
  ExternalLink,
  RefreshCw,
  Filter,
  Loader2
} from 'lucide-react';

interface Transaction {
  hash: string;
  type: 'swap' | 'deposit' | 'withdraw' | 'approve' | 'transfer' | 'unknown';
  status: 'success' | 'pending' | 'failed';
  timestamp: number;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  amountIn?: string;
  amountOut?: string;
  tokenIn?: string;
  tokenOut?: string;
  gasUsed?: string;
  blockNumber?: number;
}

interface RecentTransactionsProps {
  address: string;
}

// Known contract addresses for identifying transaction types
const KNOWN_CONTRACTS: Record<string, { name: string; type: 'dex' | 'token' | 'portfolio' }> = {
  '0x145863eb42cf62847a6ca784e6416c1682b1b2ae': { name: 'VVS Router', type: 'dex' },
  '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4': { name: 'WCRO', type: 'token' },
  '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0': { name: 'devUSDC', type: 'token' },
};

// Method signatures for identifying transaction types
const METHOD_SIGNATURES: Record<string, { name: string; type: Transaction['type'] }> = {
  '0x38ed1739': { name: 'swapExactTokensForTokens', type: 'swap' },
  '0x7ff36ab5': { name: 'swapExactETHForTokens', type: 'swap' },
  '0x18cbafe5': { name: 'swapExactTokensForETH', type: 'swap' },
  '0x095ea7b3': { name: 'approve', type: 'approve' },
  '0xa9059cbb': { name: 'transfer', type: 'transfer' },
  '0x23b872dd': { name: 'transferFrom', type: 'transfer' },
  '0xd0e30db0': { name: 'deposit', type: 'deposit' },
  '0x2e1a7d4d': { name: 'withdraw', type: 'withdraw' },
  '0x47e7ef24': { name: 'deposit', type: 'deposit' },
  '0xf3fef3a3': { name: 'withdraw', type: 'withdraw' },
};

export function RecentTransactions({ address }: RecentTransactionsProps) {
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'swap' | 'deposit' | 'withdraw'>('all');
  const [error, setError] = useState<string | null>(null);

  const explorerUrl = chainId === 338 
    ? 'https://explorer.cronos.org/testnet' 
    : 'https://explorer.cronos.org';
  
  const network = chainId === 338 ? 'testnet' : 'mainnet';

  const fetchTransactions = useCallback(async (showRefreshIndicator = false) => {
    if (!publicClient || !address || address === '0x0000...0000') {
      setLoading(false);
      return;
    }

    if (showRefreshIndicator) setRefreshing(true);
    setError(null);

    try {
      console.log('Fetching transactions for address:', address);
      
      // Try to fetch from Cronos Explorer API first (more comprehensive)
      let txList: Transaction[] = [];
      
      try {
        // Fetch normal transactions from explorer API via proxy (avoids CORS)
        const response = await fetch(
          `/api/cronos-explorer?address=${address}&limit=50&network=${network}`
        );
        
        if (response.ok) {
          const data = await response.json();
          console.log('Explorer API response:', data);
          
          if (data.result && Array.isArray(data.result)) {
            txList = data.result.map((tx: any) => {
              // Determine transaction type from input data or method name
              let txType: Transaction['type'] = 'unknown';
              const methodSig = tx.input?.slice(0, 10)?.toLowerCase() || '';
              const methodInfo = METHOD_SIGNATURES[methodSig];
              
              if (methodInfo) {
                txType = methodInfo.type;
              } else if (tx.to?.toLowerCase() === '0x145863eb42cf62847a6ca784e6416c1682b1b2ae') {
                txType = 'swap'; // VVS Router
              } else if (tx.value && BigInt(tx.value) > 0) {
                txType = tx.from?.toLowerCase() === address.toLowerCase() ? 'withdraw' : 'deposit';
              }
              
              return {
                hash: tx.hash,
                type: txType,
                status: tx.status === '1' || tx.status === 1 || tx.txreceipt_status === '1' ? 'success' : 'failed',
                timestamp: tx.timeStamp ? Number(tx.timeStamp) * 1000 : Date.now(),
                from: tx.from || '',
                to: tx.to || '',
                value: tx.value ? formatEther(BigInt(tx.value)) : '0',
                gasUsed: tx.gasUsed && tx.gasPrice 
                  ? formatEther(BigInt(tx.gasUsed) * BigInt(tx.gasPrice))
                  : '0',
                blockNumber: tx.blockNumber ? Number(tx.blockNumber) : 0,
              } as Transaction;
            });
          }
        }
      } catch (apiError) {
        console.log('Explorer API not available, falling back to RPC:', apiError);
      }

      // If API didn't return results, fall back to RPC log scanning
      if (txList.length === 0) {
        console.log('Falling back to RPC log scanning...');
        
        // Get recent blocks to scan for transactions
        const currentBlock = await publicClient.getBlockNumber();
        // Cronos RPC has a 2000 block limit per request, scan last 2000 blocks
        const fromBlock = currentBlock > BigInt(2000) ? currentBlock - BigInt(2000) : BigInt(0);
        
        console.log(`Scanning blocks ${fromBlock} to ${currentBlock} (2000 block limit)`);

        // Fetch transactions using logs
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const swapTopic = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
        
        const [sentLogs, receivedLogs, swapLogs] = await Promise.all([
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            topics: [
              transferTopic,
              `0x000000000000000000000000${address.slice(2).toLowerCase()}`,
            ],
          }).catch((e) => { console.log('Sent logs error:', e); return []; }),
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            topics: [
              transferTopic,
              null,
              `0x000000000000000000000000${address.slice(2).toLowerCase()}`,
            ],
          }).catch((e) => { console.log('Received logs error:', e); return []; }),
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            topics: [swapTopic],
          }).catch((e) => { console.log('Swap logs error:', e); return []; }),
        ]);

        console.log(`Found logs - Sent: ${sentLogs.length}, Received: ${receivedLogs.length}, Swaps: ${swapLogs.length}`);

        // Filter swap logs to only include those where user was involved
        const userSwapLogs = swapLogs.filter(log => 
          log.topics.some(topic => 
            topic?.toLowerCase().includes(address.slice(2).toLowerCase())
          )
        );

        const allLogs = [...sentLogs, ...receivedLogs, ...userSwapLogs];
        const uniqueTxHashes = [...new Set(allLogs.map(log => log.transactionHash))].slice(0, 30);
        
        console.log(`Unique transaction hashes: ${uniqueTxHashes.length}`);

        // Fetch transaction details
        const txPromises = uniqueTxHashes.map(async (hash) => {
          try {
            const [tx, receipt] = await Promise.all([
              publicClient.getTransaction({ hash }),
              publicClient.getTransactionReceipt({ hash }),
            ]);

            const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
            
            const methodSig = tx.input.slice(0, 10).toLowerCase();
            const methodInfo = METHOD_SIGNATURES[methodSig];
            
            let txType: Transaction['type'] = methodInfo?.type || 'unknown';
            
            const toAddress = tx.to?.toLowerCase();
            if (toAddress && KNOWN_CONTRACTS[toAddress]) {
              const contract = KNOWN_CONTRACTS[toAddress];
              if (contract.type === 'dex') {
                txType = 'swap';
              }
            }

            const isSent = tx.from.toLowerCase() === address.toLowerCase();
            if (txType === 'transfer') {
              txType = isSent ? 'withdraw' : 'deposit';
            }
            
            if (txType === 'unknown' && tx.value > BigInt(0)) {
              txType = isSent ? 'withdraw' : 'deposit';
            }

            return {
              hash: hash,
              type: txType,
              status: receipt.status === 'success' ? 'success' : 'failed',
              timestamp: Number(block.timestamp) * 1000,
              from: tx.from,
              to: tx.to || '',
              value: formatEther(tx.value),
              gasUsed: formatEther(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)),
              blockNumber: Number(receipt.blockNumber),
            } as Transaction;
          } catch (err) {
            console.error('Error fetching tx:', hash, err);
            return null;
          }
        });

        const results = await Promise.all(txPromises);
        txList = results.filter((tx): tx is Transaction => tx !== null);
      }

      // Sort by timestamp descending
      txList.sort((a, b) => b.timestamp - a.timestamp);
      
      console.log(`Final transaction count: ${txList.length}`);
      setTransactions(txList);
    } catch (err) {
      console.error('Error fetching transactions:', err);
      setError('Failed to fetch transactions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [publicClient, address, network]);

  useEffect(() => {
    fetchTransactions();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchTransactions(false), 30000);
    return () => clearInterval(interval);
  }, [fetchTransactions]);

  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'swap') return tx.type === 'swap';
    if (filter === 'deposit') return tx.type === 'deposit' || tx.type === 'transfer';
    if (filter === 'withdraw') return tx.type === 'withdraw';
    return true;
  });

  const getTypeIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'swap':
        return <ArrowDownUp className="w-4 h-4 text-cyan-400" />;
      case 'deposit':
        return <ArrowDown className="w-4 h-4 text-green-400" />;
      case 'withdraw':
        return <ArrowUp className="w-4 h-4 text-orange-400" />;
      case 'approve':
        return <CheckCircle className="w-4 h-4 text-purple-400" />;
      default:
        return <ArrowDownUp className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusIcon = (status: Transaction['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-400 animate-pulse" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
    }
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  if (!address || address === '0x0000...0000') {
    return (
      <div className="glass rounded-2xl p-6 border border-white/10">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <ArrowDownUp className="w-5 h-5 text-cyan-400" />
          Recent Transactions
        </h3>
        <div className="text-center py-8 text-gray-400">
          <p>Connect your wallet to view transactions</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <ArrowDownUp className="w-5 h-5 text-cyan-400" />
          Recent Transactions
        </h3>
        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            {(['all', 'swap', 'deposit', 'withdraw'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-cyan-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          
          {/* Refresh */}
          <button
            onClick={() => fetchTransactions(true)}
            disabled={refreshing}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-400">
          <XCircle className="w-8 h-8 mx-auto mb-2" />
          <p>{error}</p>
          <button
            onClick={() => fetchTransactions(true)}
            className="mt-2 text-sm text-cyan-400 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <ArrowDownUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="font-medium">No transactions found</p>
          <p className="text-xs mt-1 mb-4">Transactions will appear here after you make swaps, deposits, or withdrawals</p>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => fetchTransactions(true)}
              className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
            <a
              href={`${explorerUrl}/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-cyan-400 flex items-center gap-1"
            >
              View address on Explorer <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTransactions.map((tx) => (
            <div
              key={tx.hash}
              className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                {/* Type Icon */}
                <div className="p-2 bg-gray-900 rounded-lg">
                  {getTypeIcon(tx.type)}
                </div>
                
                {/* Details */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold capitalize">{tx.type}</span>
                    {getStatusIcon(tx.status)}
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-2">
                    <span className="font-mono">{tx.hash.slice(0, 8)}...{tx.hash.slice(-6)}</span>
                    <span>•</span>
                    <span>{formatTime(tx.timestamp)}</span>
                  </div>
                </div>
              </div>

              {/* Value & Link */}
              <div className="flex items-center gap-3">
                {parseFloat(tx.value) > 0 && (
                  <div className="text-right">
                    <div className="font-semibold text-sm">
                      {parseFloat(tx.value).toFixed(4)} CRO
                    </div>
                    {tx.gasUsed && (
                      <div className="text-xs text-gray-500">
                        Gas: {parseFloat(tx.gasUsed).toFixed(6)}
                      </div>
                    )}
                  </div>
                )}
                <a
                  href={`${explorerUrl}/tx/${tx.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4 text-gray-400 hover:text-cyan-400" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {filteredTransactions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Showing {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
          </span>
          <a
            href={`${explorerUrl}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
          >
            View all on Explorer <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}
