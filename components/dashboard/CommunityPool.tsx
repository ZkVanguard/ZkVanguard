'use client';

import { useState, memo, useRef, useEffect, useCallback } from 'react';
import { 
  Users, 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  DollarSign, 
  PieChart, 
  Brain,
  RefreshCw,
  Plus,
  Minus,
  Award,
  Sparkles,
  BarChart3,
  ArrowRightLeft,
  Info,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolling } from '@/lib/hooks';
import { logger } from '@/lib/utils/logger';
import { RiskMetricsPanel } from './RiskMetricsPanel';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId } from 'wagmi';
import { parseUnits, erc20Abi } from 'viem';

interface PoolAllocation {
  BTC: number;
  ETH: number;
  SUI: number;
  CRO: number;
}

interface PoolSummary {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number;
  memberCount: number;
  allocations: PoolAllocation;
  aiLastUpdate: string | null;
  aiReasoning: string | null;
}

interface UserPosition {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  percentage: number;
  isMember: boolean;
  joinedAt?: string;
  totalDeposited?: number;
  totalWithdrawn?: number;
  depositCount?: number;
  withdrawalCount?: number;
}

interface AIRecommendation {
  allocations: PoolAllocation;
  reasoning: string;
  confidence: number;
  changes: {
    asset: string;
    currentPercent: number;
    proposedPercent: number;
    change: number;
  }[];
}

interface CommunityPoolProps {
  address?: string;
  compact?: boolean;
}

const ASSET_COLORS: Record<string, string> = {
  BTC: 'bg-orange-500',
  ETH: 'bg-blue-500',
  SUI: 'bg-cyan-500',
  CRO: 'bg-indigo-500',
};

const ASSET_ICONS: Record<string, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  SUI: '~',
  CRO: 'C',
};

// Contract addresses - Cronos Testnet
const USDC_ADDRESS = '0x28217DAddC55e3C4831b4A48A00Ce04880786967' as const; // MockUSDC on Cronos Testnet
const COMMUNITY_POOL_ADDRESS = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B' as const; // CommunityPool V2 contract

// CommunityPool ABI (subset for deposit/withdraw)
const COMMUNITY_POOL_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
] as const;

