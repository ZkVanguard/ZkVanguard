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
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useSignMessage } from 'wagmi';
import { parseUnits } from 'viem';
import { logger } from '@/lib/utils/logger';
import { usePolling } from '@/lib/hooks';
import { useSuiSafe } from '@/app/sui-providers';
import { 
  POOL_CHAIN_CONFIGS, 
  getCommunityPoolAddress, 
  getUsdcAddress,
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
  selectedChain: 'sui',  // SUI is the default and optimized chain
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
  
  // Derived values
  const { selectedChain } = poolState;
  const chainConfig = POOL_CHAIN_CONFIGS[selectedChain];
  const detectedNetwork = chainId ? getNetworkFromChainId(chainId) : 'testnet';
  const network = isPoolDeployed(selectedChain, detectedNetwork) ? detectedNetwork : 'testnet';
  const USDC_ADDRESS = getUsdcAddress(selectedChain, network);
  const COMMUNITY_POOL_ADDRESS = getCommunityPoolAddress(selectedChain, network);
  const poolDeployed = isPoolDeployed(selectedChain, network);
  
  // ============================================================================
  // CHAIN SELECTION
  // ============================================================================
  
  // Auto-detect chain from wallet (only for EVM chains, don't override SUI default)
  useEffect(() => {
    // Skip auto-detection if:
    // 1. User has manually selected a chain
    // 2. Current chain is SUI (SUI is default, don't auto-switch away)
    if (chainId && !userSelectedChainRef.current && selectedChain !== 'sui') {
      const detectedChain = getChainKeyFromId(chainId) as ChainKey | null;
      if (detectedChain && detectedChain !== selectedChain) {
        dispatchPool({ type: 'SET_CHAIN', payload: detectedChain });
      }
    }
  }, [chainId, selectedChain]);
  
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
    if (isNaN(amount) || amount < 10) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Minimum deposit is $10' });
      return;
    }
    
    const validChainIds = getValidChainIds(selectedChain);
    if (!validChainIds.includes(chainId as number)) {
      if (switchChain) {
        try {
          dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
          await switchChain({ chainId: validChainIds[0] });
          dispatchPool({ type: 'SET_ERROR', payload: `Switched. Please click Deposit again.` });
          return;
        } catch {
          dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name}` });
          return;
        }
      }
      return;
    }
    
    if (!poolDeployed) {
      dispatchPool({ type: 'SET_ERROR', payload: `Pool not deployed on ${chainConfig?.name} ${network}` });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    dispatchTx({ type: 'SET_TX_STATUS', payload: 'approving' });
    
    try {
      const amountInUnits = parseUnits(amount.toString(), 6);
      
      writeContract({
        address: USDC_ADDRESS,
        abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
        functionName: 'approve',
        args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
      });
    } catch (err: any) {
      dispatchPool({ type: 'SET_ERROR', payload: err.message });
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    }
  }, [isConnected, address, txState.depositAmount, selectedChain, chainId, chainConfig, network, poolDeployed, switchChain, writeContract, USDC_ADDRESS, COMMUNITY_POOL_ADDRESS]);
  
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
        try {
          dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
          await switchChain({ chainId: validChainIds[0] });
          dispatchPool({ type: 'SET_ERROR', payload: `Switched. Please click Withdraw again.` });
          return;
        } catch {
          dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name}` });
          return;
        }
      }
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
  
  // SUI handlers
  const handleSuiDeposit = useCallback(async () => {
    dispatchPool({ type: 'SET_ERROR', payload: null });
    
    if (!suiIsConnected || !suiAddress) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Please connect your SUI wallet' });
      return;
    }
    
    const amount = parseFloat(txState.suiDepositAmount);
    if (isNaN(amount) || amount <= 0) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Invalid deposit amount' });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    
    try {
      const res = await fetch(`/api/sui/community-pool?action=deposit&network=${suiNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: BigInt(Math.floor(amount * 1e9)).toString() }),
      });
      
      const json = await res.json();
      if (!json.success) {
        dispatchPool({ type: 'SET_ERROR', payload: json.error });
        return;
      }
      
      dispatchPool({ type: 'SET_SUCCESS', payload: `SUI deposit prepared: ${amount} SUI` });
      dispatchTx({ type: 'SET_SUI_DEPOSIT_AMOUNT', payload: '' });
      dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
      
      setTimeout(() => {
        fetchPoolData(true);
        dispatchPool({ type: 'SET_SUCCESS', payload: null });
      }, 5000);
    } catch (err: any) {
      dispatchPool({ type: 'SET_ERROR', payload: err.message });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [suiIsConnected, suiAddress, txState.suiDepositAmount, suiNetwork, fetchPoolData]);
  
  const handleSuiWithdraw = useCallback(async () => {
    dispatchPool({ type: 'SET_ERROR', payload: null });
    
    if (!suiIsConnected || !suiAddress) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Please connect your SUI wallet' });
      return;
    }
    
    const shares = parseFloat(txState.suiWithdrawShares);
    if (isNaN(shares) || shares <= 0) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Invalid share amount' });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    
    try {
      const res = await fetch(`/api/sui/community-pool?action=withdraw&network=${suiNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shares: BigInt(Math.floor(shares * 1e9)).toString() }),
      });
      
      const json = await res.json();
      if (!json.success) {
        dispatchPool({ type: 'SET_ERROR', payload: json.error });
        return;
      }
      
      dispatchPool({ type: 'SET_SUCCESS', payload: `SUI withdrawal prepared: ${shares} shares` });
      dispatchTx({ type: 'SET_SUI_WITHDRAW_SHARES', payload: '' });
      dispatchTx({ type: 'SET_SHOW_WITHDRAW', payload: false });
      
      setTimeout(() => {
        fetchPoolData(true);
        dispatchPool({ type: 'SET_SUCCESS', payload: null });
      }, 5000);
    } catch (err: any) {
      dispatchPool({ type: 'SET_ERROR', payload: err.message });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [suiIsConnected, suiAddress, txState.suiWithdrawShares, suiNetwork, fetchPoolData]);
  
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
      // Chain-aware helpers
      activeAddress,
      isActiveWalletConnected,
    };
  }, [address, isConnected, chainId, suiAddress, suiIsConnected, suiBalance, selectedChain]);
  
  // Memoize derived configuration values
  const configValues = useMemo(() => ({
    chainConfig,
    network,
    poolDeployed,
    COMMUNITY_POOL_ADDRESS,
  }), [chainConfig, network, poolDeployed, COMMUNITY_POOL_ADDRESS]);

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
