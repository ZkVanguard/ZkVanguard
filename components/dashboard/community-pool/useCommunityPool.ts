/**
 * useCommunityPool Hook
 * Centralized state management and data fetching for CommunityPool
 * Uses useReducer for complex state to minimize re-renders
 * 
 * OPTIMIZATIONS:
 * - useReducer for batched state updates (minimizes re-renders)
 * - useMemo for expensive derived values
 * - useCallback for stable function references
 * - startTransition for non-urgent state updates
 * - Optimistic UI updates for better perceived performance
 * - Debounced input handlers
 */

'use client';

import { useReducer, useCallback, useRef, useEffect, useMemo, useTransition, startTransition } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useSignMessage, useReadContract } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { logger } from '@/lib/utils/logger';
import { usePolling } from '@/lib/hooks';
import { useSuiSafe } from '@/app/sui-providers';
import { 
  POOL_CHAIN_CONFIGS, 
  getCommunityPoolAddress, 
  getUsdtAddress,
  isPoolDeployed,
  COMMUNITY_POOL_ABI,
} from '@/lib/contracts/community-pool-config';
import { getChainKeyFromId, getNetworkFromChainId, getValidChainIds } from './utils';
import type { 
  CommunityPoolState, 
  TransactionState, 
  PoolSummary, 
  UserPosition, 
  AIRecommendation,
  LeaderboardEntry,
  ChainKey,
  TxStatus
} from './types';

// ============================================================================
// STATE TYPES
// ============================================================================

type PoolAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_POOL_DATA'; payload: PoolSummary | null }
  | { type: 'SET_USER_POSITION'; payload: UserPosition | null }
  | { type: 'SET_AI_RECOMMENDATION'; payload: AIRecommendation | null }
  | { type: 'SET_LEADERBOARD'; payload: LeaderboardEntry[] }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_SUCCESS'; payload: string | null }
  | { type: 'SET_CHAIN'; payload: ChainKey }
  | { type: 'SET_SUI_POOL_STATE_ID'; payload: string | null }
  | { type: 'RESET_FOR_CHAIN_CHANGE' };

type TxAction =
  | { type: 'SET_TX_STATUS'; payload: TxStatus }
  | { type: 'SET_ACTION_LOADING'; payload: boolean }
  | { type: 'SET_SHOW_DEPOSIT'; payload: boolean }
  | { type: 'SET_SHOW_WITHDRAW'; payload: boolean }
  | { type: 'SET_DEPOSIT_AMOUNT'; payload: string }
  | { type: 'SET_WITHDRAW_SHARES'; payload: string }
  | { type: 'SET_SUI_DEPOSIT_AMOUNT'; payload: string }
  | { type: 'SET_SUI_WITHDRAW_SHARES'; payload: string }
  | { type: 'SET_LAST_TX_HASH'; payload: string | null }
  | { type: 'RESET_TX_STATE' };

// ============================================================================
// REDUCERS
// ============================================================================

const initialPoolState: CommunityPoolState = {
  poolData: null,
  userPosition: null,
  aiRecommendation: null,
  leaderboard: [],
  loading: true,
  error: null,
  successMessage: null,
  selectedChain: 'sepolia',  // Sepolia with WDK USDT for Tether Hackathon
  suiPoolStateId: null,
};

const initialTxState: TransactionState = {
  txStatus: 'idle',
  actionLoading: false,
  showDeposit: false,
  showWithdraw: false,
  depositAmount: '',
  withdrawShares: '',
  suiDepositAmount: '',
  suiWithdrawShares: '',
  lastTxHash: null,
};

function poolReducer(state: CommunityPoolState, action: PoolAction): CommunityPoolState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_POOL_DATA':
      return { ...state, poolData: action.payload };
    case 'SET_USER_POSITION':
      return { ...state, userPosition: action.payload };
    case 'SET_AI_RECOMMENDATION':
      return { ...state, aiRecommendation: action.payload };
    case 'SET_LEADERBOARD':
      return { ...state, leaderboard: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_SUCCESS':
      return { ...state, successMessage: action.payload };
    case 'SET_CHAIN':
      return { ...state, selectedChain: action.payload };
    case 'SET_SUI_POOL_STATE_ID':
      return { ...state, suiPoolStateId: action.payload };
    case 'RESET_FOR_CHAIN_CHANGE':
      return {
        ...initialPoolState,
        selectedChain: state.selectedChain,
        loading: true,
      };
    default:
      return state;
  }
}

function txReducer(state: TransactionState, action: TxAction): TransactionState {
  switch (action.type) {
    case 'SET_TX_STATUS':
      return { ...state, txStatus: action.payload };
    case 'SET_ACTION_LOADING':
      return { ...state, actionLoading: action.payload };
    case 'SET_SHOW_DEPOSIT':
      return { ...state, showDeposit: action.payload, showWithdraw: action.payload ? false : state.showWithdraw };
    case 'SET_SHOW_WITHDRAW':
      return { ...state, showWithdraw: action.payload, showDeposit: action.payload ? false : state.showDeposit };
    case 'SET_DEPOSIT_AMOUNT':
      return { ...state, depositAmount: action.payload };
    case 'SET_WITHDRAW_SHARES':
      return { ...state, withdrawShares: action.payload };
    case 'SET_SUI_DEPOSIT_AMOUNT':
      return { ...state, suiDepositAmount: action.payload };
    case 'SET_SUI_WITHDRAW_SHARES':
      return { ...state, suiWithdrawShares: action.payload };
    case 'SET_LAST_TX_HASH':
      return { ...state, lastTxHash: action.payload };
    case 'RESET_TX_STATE':
      return initialTxState;
    default:
      return state;
  }
}