export const CommunityPool = memo(function CommunityPool({ address, compact = false }: CommunityPoolProps) {
  const [poolData, setPoolData] = useState<PoolSummary | null>(null);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState<AIRecommendation | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [withdrawShares, setWithdrawShares] = useState<string>('');
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'idle' | 'approving' | 'approved' | 'depositing' | 'withdrawing' | 'complete'>('idle');
  const mountedRef = useRef(true);
  
  // wagmi hooks for on-chain deposits
  const chainId = useChainId();
  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Fetch pool data
  const fetchPoolData = useCallback(async () => {
    try {
      // Fetch pool summary
      const poolRes = await fetch('/api/community-pool');
      const poolJson = await poolRes.json();
      
      if (poolJson.success && mountedRef.current) {
        setPoolData(poolJson.pool);
      }
      
      // Fetch user position if address provided
      if (address) {
        const userRes = await fetch(`/api/community-pool?user=${address}`);
        const userJson = await userRes.json();
        
        if (userJson.success && mountedRef.current) {
          setUserPosition(userJson.user);
        }
      }
      
      // Fetch leaderboard
      const leaderRes = await fetch('/api/community-pool?action=leaderboard&limit=5');
      const leaderJson = await leaderRes.json();
      
      if (leaderJson.success && mountedRef.current) {
        setLeaderboard(leaderJson.leaderboard);
      }
      
      setLoading(false);
    } catch (err: any) {
      logger.error('[CommunityPool] Fetch error:', err);
      if (mountedRef.current) {
        setError(err.message);
        setLoading(false);
      }
    }
  }, [address]);
  
  // Fetch AI recommendation
  const fetchAIRecommendation = useCallback(async () => {
    try {
      const res = await fetch('/api/community-pool/ai-decision');
      const json = await res.json();
      
      if (json.success && mountedRef.current) {
        setAiRecommendation(json.recommendation);
      }
    } catch (err: any) {
      logger.error('[CommunityPool] AI fetch error:', err);
    }
  }, []);
  
  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchPoolData();
    
    return () => {
      mountedRef.current = false;
    };
  }, [fetchPoolData]);
  
  // Polling
  usePolling(fetchPoolData, 30000);
  
  // Handle transaction confirmation based on current status
  useEffect(() => {
    if (!isConfirmed || !txHash) return;
    
    // Approval confirmed - now trigger deposit
    if (txStatus === 'approving' && depositAmount) {
      const amount = parseFloat(depositAmount);
      const amountInUnits = parseUnits(amount.toString(), 6);
      
      setTxStatus('depositing');
      resetWrite();
      
      // Call deposit on CommunityPool contract
      writeContract({
        address: COMMUNITY_POOL_ADDRESS,
        abi: COMMUNITY_POOL_ABI,
        functionName: 'deposit',
        args: [amountInUnits],
      });
      return;
    }
    
    // Deposit confirmed - record in backend and cleanup
    if (txStatus === 'depositing') {
      const recordDeposit = async () => {
        try {
          const amount = parseFloat(depositAmount);
          const res = await fetch('/api/community-pool?action=deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              walletAddress: address,
              amount,
              txHash,
            }),
          });
          
          const json = await res.json();
          
          if (json.success) {
            setLastTxHash(txHash);
            setSuccessMessage(`Deposited $${amount.toFixed(2)} successfully!`);
            setDepositAmount('');
            setShowDeposit(false);
            setTxStatus('idle');
            resetWrite();
            
            // Sync local storage with on-chain (ensures consistency)
            await fetch(`/api/community-pool?action=sync&user=${address}`);
            fetchPoolData();
            
            setTimeout(() => { setSuccessMessage(null); setLastTxHash(null); }, 10000);
          } else {
            setError(json.error);
            setTxStatus('idle');
          }
        } catch (err: any) {
          setError(err.message);
          setTxStatus('idle');
        } finally {
          setActionLoading(false);
        }
      };
      recordDeposit();
      return;
    }
    
    // Withdrawal confirmed - record in backend and cleanup
    if (txStatus === 'withdrawing') {
      const recordWithdrawal = async () => {
        try {
          const shares = parseFloat(withdrawShares);
          const res = await fetch('/api/community-pool?action=withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              walletAddress: address,
              shares,
              txHash,
            }),
          });
          
          const json = await res.json();
          
          if (json.success) {
            setLastTxHash(txHash);
            setSuccessMessage(`Withdrew ${shares.toFixed(2)} shares successfully!`);
            setWithdrawShares('');
            setShowWithdraw(false);
            setTxStatus('idle');
            resetWrite();
            
            // Sync local storage with on-chain (ensures consistency)
            await fetch(`/api/community-pool?action=sync&user=${address}`);
            fetchPoolData();
            
            setTimeout(() => { setSuccessMessage(null); setLastTxHash(null); }, 10000);
          } else {
            setError(json.error);
            setTxStatus('idle');
          }
        } catch (err: any) {
          setError(err.message);
          setTxStatus('idle');
        } finally {
          setActionLoading(false);
        }
      };
      recordWithdrawal();
    }
  }, [isConfirmed, txHash, txStatus, depositAmount, withdrawShares, address, fetchPoolData, resetWrite, writeContract]);
  
  // Handle write errors
  useEffect(() => {
    if (writeError) {
      setError(writeError.message.includes('User rejected') 
        ? 'Transaction rejected by user' 
        : writeError.message);
      setActionLoading(false);
      setTxStatus('idle');
    }
  }, [writeError]);
  
  // Handle deposit - prompts wallet signature
  const handleDeposit = async () => {
    if (!address || !depositAmount) return;
    
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount < 10) {
      setError('Minimum deposit is $10');
      return;
    }
    
    // Check if on correct chain (Cronos Testnet = 338, Mainnet = 25)
    if (chainId !== 338 && chainId !== 25) {
      setError('Please switch to Cronos network');
      return;
    }
    
    setActionLoading(true);
    setError(null);
    setTxStatus('approving');
    
    try {
      // Convert to USDC units (6 decimals)
      const amountInUnits = parseUnits(amount.toString(), 6);
      
      // Step 1: Approve CommunityPool contract to spend USDC
      // Step 2 (deposit) is triggered by the effect watching isConfirmed
      writeContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
      });
    } catch (err: any) {
      setError(err.message);
      setActionLoading(false);
      setTxStatus('idle');
    }
  };
  
  // Handle withdraw - calls on-chain contract
  const handleWithdraw = async () => {
    if (!address || !withdrawShares) return;
    
    const shares = parseFloat(withdrawShares);
    if (isNaN(shares) || shares <= 0) {
      setError('Invalid share amount');
      return;
    }
    
    if (userPosition && shares > userPosition.shares) {
      setError(`You only have ${userPosition.shares.toFixed(4)} shares`);
      return;
    }
    
    // Check if on correct chain (Cronos Testnet = 338, Mainnet = 25)
    if (chainId !== 338 && chainId !== 25) {
      setError('Please switch to Cronos network');
      return;
    }
    
    setActionLoading(true);
    setError(null);
    setTxStatus('withdrawing');
    
    try {
      // Convert shares to wei (18 decimals)
      const sharesInWei = parseUnits(shares.toString(), 18);
      
      // Call withdraw on CommunityPool contract (minAmountOut = 0 for no slippage check)
      writeContract({
        address: COMMUNITY_POOL_ADDRESS,
        abi: COMMUNITY_POOL_ABI,
        functionName: 'withdraw',
        args: [sharesInWei, BigInt(0)],
      });
    } catch (err: any) {
      setError(err.message);
      setActionLoading(false);
      setTxStatus('idle');
    }
  };
  
  // Format numbers
  const formatUSD = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  };
  
  const formatPercent = (value: number) => `${value.toFixed(1)}%`;
  
  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>
    );
  }
  
  if (!poolData) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <p className="text-gray-500 dark:text-gray-400 text-center">
          Unable to load community pool data
        </p>
      </div>
    );
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Community Pool</h2>
              <p className="text-sm text-white/80">AI-Managed Collective Investment</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchPoolData}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={() => { setShowAI(true); fetchAIRecommendation(); }}
              className="flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              <Brain className="w-4 h-4 text-white" />
              <span className="text-sm text-white">AI Insights</span>
            </button>
          </div>
        </div>
      </div>
      
      {/* Pool Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatUSD(poolData.totalValueUSD)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Total Value Locked</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {poolData.memberCount}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Pool Members</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            ${poolData.sharePrice.toFixed(4)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Share Price</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {poolData.totalShares.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Total Shares</p>
        </div>
      </div>
      
      {/* Allocation Chart */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <PieChart className="w-4 h-4" />
            Current Allocation
          </h3>
        </div>
        
        {/* Allocation Bar */}
        <div className="h-6 rounded-full overflow-hidden flex mb-3">
          {Object.entries(poolData.allocations).map(([asset, alloc]) => {
            const percent = typeof alloc === 'number' ? alloc : alloc.percentage;
            return (
              <div
                key={asset}
                className={`${ASSET_COLORS[asset]} flex items-center justify-center text-xs text-white font-semibold transition-all duration-500`}
                style={{ width: `${percent}%` }}
              >
                {percent >= 10 && `${asset} ${Math.round(percent)}%`}
              </div>
            );
          })}
        </div>
        
        {/* Legend */}
        <div className="flex flex-wrap gap-4">
          {Object.entries(poolData.allocations).map(([asset, alloc]) => {
            const percent = typeof alloc === 'number' ? alloc : alloc.percentage;
            return (
              <div key={asset} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${ASSET_COLORS[asset]}`}></div>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-medium">{asset}</span> {Math.round(percent)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* User Position */}
      {address && userPosition && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4" />
            Your Position
          </h3>
          
          {userPosition.isMember ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                  {userPosition.shares.toFixed(4)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Your Shares</p>
              </div>
              <div>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">
                  {formatUSD(userPosition.valueUSD)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Current Value</p>
              </div>
              <div>
                <p className="text-xl font-bold text-purple-600 dark:text-purple-400">
                  {formatPercent(userPosition.percentage)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Pool Ownership</p>
              </div>
              <div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {userPosition.depositCount || 0}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Transactions</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              You haven't joined the pool yet. Deposit to receive shares.
            </p>
          )}
        </div>
      )}
      
      {/* Actions */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex gap-3">
          <button
            onClick={() => { setShowDeposit(!showDeposit); setShowWithdraw(false); }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Deposit
          </button>
          <button
            onClick={() => { setShowWithdraw(!showWithdraw); setShowDeposit(false); }}
            disabled={!userPosition?.isMember}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Minus className="w-4 h-4" />
            Withdraw
          </button>
        </div>
        
        {/* Deposit Form */}
        <AnimatePresence>
          {showDeposit && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4"
            >
              <div className="flex gap-2">
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="Amount in USD (min $10)"
                  disabled={actionLoading}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                />
                <button
                  onClick={handleDeposit}
                  disabled={actionLoading || !depositAmount || !address || isPending || isConfirming}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  {(actionLoading || isPending || isConfirming) && <Loader2 className="w-4 h-4 animate-spin" />}
                  {txStatus === 'approving' ? 'Approve USDC...' : 
                   txStatus === 'depositing' ? 'Deposit to Pool...' : 
                   'Deposit USDC'}
                </button>
              </div>
              {poolData && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Current share price: ${poolData.sharePrice.toFixed(4)} — You'll receive ~{depositAmount ? (parseFloat(depositAmount) / poolData.sharePrice).toFixed(4) : '0'} shares
                </p>
              )}
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Deposits to on-chain CommunityPool contract. Requires 2 signatures: approve + deposit.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Withdraw Form */}
        <AnimatePresence>
          {showWithdraw && userPosition?.isMember && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4"
            >
              <div className="flex gap-2">
                <input
                  type="number"
                  value={withdrawShares}
                  onChange={(e) => setWithdrawShares(e.target.value)}
                  placeholder={`Shares to burn (max ${userPosition.shares.toFixed(4)})`}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <button
                  onClick={() => setWithdrawShares(userPosition.shares.toString())}
                  className="px-3 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-lg text-sm"
                >
                  Max
                </button>
                <button
                  onClick={handleWithdraw}
                  disabled={actionLoading || !withdrawShares || txStatus === 'withdrawing'}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                >
                  {txStatus === 'withdrawing' ? 'Withdrawing...' : actionLoading ? 'Processing...' : 'Confirm'}
                </button>
              </div>
              {poolData && withdrawShares && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  You'll receive: ~${(parseFloat(withdrawShares) * poolData.sharePrice).toFixed(2)} USD
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Success/Error Messages */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mx-4 mt-4 p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg"
          >
            <p className="text-green-700 dark:text-green-300 text-sm">✓ {successMessage}</p>
            {lastTxHash && (
              <p className="text-green-600 dark:text-green-400 text-xs mt-1">
                Tx: <a 
                  href={`https://explorer.cronos.org/testnet/tx/${lastTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-green-500"
                >
                  {lastTxHash.slice(0, 10)}...{lastTxHash.slice(-8)}
                </a>
              </p>
            )}
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mx-4 mt-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg"
          >
            <p className="text-red-700 dark:text-red-300 text-sm">✗ {error}</p>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Risk Metrics Panel */}
      {!compact && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <RiskMetricsPanel compact={false} />
        </div>
      )}
      
      {/* Leaderboard */}
      {!compact && leaderboard.length > 0 && (
        <div className="p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-yellow-500" />
            Top Shareholders
          </h3>
          <div className="space-y-2">
            {leaderboard.filter(user => user?.walletAddress).map((user, index) => (
              <div
                key={user.walletAddress}
                className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                    index === 0 ? 'bg-yellow-500 text-white' :
                    index === 1 ? 'bg-gray-400 text-white' :
                    index === 2 ? 'bg-orange-600 text-white' :
                    'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                  }`}>
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
      )}
      
      {/* AI Modal */}
      <AnimatePresence>
        {showAI && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowAI(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-indigo-600 to-purple-600">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  AI Allocation Insights
                </h3>
              </div>
              
              <div className="p-4">
                {aiRecommendation ? (
                  <>
                    <div className="mb-4">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        Confidence: {aiRecommendation.confidence}%
                      </p>
                      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all"
                          style={{ width: `${aiRecommendation.confidence}%` }}
                        />
                      </div>
                    </div>
                    
                    <div className="prose dark:prose-invert text-sm whitespace-pre-wrap mb-4">
                      {aiRecommendation.reasoning}
                    </div>
                    
                    <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
                      Proposed Changes:
                    </h4>
                    <div className="space-y-2">
                      {aiRecommendation.changes.map((change) => (
                        <div 
                          key={change.asset}
                          className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${ASSET_COLORS[change.asset]}`}></div>
                            <span className="font-medium">{change.asset}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-gray-500">{change.currentPercent}%</span>
                            <ArrowRightLeft className="w-4 h-4 text-gray-400" />
                            <span className={change.change > 0 ? 'text-green-600' : change.change < 0 ? 'text-red-600' : ''}>
                              {change.proposedPercent}%
                            </span>
                            {change.change !== 0 && (
                              <span className={`text-xs ${change.change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ({change.change > 0 ? '+' : ''}{change.change}%)
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-2" />
                    <p className="text-gray-500">Loading AI analysis...</p>
                  </div>
                )}
              </div>
              
              <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                <button
                  onClick={() => setShowAI(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

export default CommunityPool;
