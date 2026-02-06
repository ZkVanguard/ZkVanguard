'use client';

import { useState, useCallback, memo, useEffect } from 'react';
import { usePublicClient, useChainId } from 'wagmi';
import { formatEther } from 'viem';
import { 
  ArrowDownUp, 
  ArrowDown, 
  ArrowUp, 
  CheckCircle, 
  Clock, 
  XCircle, 
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { usePolling, useLoading } from '@/lib/hooks';
import { logger } from '@/lib/utils/logger';

interface Transaction {
  hash: string;
  type: 'swap' | 'deposit' | 'withdraw' | 'approve' | 'transfer' | 'gasless' | 'unknown';
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

export const RecentTransactions = memo(function RecentTransactions({ address }: RecentTransactionsProps) {
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const { isLoading: loading, error, setError} = useLoading(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'swap' | 'deposit' | 'withdraw'>('all');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const explorerUrl = chainId === 338 
    ? 'https://explorer.cronos.org/testnet' 
    : 'https://explorer.cronos.org';
  
  const network = chainId === 338 ? 'testnet' : 'mainnet';

  // Listen for storage events to update transactions in real-time
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'recent-transactions' && e.newValue) {
        try {
          const newTxs = JSON.parse(e.newValue);
          if (Array.isArray(newTxs)) {
            setTransactions(prev => {
              // Merge new transactions with existing ones
              const merged = [...newTxs];
              prev.forEach(tx => {
                if (!merged.find(t => t.hash === tx.hash)) {
                  merged.push(tx);
                }
              });
              return merged.sort((a, b) => b.timestamp - a.timestamp);
            });
          }
        } catch (err) {
          logger.error('Error parsing storage event', err instanceof Error ? err : undefined, { component: 'RecentTransactions' });
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const fetchTransactions = useCallback(async (showRefreshIndicator = false) => {
    if (!publicClient || !address || address === '0x0000...0000') {
      return;
    }

    if (showRefreshIndicator) setRefreshing(true);

    if (showRefreshIndicator) setRefreshing(true);
    setError(null);

    try {
      logger.debug('Fetching transactions for address', { component: 'RecentTransactions', data: address });
      
      // Try to fetch from Cronos Explorer API first (more comprehensive)
      let txList: Transaction[] = [];
      
      // Platform contract addresses to query
      const PLATFORM_CONTRACTS = [
        '0x44098d0dE36e157b4C1700B48d615285C76fdE47', // X402 Gasless
        '0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b', // Payment Router
        '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189', // RWA Manager (Updated Jan 16, 2026)
        '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8', // ZK Verifier
        '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae', // VVS Router
      ].join(',');
      
      try {
        // Fetch normal transactions from explorer API via proxy (includes platform contracts)
        const response = await fetch(
          `/api/cronos-explorer?address=${address}&contracts=${PLATFORM_CONTRACTS}&limit=50&network=${network}`
        );
        
        if (response.ok) {
          const data = await response.json();
          logger.debug('Explorer API response', { component: 'RecentTransactions', data });
          
          if (data.result && Array.isArray(data.result)) {
            txList = data.result.map((tx: { hash: string; input?: string; to?: string; from?: string; value?: string; status?: string | number; txreceipt_status?: string; timeStamp?: string; gasUsed?: string; gasPrice?: string; blockNumber?: string | number }) => {
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
        logger.debug('Explorer API not available, falling back to RPC', { component: 'RecentTransactions', data: apiError });
      }

      // If API didn't return results, fall back to RPC log scanning
      if (txList.length === 0) {
        logger.debug('Falling back to RPC log scanning...', { component: 'RecentTransactions' });
        
        // Get recent blocks to scan for transactions
        const currentBlock = await publicClient.getBlockNumber();
        // Cronos RPC has a STRICT 2000 block limit per request
        const fromBlock = currentBlock > BigInt(2000) ? currentBlock - BigInt(2000) : BigInt(0);
        
        logger.debug(`Scanning blocks ${fromBlock} to ${currentBlock} (2000 block limit)`, { component: 'RecentTransactions' });

        // Key contract addresses
        const RWA_MANAGER = '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189'; // Portfolio contract (Updated Jan 16, 2026)
        const X402_CONTRACT = '0x44098d0dE36e157b4C1700B48d615285C76fdE47'; // Gasless transactions
        const PAYMENT_ROUTER = '0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b';
        const VVS_ROUTER = '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae';
        const ZK_VERIFIER = '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8';

        // Fetch transactions from ALL relevant contracts
        const [sentLogs, receivedLogs, swapLogs, approvalLogs, rwaLogs, x402Logs, paymentLogs, zkLogs] = await Promise.all([
          // Sent transfers (from user)
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            event: {
              type: 'event',
              name: 'Transfer',
              inputs: [
                { type: 'address', indexed: true, name: 'from' },
                { type: 'address', indexed: true, name: 'to' },
                { type: 'uint256', indexed: false, name: 'value' }
              ]
            },
            args: {
              from: address as `0x${string}`
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('Sent logs error', { data: e }); return []; }),
          // Received transfers (to user)
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            event: {
              type: 'event',
              name: 'Transfer',
              inputs: [
                { type: 'address', indexed: true, name: 'from' },
                { type: 'address', indexed: true, name: 'to' },
                { type: 'uint256', indexed: false, name: 'value' }
              ]
            },
            args: {
              to: address as `0x${string}`
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('Received logs error', { data: e }); return []; }),
          // Swap events from VVS Router
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            address: VVS_ROUTER as `0x${string}`,
            event: {
              type: 'event',
              name: 'Swap',
              inputs: []
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('Swap logs error', { data: e }); return []; }),
          // Approval events
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            event: {
              type: 'event',
              name: 'Approval',
              inputs: [
                { type: 'address', indexed: true, name: 'owner' },
                { type: 'address', indexed: true, name: 'spender' },
                { type: 'uint256', indexed: false, name: 'value' }
              ]
            },
            args: {
              owner: address as `0x${string}`
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('Approval logs error', { data: e }); return []; }),
          // RWAManager events (Portfolio deposits, withdrawals, rebalances)
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            address: RWA_MANAGER as `0x${string}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('RWA logs error', { data: e }); return []; }),
          // X402 Gasless transactions
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            address: X402_CONTRACT as `0x${string}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('X402 logs error', { data: e }); return []; }),
          // PaymentRouter events
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            address: PAYMENT_ROUTER as `0x${string}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('Payment logs error', { data: e }); return []; }),
          // ZKVerifier events
          publicClient.getLogs({
            fromBlock,
            toBlock: currentBlock,
            address: ZK_VERIFIER as `0x${string}`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any).catch((e) => { logger.debug('ZK logs error', { data: e }); return []; }),
        ]);

        logger.debug(`Found logs - Sent: ${sentLogs.length}, Received: ${receivedLogs.length}, Swaps: ${swapLogs.length}, Approvals: ${approvalLogs.length}, RWA: ${rwaLogs.length}, X402: ${x402Logs.length}, Payment: ${paymentLogs.length}, ZK: ${zkLogs.length}`, { component: 'RecentTransactions' });

        // Filter swap logs to only include those where user was involved
        const userSwapLogs = swapLogs.filter(log => 
          log.topics.some(topic => 
            topic?.toLowerCase().includes(address.slice(2).toLowerCase())
          )
        );

        // Filter RWA logs for user transactions
        const userRWALogs = rwaLogs.filter(log =>
          log.topics.some(topic =>
            topic?.toLowerCase().includes(address.slice(2).toLowerCase())
          ) || log.data.toLowerCase().includes(address.slice(2).toLowerCase())
        );

        // Filter X402 logs for user transactions
        const userX402Logs = x402Logs.filter(log =>
          log.topics.some(topic =>
            topic?.toLowerCase().includes(address.slice(2).toLowerCase())
          ) || log.data.toLowerCase().includes(address.slice(2).toLowerCase())
        );

        // Combine all logs
        const allLogs = [...sentLogs, ...receivedLogs, ...userSwapLogs, ...approvalLogs, ...userRWALogs, ...userX402Logs, ...paymentLogs, ...zkLogs];
        const uniqueTxHashes = [...new Set(allLogs.map(log => log.transactionHash))].slice(0, 50);
        
        logger.debug(`Unique transaction hashes: ${uniqueTxHashes.length}`, { component: 'RecentTransactions' });

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
              gasUsed: (receipt.gasUsed && receipt.effectiveGasPrice) 
                ? formatEther(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice))
                : '0',
              blockNumber: Number(receipt.blockNumber),
            } as Transaction;
          } catch (err) {
            logger.error('Error fetching tx', err instanceof Error ? err : undefined, { component: 'RecentTransactions', data: hash });
            return null;
          }
        });

        const results = await Promise.all(txPromises);
        txList = results.filter((tx): tx is Transaction => tx !== null);
      }

      // Add hedge settlements from localStorage (real user transactions only)
      logger.debug(`Transactions from RPC: ${txList.length}, checking for hedge settlements...`, { component: 'RecentTransactions' });
      
      // Add hedge settlements from localStorage
      try {
        const settlementsStr = localStorage.getItem('hedge-settlements');
        if (settlementsStr) {
          const settlements = JSON.parse(settlementsStr);
          Object.values(settlements).forEach((batch: unknown) => {
            const batchData = batch as { closedAt?: number; managerSignature?: string; batchId?: string; finalPnL?: number };
            if (batchData.closedAt) {
              const hedgeHash = batchData.managerSignature || `0x${batchData.batchId}`;
              if (!txList.find(tx => tx.hash === hedgeHash)) {
                txList.push({
                  hash: hedgeHash,
                  type: 'swap',
                  status: 'success',
                  timestamp: batchData.closedAt,
                  from: address,
                  to: '0x0000000000000000000000000000000000000000', // Hedge settlement
                  value: (batchData.finalPnL || 0).toFixed(2),
                  tokenSymbol: 'USD',
                  gasUsed: '0',
                  blockNumber: 0,
                });
              }
            }
          });
        }
      } catch (e) {
        logger.debug('Could not load hedge settlements', { component: 'RecentTransactions', data: e });
      }
      
      // Check for cached transactions in localStorage
      try {
        const cachedTxsStr = localStorage.getItem('recent-transactions');
        if (cachedTxsStr) {
          const cachedTxs = JSON.parse(cachedTxsStr);
          cachedTxs.forEach((cachedTx: Transaction) => {
            if (!txList.find(tx => tx.hash === cachedTx.hash)) {
              txList.push(cachedTx);
            }
          });
        }
      } catch (e) {
        logger.debug('Could not load cached transactions', { component: 'RecentTransactions', data: e });
      }
      
      // Sort by timestamp descending (most recent first)
      txList.sort((a, b) => b.timestamp - a.timestamp);
      
      // Cache the combined list for next time
      try {
        localStorage.setItem('recent-transactions', JSON.stringify(txList.slice(0, 20)));
      } catch (e) {
        logger.debug('Could not cache transactions', { component: 'RecentTransactions', data: e });
      }
      
      logger.debug(`Final transaction count: ${txList.length}`, { component: 'RecentTransactions', data: { types: txList.map(tx => tx.type).join(', '), first3: txList.slice(0, 3) } });
      setTransactions(txList);
    } catch (err) {
      logger.error('Error fetching transactions', err instanceof Error ? err : undefined, { component: 'RecentTransactions' });
      setError('Failed to fetch transactions');
    } finally {
      setRefreshing(false);
    }
  }, [publicClient, address, network, setError]);

  // Use custom polling hook - replaces 5 lines of useEffect logic
  usePolling(fetchTransactions, 30000);

  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'swap') return tx.type === 'swap';
    if (filter === 'deposit') return tx.type === 'deposit' || tx.type === 'transfer';
    if (filter === 'withdraw') return tx.type === 'withdraw';
    return true;
  });

  logger.debug(`Transactions in state: ${transactions.length}, Filtered: ${filteredTransactions.length}, Filter: ${filter}`, { component: 'RecentTransactions' });

  const getTypeIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'swap':
        return <ArrowDownUp className="w-3.5 h-3.5" />;
      case 'deposit':
        return <ArrowDown className="w-3.5 h-3.5" />;
      case 'withdraw':
        return <ArrowUp className="w-3.5 h-3.5" />;
      case 'approve':
        return <CheckCircle className="w-3.5 h-3.5" />;
      default:
        return <ArrowDownUp className="w-3.5 h-3.5" />;
    }
  };

  const getTypeStyles = (type: Transaction['type']) => {
    switch (type) {
      case 'swap': return { bg: 'bg-[#007AFF]', text: 'text-[#007AFF]' };
      case 'deposit': return { bg: 'bg-[#34C759]', text: 'text-[#34C759]' };
      case 'withdraw': return { bg: 'bg-[#FF9500]', text: 'text-[#FF9500]' };
      case 'approve': return { bg: 'bg-[#AF52DE]', text: 'text-[#AF52DE]' };
      default: return { bg: 'bg-[#86868b]', text: 'text-[#86868b]' };
    }
  };

  const getStatusIcon = (status: Transaction['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-[#34C759]" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-[#FF9500] animate-pulse" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-[#FF3B30]" />;
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
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-[#007AFF] rounded-[12px] flex items-center justify-center">
            <ArrowDownUp className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-[17px] font-semibold text-[#1d1d1f]">History</h3>
        </div>
        <div className="text-center py-8 bg-[#f5f5f7] rounded-[14px]">
          <p className="text-[14px] text-[#86868b]">Connect wallet to view history</p>
        </div>
      </div>
    );
  }

  const displayTransactions = showAll ? filteredTransactions : filteredTransactions.slice(0, 5);

  return (
    <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 overflow-hidden">
      {/* Header - Collapseable */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between active:bg-[#f9f9f9] sm:hover:bg-[#f9f9f9] transition-colors"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-[#007AFF] rounded-[10px] sm:rounded-[12px] flex items-center justify-center">
            <ArrowDownUp className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">History</h3>
              {transactions.length > 0 && (
                <span className="px-1.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] text-[10px] font-bold rounded-full">
                  {transactions.length}
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-[12px] text-[#86868b]">Recent transactions</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              fetchTransactions(true);
            }}
            disabled={refreshing}
            className="w-8 h-8 flex items-center justify-center bg-[#f5f5f7] rounded-full"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#86868b] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {isCollapsed ? (
            <ChevronDown className="w-5 h-5 text-[#86868b]" />
          ) : (
            <ChevronUp className="w-5 h-5 text-[#86868b]" />
          )}
        </div>
      </button>

      {!isCollapsed && (
        <>
          {/* Filter Pills */}
          <div className="px-4 sm:px-6 pb-3">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
              {(['all', 'swap', 'deposit', 'withdraw'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all whitespace-nowrap ${
                    filter === f
                      ? 'bg-[#007AFF] text-white'
                      : 'bg-[#f5f5f7] text-[#86868b] active:bg-[#e8e8ed]'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="px-4 sm:px-6 pb-6">
              <div className="flex items-center justify-center py-8">
                <div className="w-7 h-7 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          ) : error ? (
            <div className="px-4 sm:px-6 pb-6">
              <div className="text-center py-6 bg-[#f5f5f7] rounded-[14px]">
                <div className="w-12 h-12 bg-[#FF3B30]/10 rounded-[14px] flex items-center justify-center mx-auto mb-3">
                  <XCircle className="w-6 h-6 text-[#FF3B30]" />
                </div>
                <p className="text-[15px] text-[#1d1d1f] mb-2">{error}</p>
                <button
                  onClick={() => fetchTransactions(true)}
                  className="text-[13px] text-[#007AFF] font-medium"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="px-4 sm:px-6 pb-6">
              <div className="text-center py-8 bg-[#f5f5f7] rounded-[14px]">
                <ArrowDownUp className="w-8 h-8 text-[#86868b] mx-auto mb-2 opacity-50" />
                <p className="text-[14px] font-medium text-[#1d1d1f] mb-1">No transactions found</p>
                <p className="text-[12px] text-[#86868b] mb-4">Transactions will appear here after activity</p>
                <a
                  href={`${explorerUrl}/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-[#007AFF] font-medium"
                >
                  View on Explorer <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-black/5">
              {displayTransactions.map((tx) => {
                const typeStyles = getTypeStyles(tx.type);
                return (
                  <div
                    key={tx.hash}
                    className="px-4 sm:px-6 py-3 active:bg-[#f9f9f9] sm:hover:bg-[#f9f9f9] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Type Icon */}
                        <div className={`w-8 h-8 ${typeStyles.bg} rounded-[10px] flex items-center justify-center flex-shrink-0`}>
                          <span className="text-white">
                            {getTypeIcon(tx.type)}
                          </span>
                        </div>
                        
                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-semibold text-[#1d1d1f] capitalize">{tx.type}</span>
                            {getStatusIcon(tx.status)}
                          </div>
                          <div className="text-[11px] text-[#86868b] flex items-center gap-1.5">
                            <span className="font-mono truncate">{tx.hash.slice(0, 8)}...{tx.hash.slice(-6)}</span>
                            <span>•</span>
                            <span className="whitespace-nowrap">{formatTime(tx.timestamp)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Value & Link */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {parseFloat(tx.value) > 0 && (
                          <div className="text-right hidden sm:block">
                            <div className="text-[13px] font-semibold text-[#1d1d1f]">
                              {parseFloat(tx.value).toFixed(4)}
                            </div>
                            <div className="text-[10px] text-[#86868b]">
                              {tx.tokenSymbol || 'CRO'}
                            </div>
                          </div>
                        )}
                        <a
                          href={`${explorerUrl}/tx/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-8 h-8 flex items-center justify-center bg-[#f5f5f7] rounded-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-[#86868b]" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          {filteredTransactions.length > 5 && (
            <div className="px-4 sm:px-6 py-3 border-t border-black/5">
              <button
                onClick={() => setShowAll(!showAll)}
                className="w-full py-2 text-[13px] font-medium text-[#007AFF] active:text-[#0051D5]"
              >
                {showAll ? 'Show less' : `View all ${filteredTransactions.length} transactions`}
              </button>
            </div>
          )}

          {filteredTransactions.length > 0 && filteredTransactions.length <= 5 && (
            <div className="px-4 sm:px-6 py-3 border-t border-black/5 flex items-center justify-between">
              <span className="text-[11px] text-[#86868b]">
                {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
              </span>
              <a
                href={`${explorerUrl}/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[#007AFF] font-medium"
              >
                Explorer <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
});