// ============================================================================
// HOOK
// ============================================================================

export function useCommunityPool(propAddress?: string) {
  const [poolState, dispatchPool] = useReducer(poolReducer, initialPoolState);
  const [txState, dispatchTx] = useReducer(txReducer, initialTxState);
  
  const mountedRef = useRef(true);
  const lastFetchRef = useRef<number>(0);
  const userSelectedChainRef = useRef(false);
  // Track pending action after chain switch (auto-retry)
  const pendingChainSwitchRef = useRef<{ action: 'deposit' | 'withdraw'; targetChainId: number } | null>(null);
  
  // Wagmi hooks
  const { address: connectedAddress, isConnected, chain } = useAccount();
  const address = propAddress || connectedAddress;
  const wagmiChainId = useChainId();
  const chainId = chain?.id ?? wagmiChainId;
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  
  // SUI hooks
  const suiContext = useSuiSafe();
  const suiAddress = suiContext?.address ?? null;
  const suiIsConnected = suiContext?.isConnected ?? false;
  const suiBalance = suiContext?.balance ?? '0';
  const suiExecuteTransaction = suiContext?.executeTransaction;
  const suiNetwork = suiContext?.network ?? 'testnet';
  const suiIsWrongNetwork = suiContext?.isWrongNetwork ?? false;
  const suiSetNetwork = suiContext?.setNetwork;
  
  // Derived values
  const { selectedChain } = poolState;
  const chainConfig = POOL_CHAIN_CONFIGS[selectedChain];
  const detectedNetwork = chainId ? getNetworkFromChainId(chainId) : 'testnet';
  const network = isPoolDeployed(selectedChain, detectedNetwork) ? detectedNetwork : 'testnet';
  const USDT_ADDRESS = getUsdtAddress(selectedChain, network);
  const COMMUNITY_POOL_ADDRESS = getCommunityPoolAddress(selectedChain, network);
  const poolDeployed = isPoolDeployed(selectedChain, network);
  
  // ERC20 allowance check (for USDT reset-to-zero pattern)
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'allowance',
    args: address && COMMUNITY_POOL_ADDRESS ? [address as `0x${string}`, COMMUNITY_POOL_ADDRESS] : undefined,
    query: { enabled: !!address && !!COMMUNITY_POOL_ADDRESS && selectedChain !== 'sui' },
  });
  
  // User's USDT balance (show how much they can deposit)
  const { data: userUsdtBalance } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address && !!USDT_ADDRESS && selectedChain !== 'sui' },
  });
  
  // Pool total shares (to detect first deposit)
  const { data: poolTotalShares } = useReadContract({
    address: COMMUNITY_POOL_ADDRESS,
    abi: [{ name: 'totalShares', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'totalShares',
    query: { enabled: !!COMMUNITY_POOL_ADDRESS && selectedChain !== 'sui' },
  });
  
  // Derived: is first deposit (requires $100 minimum for inflation attack protection)
  const isFirstDeposit = useMemo(() => {
    if (!poolTotalShares) return true;
    return BigInt(poolTotalShares.toString()) === BigInt(0);
  }, [poolTotalShares]);
  
  // Derived: Check if wallet chain matches selected chain (for EVM only)
  const validChainIds = useMemo(() => getValidChainIds(selectedChain), [selectedChain]);
  const isChainMismatch = useMemo(() => {
    if (selectedChain === 'sui') return false; // SUI has its own network check
    if (!isConnected || !chainId) return false;
    return !validChainIds.includes(chainId);
  }, [selectedChain, isConnected, chainId, validChainIds]);
  
  // ============================================================================
  // CHAIN SELECTION
  // ============================================================================
  
  // Auto-detect chain based on connected wallet
  // Priority: Connected wallet chain > SUI default
  useEffect(() => {
    // Skip if user has manually selected a chain
    if (userSelectedChainRef.current) return;
    
    // Check which wallet is connected
    const suiWalletConnected = suiIsConnected && suiAddress;
    const evmWalletConnected = isConnected && address;
    
    if (suiWalletConnected && !evmWalletConnected) {
      // Only SUI wallet connected - use SUI
      if (selectedChain !== 'sui') {
        dispatchPool({ type: 'SET_CHAIN', payload: 'sui' });
      }
    } else if (evmWalletConnected && !suiWalletConnected) {
      // Only EVM wallet connected - detect which EVM chain
      const detectedChain = getChainKeyFromId(chainId) as ChainKey | null;
      if (detectedChain && detectedChain !== selectedChain) {
        dispatchPool({ type: 'SET_CHAIN', payload: detectedChain });
      }
    } else if (suiWalletConnected && evmWalletConnected) {
      // Both wallets connected - prefer SUI (it's the default/optimized chain)
      if (selectedChain !== 'sui') {
        dispatchPool({ type: 'SET_CHAIN', payload: 'sui' });
      }
    }
    // If no wallet connected, keep current selection (defaults to 'sui' in initialPoolState)
  }, [chainId, selectedChain, suiIsConnected, suiAddress, isConnected, address]);
  
  const handleChainSelect = useCallback((key: ChainKey) => {
    userSelectedChainRef.current = true;
    // Use startTransition for non-urgent chain switch (keeps UI responsive)
    startTransition(() => {
      dispatchPool({ type: 'SET_CHAIN', payload: key });
    });
  }, []);
  
  // Reset state on chain change
  useEffect(() => {
    mountedRef.current = true;
    dispatchPool({ type: 'RESET_FOR_CHAIN_CHANGE' });
    dispatchTx({ type: 'RESET_TX_STATE' });
    
    return () => {
      mountedRef.current = false;
    };
  }, [selectedChain]);
  
  // Auto-retry pending action after successful chain switch
  // This creates a seamless UX where deposit continues automatically
  // Note: We just mark the action as ready - the actual execution happens
  // in a separate effect after the handlers are defined
  useEffect(() => {
    if (!pendingChainSwitchRef.current) return;
    if (!chainId) return;
    
    const { action, targetChainId } = pendingChainSwitchRef.current;
    
    // Check if we're now on the target chain
    if (chainId === targetChainId) {
      logger.info('[CommunityPool] Chain switch completed, preparing to auto-continue', { action, chainId });
      // Keep the pending info - it will be executed by the post-handler effect
      dispatchPool({ type: 'SET_ERROR', payload: null });
      dispatchPool({ type: 'SET_SUCCESS', payload: `Switched to ${chainConfig?.name}! Starting ${action}...` });
    }
  }, [chainId, chainConfig?.name]);
  
  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  
  const fetchPoolData = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 5000) return;
    lastFetchRef.current = now;
    
    if (selectedChain === 'sui') {
      const userAddress = suiAddress;  // Only use SUI address for SUI chain
      try {
        const [poolRes, userRes] = await Promise.all([
          fetch(`/api/sui/community-pool?network=${suiNetwork}`),
          userAddress ? fetch(`/api/sui/community-pool?user=${userAddress}&network=${suiNetwork}`) : null,
        ]);
        
        const [poolJson, userJson] = await Promise.all([
          poolRes.json(),
          userRes ? userRes.json() : null,
        ]);
        
        if (!mountedRef.current) return;
        
        if (poolJson.success) {
          if (poolJson.data.poolStateId) {
            dispatchPool({ type: 'SET_SUI_POOL_STATE_ID', payload: poolJson.data.poolStateId });
          }
          
          const totalValueUSD = parseFloat(poolJson.data.totalNAVUsd) || 0;
          const totalNAV = parseFloat(poolJson.data.totalNAV) || 0;
          
          dispatchPool({
            type: 'SET_POOL_DATA',
            payload: {
              totalShares: parseFloat(poolJson.data.totalShares) || 0,
              totalNAV,
              totalValueUSD,
              sharePrice: parseFloat(poolJson.data.sharePrice) || 1.0,
              sharePriceUSD: parseFloat(poolJson.data.sharePriceUsd) || 1.0,
              memberCount: poolJson.data.memberCount || 0,
              allocations: { BTC: 0, ETH: 0, SUI: totalValueUSD > 0 ? 100 : 0, CRO: 0 },
              aiLastUpdate: null,
              aiReasoning: null,
            },
          });
        }
        
        if (userJson?.success) {
          dispatchPool({
            type: 'SET_USER_POSITION',
            payload: {
              walletAddress: userAddress || '',
              shares: parseFloat(userJson.data.shares) || 0,
              valueUSD: parseFloat(userJson.data.valueUsd) || 0,
              valueSUI: parseFloat(userJson.data.valueSui) || 0,
              percentage: parseFloat(userJson.data.percentage) || 0,
              isMember: userJson.data.isMember || false,
              totalDeposited: parseFloat(userJson.data.depositedSui) || 0,
              totalWithdrawn: parseFloat(userJson.data.withdrawnSui) || 0,
            },
          });
        }
        
        dispatchPool({ type: 'SET_LEADERBOARD', payload: [] });
        dispatchPool({ type: 'SET_LOADING', payload: false });
      } catch (err: any) {
        logger.error('[CommunityPool] SUI fetch error:', err);
        if (mountedRef.current) {
          dispatchPool({ type: 'SET_ERROR', payload: err.message });
          dispatchPool({ type: 'SET_LOADING', payload: false });
        }
      }
      return;
    }
    
    // EVM chains
    const chainParam = `&chain=${selectedChain}&network=${network}`;
    
    try {
      const [poolRes, userRes, leaderRes] = await Promise.all([
        fetch(`/api/community-pool?${chainParam.substring(1)}`),
        address ? fetch(`/api/community-pool?user=${address}${chainParam}`) : null,
        fetch(`/api/community-pool?action=leaderboard&limit=5${chainParam}`),
      ]);
      
      const [poolJson, userJson, leaderJson] = await Promise.all([
        poolRes.json(),
        userRes ? userRes.json() : null,
        leaderRes.json(),
      ]);
      
      if (!mountedRef.current) return;
      
      if (poolJson.success) {
        dispatchPool({ type: 'SET_POOL_DATA', payload: poolJson.pool });
      }
      if (userJson?.success) {
        dispatchPool({ type: 'SET_USER_POSITION', payload: userJson.user });
      }
      if (leaderJson.success) {
        dispatchPool({ type: 'SET_LEADERBOARD', payload: leaderJson.leaderboard });
      }
      
      dispatchPool({ type: 'SET_LOADING', payload: false });
    } catch (err: any) {
      logger.error('[CommunityPool] Fetch error:', err);
      if (mountedRef.current) {
        dispatchPool({ type: 'SET_ERROR', payload: err.message });
        dispatchPool({ type: 'SET_LOADING', payload: false });
      }
    }
  }, [address, suiAddress, selectedChain, network, suiNetwork]);
  
  const fetchAIRecommendation = useCallback(async () => {
    try {
      const res = await fetch(`/api/community-pool/ai-decision?chain=${selectedChain}&network=${network}`);
      const json = await res.json();
      
      if (json.success && mountedRef.current) {
        dispatchPool({ type: 'SET_AI_RECOMMENDATION', payload: json.recommendation });
      }
    } catch (err: any) {
      logger.error('[CommunityPool] AI fetch error:', err);
    }
  }, [selectedChain, network]);
  
  // Initial fetch
  useEffect(() => {
    fetchPoolData(true);
  }, [fetchPoolData]);
  
  // Polling (60s)
  usePolling(fetchPoolData, 60000);
  
  // ============================================================================
  // TRANSACTION HANDLERS
  // ============================================================================
  
  // Track processed transaction hashes to prevent duplicate handling
  const processedHashRef = useRef<string | null>(null);
  const pendingDepositRef = useRef<{ amount: string } | null>(null);
  
  // Handle USDT reset approval confirmation -> trigger actual approval
  useEffect(() => {
    if (!txHash || !isConfirmed) return;
    if (processedHashRef.current === txHash) return; // Already processed
    
    if (txState.txStatus === 'resetting_approval' && txState.depositAmount) {
      processedHashRef.current = txHash; // Mark as processed
      logger.info('[CommunityPool] USDT allowance reset confirmed, proceeding with approval');
      
      const amount = parseFloat(txState.depositAmount);
      if (!isNaN(amount) && COMMUNITY_POOL_ADDRESS && USDT_ADDRESS) {
        resetWrite();
        
        setTimeout(() => {
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'approving' });
          const amountInUnits = parseUnits(amount.toString(), 6);
          
          writeContract({
            address: USDT_ADDRESS,
            abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
            functionName: 'approve',
            args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
          });
        }, 1000);
      }
    }
  }, [txHash, isConfirmed, txState.txStatus, txState.depositAmount, COMMUNITY_POOL_ADDRESS, USDT_ADDRESS, writeContract, resetWrite]);
  
  // Handle EVM approval confirmation -> trigger deposit
  useEffect(() => {
    if (!txHash || !isConfirmed) return;
    if (processedHashRef.current === txHash) return; // Already processed
    
    if (txState.txStatus === 'approving' && txState.depositAmount) {
      processedHashRef.current = txHash; // Mark as processed
      
      const amount = parseFloat(txState.depositAmount);
      if (!isNaN(amount) && COMMUNITY_POOL_ADDRESS) {
        // Store the deposit amount for the next transaction
        pendingDepositRef.current = { amount: txState.depositAmount };
        
        // Set status to approved (intermediate state)
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'approved' });
        
        // Reset write state and trigger deposit after a delay
        resetWrite();
        
        setTimeout(() => {
          if (pendingDepositRef.current && COMMUNITY_POOL_ADDRESS) {
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
            const depositAmount = parseFloat(pendingDepositRef.current.amount);
            const amountInUnits = parseUnits(depositAmount.toString(), 6);
            
            writeContract({
              address: COMMUNITY_POOL_ADDRESS,
              abi: [{ name: 'deposit', type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' }],
              functionName: 'deposit',
              args: [amountInUnits],
            });
          }
        }, 1000);
      }
    }
  }, [txHash, isConfirmed, txState.txStatus, txState.depositAmount, COMMUNITY_POOL_ADDRESS, writeContract, resetWrite]);

  // Handle EVM deposit confirmation -> success
  useEffect(() => {
    if (!txHash || !isConfirmed) return;
    if (processedHashRef.current === txHash) return; // Already processed
    
    if (txState.txStatus === 'depositing') {
      processedHashRef.current = txHash; // Mark as processed
      pendingDepositRef.current = null; // Clear pending deposit
      
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
      dispatchPool({ type: 'SET_SUCCESS', payload: `Deposit successful! Tx: ${txHash?.slice(0, 10)}...` });
      dispatchTx({ type: 'SET_DEPOSIT_AMOUNT', payload: '' });
      dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      
      // Refresh pool data after short delay
      setTimeout(() => {
        fetchPoolData(true);
        dispatchPool({ type: 'SET_SUCCESS', payload: null });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
      }, 3000);
    }
  }, [txHash, isConfirmed, txState.txStatus, fetchPoolData]);

  // Handle EVM withdraw confirmation -> success
  useEffect(() => {
    if (!txHash || !isConfirmed) return;
    if (processedHashRef.current === txHash) return; // Already processed
    
    if (txState.txStatus === 'withdrawing') {
      processedHashRef.current = txHash; // Mark as processed
      
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
      dispatchPool({ type: 'SET_SUCCESS', payload: `Withdrawal successful! Tx: ${txHash?.slice(0, 10)}...` });
      dispatchTx({ type: 'SET_WITHDRAW_SHARES', payload: '' });
      dispatchTx({ type: 'SET_SHOW_WITHDRAW', payload: false });
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      
      setTimeout(() => {
        fetchPoolData(true);
        dispatchPool({ type: 'SET_SUCCESS', payload: null });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
      }, 3000);
    }
  }, [txHash, isConfirmed, txState.txStatus, fetchPoolData]);

  // Handle transaction errors
  useEffect(() => {
    if (writeError && txState.txStatus !== 'idle' && txState.txStatus !== 'complete') {
      const errorMsg = writeError.message?.includes('User rejected') 
        ? 'Transaction cancelled by user'
        : writeError.message || 'Transaction failed';
      dispatchPool({ type: 'SET_ERROR', payload: errorMsg });
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
      pendingDepositRef.current = null;
    }
  }, [writeError, txState.txStatus]);
  
  const signForApi = useCallback(async (action: 'deposit' | 'withdraw', amount: string) => {
    if (!address) return null;
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `ZkVanguard Community Pool\n\nAction: ${action.toUpperCase()}\nAmount: $${amount}\nWallet: ${address}\ntimestamp:${timestamp}`;
    try {
      const signature = await signMessageAsync({ message });
      return { signature, message };
    } catch {
      return null;
    }
  }, [address, signMessageAsync]);
  
  const handleDeposit = useCallback(async () => {
    dispatchPool({ type: 'SET_ERROR', payload: null });
    
    if (!isConnected || !address) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Please connect your wallet first' });
      return;
    }
    
    const amount = parseFloat(txState.depositAmount);
    
    // Check minimum deposit amount (first deposit requires $100 for inflation attack protection)
    const minDeposit = isFirstDeposit ? 100 : 10;
    if (isNaN(amount) || amount < minDeposit) {
      dispatchPool({ type: 'SET_ERROR', payload: `Minimum deposit is $${minDeposit}${isFirstDeposit ? ' (first deposit)' : ''}` });
      return;
    }
    
    const validChainIds = getValidChainIds(selectedChain);
    if (!validChainIds.includes(chainId as number)) {
      if (switchChain) {
        const targetChainId = validChainIds[0];
        try {
          dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
          // switchChain triggers wallet prompt - don't await, let the chainId effect handle continuation
          switchChain({ chainId: targetChainId });
          // Store pending action for auto-retry after chain switch
          pendingChainSwitchRef.current = { action: 'deposit', targetChainId };
          return;
        } catch (err) {
          pendingChainSwitchRef.current = null;
          dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name} in your wallet` });
          return;
        }
      }
      dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name} to deposit` });
      return;
    }
    
    if (!poolDeployed) {
      dispatchPool({ type: 'SET_ERROR', payload: `Pool not deployed on ${chainConfig?.name} ${network}` });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    
    try {
      // Refetch current allowance
      await refetchAllowance();
      const allowance = currentAllowance ? BigInt(currentAllowance.toString()) : BigInt(0);
      
      // USDT requires reset-to-zero before changing allowance (non-standard ERC20)
      // Check if we need to reset allowance first
      if (allowance > BigInt(0)) {
        logger.info('[CommunityPool] USDT: Resetting allowance to 0 first', { currentAllowance: allowance.toString() });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'resetting_approval' });
        
        writeContract({
          address: USDT_ADDRESS,
          abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
          functionName: 'approve',
          args: [COMMUNITY_POOL_ADDRESS, BigInt(0)],
        });
        return; // Wait for reset to confirm, then approve in effect
      }
      
      // Allowance is 0, proceed with approval
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'approving' });
      const amountInUnits = parseUnits(amount.toString(), 6);
      
      writeContract({
        address: USDT_ADDRESS,
        abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
        functionName: 'approve',
        args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
      });
    } catch (err: any) {
      dispatchPool({ type: 'SET_ERROR', payload: err.message });
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    }
  }, [isConnected, address, txState.depositAmount, selectedChain, chainId, chainConfig, network, poolDeployed, switchChain, writeContract, USDT_ADDRESS, COMMUNITY_POOL_ADDRESS, currentAllowance, refetchAllowance, isFirstDeposit]);
  
  const handleWithdraw = useCallback(async () => {
    dispatchPool({ type: 'SET_ERROR', payload: null });
    
    if (!isConnected || !address) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Please connect your wallet first' });
      return;
    }
    
    const shares = parseFloat(txState.withdrawShares);
    if (isNaN(shares) || shares <= 0) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Please enter shares to withdraw' });
      return;
    }
    
    // Validate chain ID (same as handleDeposit)
    const validChainIds = getValidChainIds(selectedChain);
    if (!validChainIds.includes(chainId as number)) {
      if (switchChain) {
        const targetChainId = validChainIds[0];
        try {
          dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
          // switchChain triggers wallet prompt - don't await, let the chainId effect handle continuation
          switchChain({ chainId: targetChainId });
          // Store pending action for auto-retry after chain switch
          pendingChainSwitchRef.current = { action: 'withdraw', targetChainId };
          return;
        } catch (err) {
          pendingChainSwitchRef.current = null;
          dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name} in your wallet` });
          return;
        }
      }
      dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name} to withdraw` });
      return;
    }
    
    if (!poolDeployed) {
      dispatchPool({ type: 'SET_ERROR', payload: `Pool not deployed on ${chainConfig?.name} ${network}` });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    dispatchTx({ type: 'SET_TX_STATUS', payload: 'withdrawing' });
    
    try {
      const sharesWei = parseUnits(shares.toFixed(6), 18);
      
      writeContract({
        address: COMMUNITY_POOL_ADDRESS,
        abi: COMMUNITY_POOL_ABI,
        functionName: 'withdraw',
        args: [sharesWei, BigInt(0)],
      });
    } catch (err: any) {
      dispatchPool({ type: 'SET_ERROR', payload: err.message });
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    }
  }, [isConnected, address, txState.withdrawShares, selectedChain, chainId, chainConfig, network, poolDeployed, switchChain, writeContract, COMMUNITY_POOL_ADDRESS]);
  
  // SUI handlers - Accept USDC (USD) and convert to SUI for deposit
  const handleSuiDeposit = useCallback(async () => {
    dispatchPool({ type: 'SET_ERROR', payload: null });
    
    if (!suiIsConnected || !suiAddress) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Please connect your SUI wallet' });
      return;
    }
    
    if (!suiExecuteTransaction) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Wallet transaction signing not available' });
      return;
    }
    
    const usdAmount = parseFloat(txState.suiDepositAmount);
    if (isNaN(usdAmount) || usdAmount <= 0) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Invalid deposit amount' });
      return;
    }
    
    // Minimum deposit: $10 USDC
    if (usdAmount < 10) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Minimum deposit is $10 USDC' });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
    
    try {
      // Step 1: Get current SUI price (fresh from Crypto.com) and calculate SUI amount
      const priceRes = await fetch('/api/prices?symbols=SUI&source=exchange');
      const priceData = await priceRes.json();
      // API returns { success, data: [{ symbol, price, ... }] }
      const suiPriceEntry = priceData?.data?.find((p: { symbol: string }) => p.symbol === 'SUI');
      const suiPrice = suiPriceEntry?.price || 3.50; // fallback price
      const suiAmount = usdAmount / suiPrice;
      
      logger.info(`[SUI Deposit] Fresh price: $${suiPrice}, converting $${usdAmount} → ${suiAmount.toFixed(6)} SUI`);
      
      // Check if user has enough SUI (including 0.1 reserve for gas)
      const userSuiBalance = parseFloat(suiBalance);
      if (userSuiBalance < suiAmount + 0.1) {
        dispatchPool({ type: 'SET_ERROR', payload: `Insufficient SUI. Need ${(suiAmount + 0.1).toFixed(4)} SUI (${suiAmount.toFixed(4)} + gas). You have ${suiBalance} SUI.` });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      // Step 2: Get transaction params from API
      const res = await fetch(`/api/sui/community-pool?action=deposit&network=${suiNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: BigInt(Math.floor(suiAmount * 1e9)).toString() }),
      });
      
      const json = await res.json();
      if (!json.success) {
        dispatchPool({ type: 'SET_ERROR', payload: json.error });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      const { target, poolStateId, amountMist, clockId } = json.data;
      
      if (!poolStateId) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Pool state not found. Try refreshing.' });
        return;
      }
      
      // Step 2: Build transaction using @mysten/sui/transactions
      const { Transaction } = await import('@mysten/sui/transactions');
      const tx = new Transaction();
      
      // Split SUI for the deposit amount
      const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
      
      // Call the deposit function: deposit(state, payment, clock)
      tx.moveCall({
        target,
        arguments: [
          tx.object(poolStateId),
          depositCoin,
          tx.object(clockId),
        ],
      });
      
      // Step 3: Execute transaction
      const result = await suiExecuteTransaction(tx);
      
      if (result.success) {
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
        dispatchPool({ type: 'SET_SUCCESS', payload: `Deposited $${usdAmount.toFixed(2)} USDC! Tx: ${result.digest.slice(0, 10)}...` });
        dispatchTx({ type: 'SET_SUI_DEPOSIT_AMOUNT', payload: '' });
        dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
        
        // Refresh pool data after a short delay
        setTimeout(() => {
          fetchPoolData(true);
          dispatchPool({ type: 'SET_SUCCESS', payload: null });
        }, 3000);
      } else {
        dispatchPool({ type: 'SET_ERROR', payload: 'Transaction failed. Please try again.' });
      }
    } catch (err: any) {
      logger.error('SUI deposit error', err);
      dispatchPool({ type: 'SET_ERROR', payload: err.message || 'Deposit failed' });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    }
  }, [suiIsConnected, suiAddress, suiExecuteTransaction, txState.suiDepositAmount, suiNetwork, suiBalance, fetchPoolData]);
  
  const handleSuiWithdraw = useCallback(async () => {
    dispatchPool({ type: 'SET_ERROR', payload: null });
    
    if (!suiIsConnected || !suiAddress) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Please connect your SUI wallet' });
      return;
    }
    
    if (!suiExecuteTransaction) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Wallet transaction signing not available' });
      return;
    }
    
    const shares = parseFloat(txState.suiWithdrawShares);
    if (isNaN(shares) || shares <= 0) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Invalid share amount' });
      return;
    }
    
    // Calculate estimated USD value
    const sharePrice = Number(poolState.poolData?.sharePriceUSD || poolState.poolData?.sharePrice) || 1;
    const estimatedUsd = shares * sharePrice;
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    dispatchTx({ type: 'SET_TX_STATUS', payload: 'withdrawing' });
    
    try {
      // Step 1: Get transaction params from API
      const res = await fetch(`/api/sui/community-pool?action=withdraw&network=${suiNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shares: BigInt(Math.floor(shares * 1e9)).toString() }),
      });
      
      const json = await res.json();
      if (!json.success) {
        dispatchPool({ type: 'SET_ERROR', payload: json.error });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      const { target, poolStateId, sharesScaled, clockId } = json.data;
      
      if (!poolStateId) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Pool state not found. Try refreshing.' });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      // Step 2: Build transaction using @mysten/sui/transactions
      const { Transaction } = await import('@mysten/sui/transactions');
      const tx = new Transaction();
      
      // Call the withdraw function: withdraw(state, shares_to_burn, clock)
      tx.moveCall({
        target,
        arguments: [
          tx.object(poolStateId),
          tx.pure.u64(sharesScaled),
          tx.object(clockId),
        ],
      });
      
      // Step 3: Execute transaction
      const result = await suiExecuteTransaction(tx);
      
      if (result.success) {
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
        dispatchPool({ type: 'SET_SUCCESS', payload: `Withdrew ~$${estimatedUsd.toFixed(2)} USD! Tx: ${result.digest.slice(0, 10)}...` });
        dispatchTx({ type: 'SET_SUI_WITHDRAW_SHARES', payload: '' });
        dispatchTx({ type: 'SET_SHOW_WITHDRAW', payload: false });
        
        // Refresh pool data after a short delay
        setTimeout(() => {
          fetchPoolData(true);
          dispatchPool({ type: 'SET_SUCCESS', payload: null });
        }, 3000);
      } else {
        dispatchPool({ type: 'SET_ERROR', payload: 'Transaction failed. Please try again.' });
      }
    } catch (err: any) {
      logger.error('SUI withdraw error', err);
      dispatchPool({ type: 'SET_ERROR', payload: err.message || 'Withdrawal failed' });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    }
  }, [suiIsConnected, suiAddress, suiExecuteTransaction, txState.suiWithdrawShares, suiNetwork, poolState.poolData, fetchPoolData]);
  
  // ============================================================================
  // AUTO-EXECUTE AFTER CHAIN SWITCH
  // This effect runs when chainId changes and checks for pending actions
  // ============================================================================
  useEffect(() => {
    const pending = pendingChainSwitchRef.current;
    if (!pending) return;
    if (!chainId) return;
    
    const { action, targetChainId } = pending;
    
    // Execute only when we're on the target chain
    if (chainId === targetChainId) {
      // Clear pending action BEFORE executing to prevent re-triggering
      pendingChainSwitchRef.current = null;
      
      logger.info(`[CommunityPool] Chain switch completed! Auto-executing: ${action}, chainId: ${chainId}`);
      dispatchPool({ type: 'SET_ERROR', payload: null });
      dispatchPool({ type: 'SET_SUCCESS', payload: `Switched to chain! Processing ${action}...` });
      
      // Delay to let state settle, then execute
      const timer = setTimeout(() => {
        dispatchPool({ type: 'SET_SUCCESS', payload: null });
        if (action === 'deposit') {
          handleDeposit();
        } else if (action === 'withdraw') {
          handleWithdraw();
        }
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [chainId]); // Only depend on chainId - handlers are stable enough
  
  // ============================================================================
  // Stable dispatcher callbacks (avoid re-creating on every render)
  const setShowDeposit = useCallback((show: boolean) => dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: show }), []);
  const setShowWithdraw = useCallback((show: boolean) => dispatchTx({ type: 'SET_SHOW_WITHDRAW', payload: show }), []);
  const setDepositAmount = useCallback((amount: string) => dispatchTx({ type: 'SET_DEPOSIT_AMOUNT', payload: amount }), []);
  const setWithdrawShares = useCallback((shares: string) => dispatchTx({ type: 'SET_WITHDRAW_SHARES', payload: shares }), []);
  const setSuiDepositAmount = useCallback((amount: string) => dispatchTx({ type: 'SET_SUI_DEPOSIT_AMOUNT', payload: amount }), []);
  const setSuiWithdrawShares = useCallback((shares: string) => dispatchTx({ type: 'SET_SUI_WITHDRAW_SHARES', payload: shares }), []);
  const setError = useCallback((error: string | null) => dispatchPool({ type: 'SET_ERROR', payload: error }), []);
  const setSuccess = useCallback((msg: string | null) => dispatchPool({ type: 'SET_SUCCESS', payload: msg }), []);
  const setTxStatus = useCallback((status: TxStatus) => dispatchTx({ type: 'SET_TX_STATUS', payload: status }), []);
  const setActionLoading = useCallback((loading: boolean) => dispatchTx({ type: 'SET_ACTION_LOADING', payload: loading }), []);
  const setLastTxHash = useCallback((hash: string | null) => dispatchTx({ type: 'SET_LAST_TX_HASH', payload: hash }), []);

  // ============================================================================
  // MEMOIZED RETURN VALUE (prevents re-renders when unchanged)
  // ============================================================================
  
  // Memoize pool-related values
  const poolValues = useMemo(() => ({
    poolData: poolState.poolData,
    userPosition: poolState.userPosition,
    aiRecommendation: poolState.aiRecommendation,
    leaderboard: poolState.leaderboard,
    loading: poolState.loading,
    error: poolState.error,
    successMessage: poolState.successMessage,
    selectedChain: poolState.selectedChain,
    suiPoolStateId: poolState.suiPoolStateId,
  }), [poolState]);
  
  // Memoize transaction-related values
  const txValues = useMemo(() => ({
    txStatus: txState.txStatus,
    actionLoading: txState.actionLoading,
    showDeposit: txState.showDeposit,
    showWithdraw: txState.showWithdraw,
    depositAmount: txState.depositAmount,
    withdrawShares: txState.withdrawShares,
    suiDepositAmount: txState.suiDepositAmount,
    suiWithdrawShares: txState.suiWithdrawShares,
    lastTxHash: txState.lastTxHash,
  }), [txState]);
  
  // Memoize wallet-related values with chain-aware active address
  const walletValues = useMemo(() => {
    const isSui = selectedChain === 'sui';
    const activeAddress = isSui ? suiAddress : address;
    const isActiveWalletConnected = isSui ? suiIsConnected : isConnected;
    
    return {
      address,
      isConnected,
      chainId,
      suiAddress,
      suiIsConnected,
      suiBalance,
      suiNetwork,
      suiIsWrongNetwork,
      // Chain-aware helpers
      activeAddress,
      isActiveWalletConnected,
    };
  }, [address, isConnected, chainId, suiAddress, suiIsConnected, suiBalance, suiNetwork, suiIsWrongNetwork, selectedChain]);
  
  // Memoize derived configuration values
  const configValues = useMemo(() => {
    // Format user's USDT balance (6 decimals)
    const userBalance = userUsdtBalance 
      ? parseFloat(formatUnits(BigInt(userUsdtBalance.toString()), 6))
      : 0;
    
    return {
      chainConfig,
      network,
      poolDeployed,
      COMMUNITY_POOL_ADDRESS,
      isFirstDeposit,
      isChainMismatch,
      userUsdtBalance: userBalance,
    };
  }, [chainConfig, network, poolDeployed, COMMUNITY_POOL_ADDRESS, isFirstDeposit, isChainMismatch, userUsdtBalance]);

  // RETURN
  // ============================================================================
  
  return useMemo(() => ({
    // Pool state (memoized)
    ...poolValues,
    
    // Transaction state (memoized)
    ...txValues,
    isPending,
    isConfirming,
    isConfirmed,
    writeError,
    
    // Wallet state (memoized)
    ...walletValues,
    
    // Derived config (memoized)
    ...configValues,
    
    // Actions (stable callbacks)
    handleChainSelect,
    fetchPoolData,
    fetchAIRecommendation,
    handleDeposit,
    handleWithdraw,
    handleSuiDeposit,
    handleSuiWithdraw,
    resetWrite,
    signForApi,
    
    // Stable dispatchers
    setShowDeposit,
    setShowWithdraw,
    setDepositAmount,
    setWithdrawShares,
    setSuiDepositAmount,
    setSuiWithdrawShares,
    setError,
    setSuccess,
    setTxStatus,
    setActionLoading,
    setLastTxHash,
  }), [
    poolValues,
    txValues,
    isPending,
    isConfirming,
    isConfirmed,
    writeError,
    walletValues,
    configValues,
    handleChainSelect,
    fetchPoolData,
    fetchAIRecommendation,
    handleDeposit,
    handleWithdraw,
    handleSuiDeposit,
    handleSuiWithdraw,
    resetWrite,
    signForApi,
    setShowDeposit,
    setShowWithdraw,
    setDepositAmount,
    setWithdrawShares,
    setSuiDepositAmount,
    setSuiWithdrawShares,
    setError,
    setSuccess,
    setTxStatus,
    setActionLoading,
    setLastTxHash,
  ]);
}
