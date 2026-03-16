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
  Loader2,
  Globe,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolling } from '@/lib/hooks';
import { logger } from '@/lib/utils/logger';
import { RiskMetricsPanel } from './RiskMetricsPanel';
import { AutoHedgePanel } from './AutoHedgePanel';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId, useSwitchChain, useSignMessage } from 'wagmi';
import { parseUnits, erc20Abi } from 'viem';
import { 
  POOL_CHAIN_CONFIGS, 
  getCommunityPoolAddress, 
  getUsdcAddress,
  getActiveChains,
  isPoolDeployed,
  COMMUNITY_POOL_ABI,
  type PoolChainConfig
} from '@/lib/contracts/community-pool-config';
import { useSuiSafe } from '@/app/sui-providers';

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
  SUI: 'bg-cyan-400',
  CRO: 'bg-indigo-500',
  ARB: 'bg-sky-500',
  USDC: 'bg-emerald-500',
};

const ASSET_ICONS: Record<string, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  SUI: '💧',
  CRO: '🔷',
  ARB: '🔵',
  USDC: '$',
};

// Get chain key from chainId
function getChainKeyFromId(chainId: number): string | null {
  switch (chainId) {
    case 338:
    case 25:
      return 'cronos';
    case 421614:
    case 42161:
      return 'arbitrum';
    default:
      return null;
  }
}

// Get valid chain IDs for a chain key
function getValidChainIds(chainKey: string): number[] {
  switch (chainKey) {
    case 'cronos':
      return [338, 25];
    case 'arbitrum':
      return [421614, 42161];
    default:
      return [];
  }
}

// Get network from chainId
function getNetworkFromChainId(chainId: number): 'testnet' | 'mainnet' {
  switch (chainId) {
    case 25: // Cronos Mainnet
    case 42161: // Arbitrum One
      return 'mainnet';
    default:
      return 'testnet';
  }
}

export const CommunityPool = memo(function CommunityPool({ address: propAddress, compact = false }: CommunityPoolProps) {
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
  const [selectedChain, setSelectedChain] = useState<string>('cronos'); // Multi-chain: 'cronos', 'arbitrum', 'sui'
  const [suiPoolStateId, setSuiPoolStateId] = useState<string | null>(null); // SUI pool state object ID
  const mountedRef = useRef(true);
  const lastFetchRef = useRef<number>(0);
  
  // wagmi hooks for on-chain deposits - use connected wallet address
  const { address: connectedAddress, isConnected, chain } = useAccount();
  const address = propAddress || connectedAddress; // Use prop if provided, else connected wallet
  const wagmiChainId = useChainId();
  // Prefer chain from account (wallet's actual chain) over wagmi's default chainId
  const chainId = chain?.id ?? wagmiChainId;
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // SUI wallet hooks (safe - returns null if not in SUI provider)
  const suiContext = useSuiSafe();
  const suiAddress = suiContext?.address ?? null;
  const suiIsConnected = suiContext?.isConnected ?? false;
  const suiBalance = suiContext?.balance ?? '0';
  const suiExecuteTransaction = suiContext?.executeTransaction;
  const suiNetwork = suiContext?.network ?? 'testnet';
  
  // SUI-specific state
  const [suiDepositAmount, setSuiDepositAmount] = useState<string>('');
  const [suiWithdrawShares, setSuiWithdrawShares] = useState<string>('');
  const [suiTxLoading, setSuiTxLoading] = useState(false);

  // Get current chain config
  const chainConfig = POOL_CHAIN_CONFIGS[selectedChain];
  // Detect network from wallet, but fallback to testnet if pool not deployed on detected network
  const detectedNetwork = chainId ? getNetworkFromChainId(chainId) : 'testnet';
  // Use testnet if pool isn't deployed on detected network (prefer showing deployed pool data)
  const network = isPoolDeployed(selectedChain, detectedNetwork) ? detectedNetwork : 'testnet';
  const USDC_ADDRESS = getUsdcAddress(selectedChain, network);
  const COMMUNITY_POOL_ADDRESS = getCommunityPoolAddress(selectedChain, network);
  const poolDeployed = isPoolDeployed(selectedChain, network);

  // Track if user has manually selected a chain (don't override)
  const userSelectedChainRef = useRef(false);

  // Auto-detect chain from wallet (only on initial mount or wallet chain change, not user tab clicks)
  useEffect(() => {
    if (chainId && !userSelectedChainRef.current) {
      const detectedChain = getChainKeyFromId(chainId);
      if (detectedChain && detectedChain !== selectedChain) {
        setSelectedChain(detectedChain);
      }
    }
  }, [chainId]); // Remove selectedChain from deps to avoid override loop

  // Handler for manual chain tab selection
  const handleChainSelect = useCallback((key: string) => {
    userSelectedChainRef.current = true;
    setSelectedChain(key);
  }, []);

  // Helper: Sign message for API authentication (informative message)
  const signForApi = useCallback(async (action: 'deposit' | 'withdraw', amount: string): Promise<{ signature: string; message: string } | null> => {
    if (!address) return null;
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `ZkVanguard Community Pool\n\nAction: ${action.toUpperCase()}\nAmount: $${amount}\nWallet: ${address}\ntimestamp:${timestamp}`;
    try {
      const signature = await signMessageAsync({ message });
      return { signature, message };
    } catch (err) {
      console.error('[CommunityPool] Signature rejected:', err);
      return null;
    }
  }, [address, signMessageAsync]);

  // OPTIMIZATION: Parallel fetch with client-side caching
  const fetchPoolData = useCallback(async (force = false) => {
    // Client-side debounce: skip if fetched within last 5s (unless forced)
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 5000) {
      return;
    }
    lastFetchRef.current = now;
    
    // SUI uses different API endpoint
    if (selectedChain === 'sui') {
      try {
        const [poolRes, userRes] = await Promise.all([
          fetch(`/api/sui/community-pool?network=${network}`),
          address ? fetch(`/api/sui/community-pool?user=${address}&network=${network}`) : Promise.resolve(null),
        ]);
        
        const [poolJson, userJson] = await Promise.all([
          poolRes.json(),
          userRes ? userRes.json() : null,
        ]);
        
        if (!mountedRef.current) return;
        
        if (poolJson.success) {
          // Store SUI pool state ID for explorer link
          if (poolJson.data.poolStateId) {
            setSuiPoolStateId(poolJson.data.poolStateId);
          }
          // Map SUI pool data to PoolSummary format
          // SUI pool primarily holds SUI tokens, show 100% SUI allocation
          const totalValue = parseFloat(poolJson.data.totalNAVUsd) || 0;
          setPoolData({
            totalShares: parseFloat(poolJson.data.totalShares) || 0,
            totalNAV: parseFloat(poolJson.data.totalNAV) || 0,
            totalValueUSD: totalValue,
            sharePrice: parseFloat(poolJson.data.sharePrice) || 1.0,
            memberCount: poolJson.data.memberCount || 0,
            // SUI pool allocation: 100% SUI (or show actual breakdown if available)
            allocations: totalValue > 0 ? { SUI: 100 } : {},
          });
        }
        
        if (userJson?.success) {
          // Map SUI user data to UserPosition format
          setUserPosition({
            shares: parseFloat(userJson.data.shares) || 0,
            valueUSD: parseFloat(userJson.data.valueUsd) || 0,
            percentage: parseFloat(userJson.data.percentage) || 0,
            isMember: userJson.data.isMember || false,
          });
        }
        
        // No leaderboard for SUI yet
        setLeaderboard([]);
        setLoading(false);
      } catch (err: any) {
        logger.error('[CommunityPool] SUI fetch error:', err);
        if (mountedRef.current) {
          setError(err.message);
          setLoading(false);
        }
      }
      return;
    }
    
    // EVM chains (Cronos, Arbitrum)
    const chainParam = `&chain=${selectedChain}&network=${network}`;
    
    try {
      // OPTIMIZATION: Fire all requests in parallel instead of sequentially
      const [poolRes, userRes, leaderRes] = await Promise.all([
        fetch(`/api/community-pool?${chainParam.substring(1)}`),
        address ? fetch(`/api/community-pool?user=${address}${chainParam}`) : Promise.resolve(null),
        fetch(`/api/community-pool?action=leaderboard&limit=5${chainParam}`),
      ]);
      
      // Process results in parallel
      const [poolJson, userJson, leaderJson] = await Promise.all([
        poolRes.json(),
        userRes ? userRes.json() : null,
        leaderRes.json(),
      ]);
      
      if (!mountedRef.current) return;
      
      if (poolJson.success) {
        setPoolData(poolJson.pool);
      }
      
      if (userJson?.success) {
        setUserPosition(userJson.user);
      }
      
      if (leaderJson.success) {
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
  }, [address, selectedChain, network]);
  
  // Fetch AI recommendation
  const fetchAIRecommendation = useCallback(async () => {
    try {
      const res = await fetch(`/api/community-pool/ai-decision?chain=${selectedChain}&network=${network}`);
      const json = await res.json();
      
      if (json.success && mountedRef.current) {
        setAiRecommendation(json.recommendation);
      }
    } catch (err: any) {
      logger.error('[CommunityPool] AI fetch error:', err);
    }
  }, [selectedChain, network]);
  
  // Initial fetch and refetch when chain changes
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchPoolData(true);
    
    return () => {
      mountedRef.current = false;
    };
  }, [fetchPoolData, selectedChain]);
  
  // OPTIMIZATION: Increased polling interval from 30s to 60s (data changes slowly)
  usePolling(fetchPoolData, 60000);
  
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
          
          // Sign message for API authentication
          setError('Please sign to confirm your deposit...');
          const authData = await signForApi('deposit', amount.toString());
          if (!authData) {
            setError('Signature required to confirm deposit');
            setTxStatus('idle');
            setActionLoading(false);
            return;
          }
          setError(null);
          
          const res = await fetch(`/api/community-pool?action=deposit&chain=${selectedChain}&network=${network}`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-wallet-address': address!,
              'x-wallet-signature': authData.signature,
              'x-wallet-message': btoa(authData.message),
            },
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
          
          // Sign message for API authentication
          setError('Please sign to confirm your withdrawal...');
          const authData = await signForApi('withdraw', shares.toString());
          if (!authData) {
            setError('Signature required to confirm withdrawal');
            setTxStatus('idle');
            setActionLoading(false);
            return;
          }
          setError(null);
          
          const res = await fetch(`/api/community-pool?action=withdraw&chain=${selectedChain}&network=${network}`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-wallet-address': address!,
              'x-wallet-signature': authData.signature,
              'x-wallet-message': btoa(authData.message),
            },
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
  }, [isConfirmed, txHash, txStatus, depositAmount, withdrawShares, address, fetchPoolData, resetWrite, writeContract, signForApi]);
  
  // Handle write errors
  useEffect(() => {
    if (writeError) {
      console.error('[CommunityPool] Write error:', writeError);
      const errorMsg = writeError.message || '';
      
      if (errorMsg.includes('User rejected') || errorMsg.includes('user rejected')) {
        setError('Transaction rejected by user');
      } else if (errorMsg.includes('Invalid value') || errorMsg.includes('fetch')) {
        // This can happen with BigInt serialization issues
        setError('Transaction failed - please check your input values and try again');
      } else if (errorMsg.includes('InsufficientShares')) {
        setError('Insufficient shares to withdraw');
      } else if (errorMsg.includes('InsufficientLiquidity')) {
        setError('Insufficient liquidity in pool - please try a smaller amount');
      } else {
        // Extract short message if available
        const shortMsg = (writeError as any).shortMessage || errorMsg;
        setError(shortMsg.slice(0, 200));
      }
      setActionLoading(false);
      setTxStatus('idle');
    }
  }, [writeError]);
  
  // Handle deposit - prompts wallet signature
  const handleDeposit = async () => {
    // Clear previous errors
    setError(null);
    
    // SECURITY: Require wallet connection
    if (!isConnected || !address) {
      setError('Please connect your wallet first');
      return;
    }
    
    if (!depositAmount) {
      setError('Please enter a deposit amount');
      return;
    }
    
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount < 10) {
      setError('Minimum deposit is $10');
      return;
    }
    
    // Check if on correct chain for selected pool
    const validChainIds = getValidChainIds(selectedChain);
    const isValidChain = validChainIds.includes(chainId as number);
    console.log('[CommunityPool] Chain check:', { chainId, selectedChain, validChainIds, isValidChain });
    if (!isValidChain) {
      // Try to switch to the correct chain automatically
      if (switchChain) {
        try {
          const targetChainId = validChainIds[0]; // Use testnet by default
          setError(`Switching to ${chainConfig?.name || selectedChain}...`);
          await switchChain({ chainId: targetChainId });
          // After switch, let user retry the deposit
          setError(`Switched to ${chainConfig?.name || selectedChain}. Please click Deposit again.`);
          return;
        } catch (switchErr) {
          console.error('[CommunityPool] Chain switch failed:', switchErr);
          setError(`Please switch to ${chainConfig?.name || selectedChain} in your wallet. You are on chain ${chainId}.`);
          return;
        }
      }
      setError(`Please switch to ${chainConfig?.name || selectedChain} network. Current chain: ${chainId}`);
      return;
    }
    
    // Check if pool is deployed on this chain
    if (!poolDeployed) {
      setError(`CommunityPool not yet deployed on ${chainConfig?.name || selectedChain} ${network}. Please select a different chain.`);
      return;
    }
    
    setActionLoading(true);
    setTxStatus('approving');
    
    try {
      // Convert to USDC units (6 decimals)
      const amountInUnits = parseUnits(amount.toString(), 6);
      
      // Step 1: Approve CommunityPool contract to spend USDC
      // This will trigger the wallet popup for approval signature
      // Step 2 (deposit) is triggered by the effect watching isConfirmed
      console.log('[CommunityPool] Initiating USDC approval for', amountInUnits.toString());
      writeContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
      });
    } catch (err: any) {
      console.error('[CommunityPool] Deposit error:', err);
      setError(err.message || 'Failed to initiate deposit');
      setActionLoading(false);
      setTxStatus('idle');
    }
  };
  
  // Handle withdraw - calls on-chain contract
  const handleWithdraw = async () => {
    // Clear previous errors
    setError(null);
    
    // SECURITY: Require wallet connection
    if (!isConnected || !address) {
      setError('Please connect your wallet first');
      return;
    }
    
    if (!withdrawShares || withdrawShares.trim() === '') {
      setError('Please enter the number of shares to withdraw');
      return;
    }
    
    // Parse and validate shares
    const sharesStr = withdrawShares.trim().replace(/,/g, '');
    const shares = parseFloat(sharesStr);
    if (isNaN(shares) || shares <= 0) {
      setError('Invalid share amount');
      return;
    }
    
    if (userPosition && shares > userPosition.shares) {
      setError(`You only have ${userPosition.shares.toFixed(4)} shares`);
      return;
    }
    
    // Check if on correct chain for selected pool
    const validChainIdsW = getValidChainIds(selectedChain);
    const isValidChainW = validChainIdsW.includes(chainId as number);
    console.log('[CommunityPool] Chain check (withdraw):', { chainId, selectedChain, validChainIdsW, isValidChain: isValidChainW });
    if (!isValidChainW) {
      // Try to switch to the correct chain automatically
      if (switchChain) {
        try {
          const targetChainId = validChainIdsW[0]; // Use testnet by default
          setError(`Switching to ${chainConfig?.name || selectedChain}...`);
          await switchChain({ chainId: targetChainId });
          setError(`Switched to ${chainConfig?.name || selectedChain}. Please click Withdraw again.`);
          return;
        } catch (switchErr) {
          console.error('[CommunityPool] Chain switch failed:', switchErr);
          setError(`Please switch to ${chainConfig?.name || selectedChain} in your wallet. You are on chain ${chainId}.`);
          return;
        }
      }
      setError(`Please switch to ${chainConfig?.name || selectedChain} network. Current chain: ${chainId}`);
      return;
    }
    
    // Check if pool is deployed
    if (!poolDeployed) {
      setError(`CommunityPool not yet deployed on ${chainConfig?.name || selectedChain} ${network}.`);
      return;
    }
    
    setActionLoading(true);
    setTxStatus('withdrawing');
    
    try {
      // Convert shares to wei (18 decimals) - parseUnits handles this cleanly
      // Format shares to avoid floating point issues
      const sharesFixed = shares.toFixed(6);
      const sharesWei = parseUnits(sharesFixed, 18);
      const zeroMin = BigInt(0); // No minimum amount out
      
      // Call withdraw on CommunityPool contract
      // This will trigger the wallet popup for transaction signature
      console.log('[CommunityPool] Initiating withdrawal:', { shares: sharesFixed, sharesWei: sharesWei.toString(), minAmountOut: '0' });
      
      writeContract({
        address: COMMUNITY_POOL_ADDRESS,
        abi: COMMUNITY_POOL_ABI,
        functionName: 'withdraw',
        args: [sharesWei, zeroMin],
      });
    } catch (err: any) {
      console.error('[CommunityPool] Withdrawal error:', err);
      setError(err.shortMessage || err.message || 'Failed to initiate withdrawal');
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

  // SUI deposit handler
  const handleSuiDeposit = async () => {
    setError(null);
    
    if (!suiIsConnected || !suiAddress) {
      setError('Please connect your SUI wallet first');
      return;
    }
    
    if (!suiDepositAmount) {
      setError('Please enter a deposit amount in SUI');
      return;
    }
    
    const amount = parseFloat(suiDepositAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Invalid deposit amount');
      return;
    }
    
    // Convert to MIST (9 decimals)
    const amountMist = BigInt(Math.floor(amount * 1_000_000_000));
    
    setSuiTxLoading(true);
    
    try {
      // Get deposit params from API
      const res = await fetch(`/api/sui/community-pool?action=deposit&network=${suiNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountMist.toString() }),
      });
      
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to prepare deposit');
        setSuiTxLoading(false);
        return;
      }
      
      // Execute transaction using SUI wallet
      if (!suiExecuteTransaction) {
        setError('SUI wallet not properly connected');
        setSuiTxLoading(false);
        return;
      }
      
      // Note: The actual transaction building would need to use @mysten/sui Transaction
      // For now, show success message and link to explorer
      setSuccessMessage(`SUI deposit prepared! Amount: ${amount} SUI. Use your SUI wallet to complete the transaction.`);
      setSuiDepositAmount('');
      setShowDeposit(false);
      
      // Refresh data after a delay
      setTimeout(() => {
        fetchPoolData(true);
        setSuccessMessage(null);
      }, 5000);
      
    } catch (err: any) {
      console.error('[CommunityPool] SUI deposit error:', err);
      setError(err.message || 'Failed to deposit');
    } finally {
      setSuiTxLoading(false);
    }
  };

  // SUI withdraw handler
  const handleSuiWithdraw = async () => {
    setError(null);
    
    if (!suiIsConnected || !suiAddress) {
      setError('Please connect your SUI wallet first');
      return;
    }
    
    if (!suiWithdrawShares) {
      setError('Please enter the number of shares to withdraw');
      return;
    }
    
    const shares = parseFloat(suiWithdrawShares);
    if (isNaN(shares) || shares <= 0) {
      setError('Invalid share amount');
      return;
    }
    
    // Convert to wei (18 decimals for shares)
    const sharesWei = BigInt(Math.floor(shares * 1e18));
    
    setSuiTxLoading(true);
    
    try {
      // Get withdraw params from API
      const res = await fetch(`/api/sui/community-pool?action=withdraw&network=${suiNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shares: sharesWei.toString() }),
      });
      
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to prepare withdrawal');
        setSuiTxLoading(false);
        return;
      }
      
      // Execute transaction using SUI wallet
      if (!suiExecuteTransaction) {
        setError('SUI wallet not properly connected');
        setSuiTxLoading(false);
        return;
      }
      
      setSuccessMessage(`SUI withdrawal prepared! Shares: ${shares}. Use your SUI wallet to complete the transaction.`);
      setSuiWithdrawShares('');
      setShowWithdraw(false);
      
      // Refresh data after a delay
      setTimeout(() => {
        fetchPoolData(true);
        setSuccessMessage(null);
      }, 5000);
      
    } catch (err: any) {
      console.error('[CommunityPool] SUI withdraw error:', err);
      setError(err.message || 'Failed to withdraw');
    } finally {
      setSuiTxLoading(false);
    }
  };
  
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
            {/* Chain Selector */}
            <div className="flex bg-white/20 rounded-lg p-0.5">
              {Object.entries(POOL_CHAIN_CONFIGS)
                .filter(([_, config]) => config.status === 'live' || config.status === 'testing')
                .map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => handleChainSelect(key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                      selectedChain === key
                        ? 'bg-white text-indigo-600'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                    title={`${config.name} ${config.status === 'testing' ? '(Testing)' : ''}`}
                  >
                    <span>{config.icon}</span>
                    <span>{config.shortName}</span>
                    {config.status === 'testing' && (
                      <span className="ml-1 px-1 py-0.5 text-[10px] bg-yellow-500 text-white rounded">
                        TEST
                      </span>
                    )}
                  </button>
                ))}
            </div>
            <button
              onClick={() => fetchPoolData(true)}
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
        
        {/* Network indicator */}
        <div className="mt-2 flex items-center gap-2 text-xs text-white/70">
          <Globe className="w-3 h-3" />
          <span>
            {chainConfig?.name || 'Unknown'} • {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
            {!poolDeployed && <span className="ml-2 text-yellow-300">(Not Deployed)</span>}
          </span>
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
            {selectedChain === 'sui' 
              ? `${poolData.sharePrice.toFixed(6)} SUI`
              : `$${poolData.sharePrice.toFixed(4)}`
            }
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Share Price {selectedChain === 'sui' ? '(in SUI)' : '(USD)'}
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {poolData.totalShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
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
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {chainConfig?.assets?.join(' • ') || 'Multi-Asset'}
          </span>
        </div>
        
        {/* Allocation Bar */}
        {Object.keys(poolData.allocations || {}).length > 0 ? (
          <>
            <div className="h-6 rounded-full overflow-hidden flex mb-3 bg-gray-200 dark:bg-gray-700">
              {Object.entries(poolData.allocations).map(([asset, alloc]) => {
                const percent = typeof alloc === 'number' ? alloc : (alloc?.percentage ?? 0);
                if (percent <= 0) return null;
                return (
                  <div
                    key={asset}
                    className={`${ASSET_COLORS[asset] || 'bg-gray-500'} flex items-center justify-center text-xs text-white font-semibold transition-all duration-500`}
                    style={{ width: `${Math.max(percent, 5)}%` }}
                  >
                    {percent >= 10 && `${asset} ${Math.round(percent)}%`}
                  </div>
                );
              })}
            </div>
            
            {/* Legend */}
            <div className="flex flex-wrap gap-4">
              {Object.entries(poolData.allocations).map(([asset, alloc]) => {
                const percent = typeof alloc === 'number' ? alloc : (alloc?.percentage ?? 0);
                if (percent <= 0) return null;
                return (
                  <div key={asset} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${ASSET_COLORS[asset] || 'bg-gray-500'}`}></div>
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      <span className="font-medium">{ASSET_ICONS[asset] || ''} {asset}</span> {Math.round(percent)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
            No allocations yet. Deposit to start earning.
          </div>
        )}
      </div>
      
      {/* User Position */}
      {address && userPosition && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4" />
            Your Position
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-2">
              on {chainConfig?.name || selectedChain}
            </span>
          </h3>
          
          {userPosition.isMember ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                  {userPosition.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Your Shares</p>
              </div>
              <div>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">
                  {selectedChain === 'sui' 
                    ? `${(userPosition.valueUSD / (poolData?.sharePrice || 1)).toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`
                    : formatUSD(userPosition.valueUSD)
                  }
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Current Value {selectedChain === 'sui' && `(~${formatUSD(userPosition.valueUSD)})`}
                </p>
              </div>
              <div>
                <p className="text-xl font-bold text-purple-600 dark:text-purple-400">
                  {formatPercent(userPosition.percentage)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Pool Ownership</p>
              </div>
              <div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {(userPosition.depositCount || 0) + (userPosition.withdrawalCount || 0)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Transactions</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              You haven't joined the {chainConfig?.name || selectedChain} pool yet. Deposit to receive shares.
            </p>
          )}
        </div>
      )}
      
      {/* Actions */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        {/* SUI: Show different deposit/withdraw UI */}
        {selectedChain === 'sui' ? (
          <div className="space-y-4">
            {/* SUI Pool Header */}
            <div className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">💧</span>
                  <h4 className="font-semibold text-gray-900 dark:text-white">SUI Pool</h4>
                  <span className="px-2 py-0.5 text-xs bg-cyan-500 text-white rounded-full">Live on Testnet</span>
                </div>
                <a
                  href={`${chainConfig?.blockExplorer?.testnet || 'https://suiscan.xyz/testnet'}/object/${suiPoolStateId || COMMUNITY_POOL_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  View Pool
                </a>
              </div>
              
              {/* SUI Wallet Status */}
              {suiIsConnected ? (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <Wallet className="w-4 h-4 text-green-500" />
                  <span>Connected: {suiAddress?.slice(0, 8)}...{suiAddress?.slice(-6)}</span>
                  <span className="text-gray-400">|</span>
                  <span>{suiBalance} SUI</span>
                </div>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  Connect a SUI wallet (Sui Wallet, Suiet, or Ethos) to deposit and withdraw.
                </p>
              )}
            </div>
            
            {/* SUI Deposit/Withdraw Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeposit(!showDeposit); setShowWithdraw(false); }}
                disabled={!suiIsConnected || suiTxLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Deposit SUI
              </button>
              <button
                onClick={() => { setShowWithdraw(!showWithdraw); setShowDeposit(false); }}
                disabled={!suiIsConnected || !userPosition?.isMember || suiTxLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <Minus className="w-4 h-4" />
                Withdraw
              </button>
            </div>
            
            {/* SUI Deposit Form */}
            <AnimatePresence>
              {showDeposit && suiIsConnected && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={suiDepositAmount}
                      onChange={(e) => setSuiDepositAmount(e.target.value)}
                      placeholder="Amount in SUI (min 0.1)"
                      disabled={suiTxLoading}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                    />
                    <button
                      onClick={handleSuiDeposit}
                      disabled={suiTxLoading || !suiDepositAmount}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {suiTxLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      Deposit
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* SUI Withdraw Form */}
            <AnimatePresence>
              {showWithdraw && suiIsConnected && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={suiWithdrawShares}
                      onChange={(e) => setSuiWithdrawShares(e.target.value)}
                      placeholder={`Shares (max: ${userPosition?.shares?.toFixed(4) || 0})`}
                      disabled={suiTxLoading}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                    />
                    <button
                      onClick={handleSuiWithdraw}
                      disabled={suiTxLoading || !suiWithdrawShares}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {suiTxLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minus className="w-4 h-4" />}
                      Withdraw
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
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
        )}
        
        {/* Deposit Form - EVM chains only */}
        {selectedChain !== 'sui' && (
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
        )}
        
        {/* Withdraw Form - EVM chains only */}
        {selectedChain !== 'sui' && (
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
        )}
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
      
      {/* AI Auto-Hedge Panel */}
      {!compact && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <AutoHedgePanel />
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
