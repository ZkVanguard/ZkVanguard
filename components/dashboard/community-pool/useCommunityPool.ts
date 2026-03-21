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
 * 
 * NOTE: Now uses Tether WDK natively
 */

'use client';

import { useReducer, useCallback, useRef, useEffect, useMemo, useTransition, startTransition } from 'react';
// WDK hooks
import { 
  useAccount, 
  useChainId, 
  useWriteContract, 
  useWaitForTransactionReceipt, 
  useSignMessage, 
  useReadContract, 
  useSwitchChain, 
  useSignTypedData 
} from '@/lib/wdk/wdk-hooks';
import { useSmartAccount } from '@/lib/wdk/useSmartAccount';
import { parseUnits, formatUnits, keccak256, toBytes, encodePacked } from 'viem';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { usePolling } from '@/lib/hooks';
import { useSuiSafe } from '@/app/sui-providers';
import { useWdkSafe } from '@/lib/wdk/wdk-context';
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
  // Skip chain check after successful wallet switch (WDK may not sync immediately)
  const skipChainCheckRef = useRef(false);
  // Preserve deposit amount during chain switch (UI state may be lost)
  const pendingDepositAmountRef = useRef<string>('');
  
  // WDK hooks
  const { address: connectedAddress, isConnected, chain } = useAccount();
  const address = propAddress || connectedAddress;
  const wdkChainId = useChainId();
  const chainId = chain?.id ?? wdkChainId;
  const { signMessageAsync } = useSignMessage();
  const { writeContract, writeContractAsync, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const { switchChainAsync } = useSwitchChain();
  
  // Debug: Track transaction state changes
  useEffect(() => {
    console.error('🟡🟡🟡 TX STATE:', {
      txHash: txHash ? `${txHash.slice(0, 10)}...` : null,
      isPending,
      isConfirming,
      isConfirmed,
      txStatus: txState.txStatus,
      writeError: writeError?.message || null,
    });
  }, [txHash, isPending, isConfirming, isConfirmed, txState.txStatus, writeError]);
  
  // SUI hooks
  const suiContext = useSuiSafe();
  const suiAddress = suiContext?.address ?? null;
  const suiIsConnected = suiContext?.isConnected ?? false;
  const suiBalance = suiContext?.balance ?? '0';
  const suiExecuteTransaction = suiContext?.executeTransaction;
  const suiNetwork = suiContext?.network ?? 'testnet';
  const suiIsWrongNetwork = suiContext?.isWrongNetwork ?? false;
  const suiSetNetwork = suiContext?.setNetwork;
  
  // WDK chain support check (treasury wallet is server-side)
  const wdkContext = useWdkSafe();
  const isWdkChainSupported = wdkContext?.isChainSupported;
  
  // Derived values
  const { selectedChain } = poolState;
  const chainConfig = POOL_CHAIN_CONFIGS[selectedChain];
  const detectedNetwork = chainId ? getNetworkFromChainId(chainId) : 'testnet';
  const network = isPoolDeployed(selectedChain, detectedNetwork) ? detectedNetwork : 'testnet';
  const USDT_ADDRESS = getUsdtAddress(selectedChain, network);
  const COMMUNITY_POOL_ADDRESS = getCommunityPoolAddress(selectedChain, network);
  const poolDeployed = isPoolDeployed(selectedChain, network);
  
  // Determine active wallet type: 'evm' | 'sui' | null
  // Note: WDK treasury is server-side, users connect via WDK self-custodial wallet
  const activeWalletType = useMemo((): 'evm' | 'sui' | null => {
    if (selectedChain === 'sui' && suiIsConnected) return 'sui';
    if (isConnected && address) return 'evm';
    return null;
  }, [selectedChain, suiIsConnected, isConnected, address]);
  
  // Effective address based on active wallet
  const effectiveAddress = useMemo(() => {
    if (activeWalletType === 'sui') return suiAddress;
    return address;
  }, [activeWalletType, suiAddress, address]);
  
  // ERC20 allowance check (for USDT reset-to-zero pattern)
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'allowance',
    args: address && COMMUNITY_POOL_ADDRESS ? [address as `0x${string}`, COMMUNITY_POOL_ADDRESS] : undefined,
    enabled: !!address && !!COMMUNITY_POOL_ADDRESS && selectedChain !== 'sui',
  });
  
  // User's USDT balance (show how much they can deposit)
  const { data: userUsdtBalance } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    enabled: !!address && !!USDT_ADDRESS && selectedChain !== 'sui',
  });
  
  // EIP-2612 Permit Support Check - check if token has nonces() function
  // If nonces exists, token likely supports EIP-2612 permit
  const { data: permitNonce, isError: permitNonceError } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'nonces', type: 'function', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'nonces',
    args: address ? [address as `0x${string}`] : undefined,
    enabled: !!address && !!USDT_ADDRESS && selectedChain !== 'sui',
  });
  
  // EIP-2612: Get token name for permit signing
  const { data: tokenName } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' }],
    functionName: 'name',
    enabled: !!USDT_ADDRESS && selectedChain !== 'sui',
  });
  
  // EIP-2612: Get DOMAIN_SEPARATOR (cached on-chain)
  const { data: domainSeparator } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'DOMAIN_SEPARATOR', type: 'function', inputs: [], outputs: [{ type: 'bytes32' }], stateMutability: 'view' }],
    functionName: 'DOMAIN_SEPARATOR',
    enabled: !!USDT_ADDRESS && selectedChain !== 'sui',
  });
  
  // Check if permit is supported
  const permitSupported = useMemo(() => {
    // Permit is supported if nonces function exists and didn't error
    return !permitNonceError && permitNonce !== undefined && domainSeparator !== undefined;
  }, [permitNonceError, permitNonce, domainSeparator]);
  
  // Typed data signing hook for EIP-2612 permit
  const { signTypedDataAsync } = useSignTypedData();
  
  // Account Abstraction (Gasless) support
  const { depositWithGasless } = useSmartAccount();
  
  // Pool total shares (to detect first deposit)
  const { data: poolTotalShares } = useReadContract({
    address: COMMUNITY_POOL_ADDRESS,
    abi: [{ name: 'totalShares', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'totalShares',
    enabled: !!COMMUNITY_POOL_ADDRESS && selectedChain !== 'sui',
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
      // Only EVM wallet connected - prefer Sepolia (WDK USDT) for hackathon demo
      // Only switch if user is actually on Sepolia, otherwise keep default
      if (chainId === 11155111 && selectedChain !== 'sepolia') {
        dispatchPool({ type: 'SET_CHAIN', payload: 'sepolia' });
      }
      // Don't auto-switch away from Sepolia if user is on another chain
    } else if (suiWalletConnected && evmWalletConnected) {
      // Both wallets connected - prefer Sepolia/WDK for Tether hackathon
      if (selectedChain !== 'sepolia') {
        dispatchPool({ type: 'SET_CHAIN', payload: 'sepolia' });
      }
    }
    // If no wallet connected, keep current selection (defaults to 'sepolia' for WDK)
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
    
    const depositAmountStr = pendingDepositAmountRef.current || txState.depositAmount;
    if (txState.txStatus === 'resetting_approval' && depositAmountStr) {
      processedHashRef.current = txHash; // Mark as processed
      logger.info('[CommunityPool] USDT allowance reset confirmed, proceeding with approval');
      
      const amount = parseFloat(depositAmountStr);
      if (!isNaN(amount) && COMMUNITY_POOL_ADDRESS && USDT_ADDRESS) {
        resetWrite();
        
        // Get target chain for approval
        const validChainIds = getValidChainIds(selectedChain);
        const targetChainId = validChainIds[0];
        console.error('🔴🔴🔴 RESET CONFIRMED - Will approve in 1s', { targetChainId });
        
        setTimeout(() => {
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'approving' });
          const amountInUnits = parseUnits(amount.toString(), 6);
          
          writeContract({
            chainId: targetChainId,
            address: USDT_ADDRESS,
            abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
            functionName: 'approve',
            args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
          });
        }, 1000);
      }
    }
  }, [txHash, isConfirmed, txState.txStatus, txState.depositAmount, COMMUNITY_POOL_ADDRESS, USDT_ADDRESS, writeContract, resetWrite, selectedChain]);
  
  // Handle EVM approval confirmation -> trigger deposit
  useEffect(() => {
    if (!txHash || !isConfirmed) return;
    if (processedHashRef.current === txHash) return; // Already processed
    
    const depositAmountStr = pendingDepositAmountRef.current || txState.depositAmount;
    if (txState.txStatus === 'approving' && depositAmountStr) {
      processedHashRef.current = txHash; // Mark as processed
      
      const amount = parseFloat(depositAmountStr);
      if (!isNaN(amount) && COMMUNITY_POOL_ADDRESS) {
        // Store the deposit amount for the next transaction
        pendingDepositRef.current = { amount: depositAmountStr };
        
        // Set status to approved (intermediate state)
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'approved' });
        
        // Reset write state and trigger deposit after a delay
        resetWrite();
        
        // Get target chain for deposit
        const validChainIds = getValidChainIds(selectedChain);
        const targetChainId = validChainIds[0];
        console.error('🔴🔴🔴 APPROVAL CONFIRMED - Will deposit in 1s', { targetChainId });
        
        setTimeout(() => {
          if (pendingDepositRef.current && COMMUNITY_POOL_ADDRESS) {
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
            const depositAmount = parseFloat(pendingDepositRef.current.amount);
            const amountInUnits = parseUnits(depositAmount.toString(), 6);
            console.error('🔴🔴🔴 DEPOSITING NOW', { amount: depositAmount, amountInUnits: amountInUnits.toString() });
            
            writeContract({
              chainId: targetChainId,
              address: COMMUNITY_POOL_ADDRESS,
              abi: [{ name: 'deposit', type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' }],
              functionName: 'deposit',
              args: [amountInUnits],
            });
          }
        }, 1000);
      }
    }
  }, [txHash, isConfirmed, txState.txStatus, txState.depositAmount, COMMUNITY_POOL_ADDRESS, writeContract, resetWrite, selectedChain]);

  // Handle EVM deposit confirmation -> success
  useEffect(() => {
    if (!txHash || !isConfirmed) return;
    if (processedHashRef.current === txHash) return; // Already processed
    
    if (txState.txStatus === 'depositing') {
      processedHashRef.current = txHash; // Mark as processed
      pendingDepositRef.current = null; // Clear pending deposit
      pendingDepositAmountRef.current = ''; // Clear preserved amount from chain switch
      
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
    
    // Use preserved amount from ref if available (survives chain switch), else use UI state
    const depositAmountStr = pendingDepositAmountRef.current || txState.depositAmount;
    const amount = parseFloat(depositAmountStr);
    console.error('🔴🔴🔴 DEPOSIT - Amount context:', { fromRef: pendingDepositAmountRef.current, fromState: txState.depositAmount, using: depositAmountStr });
    
    // Check minimum deposit amount (first deposit requires $100 for inflation attack protection)
    const minDeposit = isFirstDeposit ? 100 : 10;
    if (isNaN(amount) || amount < minDeposit) {
      dispatchPool({ type: 'SET_ERROR', payload: `Minimum deposit is $${minDeposit}${isFirstDeposit ? ' (first deposit)' : ''}` });
      return;
    }
    
    const validChainIds = getValidChainIds(selectedChain);
    
    // Skip chain check if we just did a successful wallet switch (WDK lags behind native API)
    if (skipChainCheckRef.current) {
      console.error('🔴🔴🔴 CHAIN SWITCH v3 - Skipping chain check (just switched), proceeding with deposit');
      skipChainCheckRef.current = false;
      // Fall through to actual deposit logic below
    } else if (!validChainIds.includes(chainId as number)) {
      const targetChainId = validChainIds[0];
      console.error('🔴🔴🔴 CHAIN SWITCH v3 - Mismatch detected!', { chainId, targetChainId, selectedChain });
      // Preserve the deposit amount in ref before chain switch (UI state may be lost during switch)
      pendingDepositAmountRef.current = txState.depositAmount;
      console.error('🔴🔴🔴 CHAIN SWITCH v3 - Saving deposit amount to ref:', txState.depositAmount);
      dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
      pendingChainSwitchRef.current = { action: 'deposit', targetChainId };
      
      // Chain parameters for adding to wallet
      const chainParams: Record<number, { chainId: string; chainName: string; rpcUrls: string[]; blockExplorerUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number } }> = {
        11155111: { // Sepolia
          chainId: '0xaa36a7',
          chainName: 'Sepolia',
          rpcUrls: ['https://sepolia.drpc.org', 'https://rpc.sepolia.org'],
          blockExplorerUrls: ['https://sepolia.etherscan.io'],
          nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        },
        338: { // Cronos Testnet
          chainId: '0x152',
          chainName: 'Cronos Testnet',
          rpcUrls: ['https://evm-t3.cronos.org'],
          blockExplorerUrls: ['https://explorer.cronos.org/testnet'],
          nativeCurrency: { name: 'Test Cronos', symbol: 'tCRO', decimals: 18 },
        },
        421614: { // Arbitrum Sepolia
          chainId: '0x66eee',
          chainName: 'Arbitrum Sepolia',
          rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
          blockExplorerUrls: ['https://sepolia.arbiscan.io'],
          nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
        },
      };
      
      // Use WDK switchChainAsync - this properly syncs state
      console.error('🔴🔴🔴 CHAIN SWITCH v4 - Using WDK switchChainAsync to', targetChainId);
      
      // Set timeout for user feedback
      const timeoutId = setTimeout(() => {
        if (pendingChainSwitchRef.current?.action === 'deposit') {
          console.log('[CommunityPool] Switch timeout');
          dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name} in your wallet, then click Deposit again.` });
          pendingChainSwitchRef.current = null;
        }
      }, 20000);
      
      // Try WDK switchChainAsync (syncs state properly)
      switchChainAsync({ chainId: targetChainId })
        .then(() => {
          console.error('🔴🔴🔴 CHAIN SWITCH v4 - switchChainAsync SUCCESS!');
          clearTimeout(timeoutId);
          pendingChainSwitchRef.current = null;
          dispatchPool({ type: 'SET_ERROR', payload: null });
          // State is now synced, proceed immediately
          console.error('🔴🔴🔴 CHAIN SWITCH v4 - Proceeding with deposit (synced)');
          setTimeout(() => {
            handleDeposit();
          }, 100);
        })
        .catch(async (switchError: any) => {
          console.error('🔴🔴🔴 CHAIN SWITCH v4 - WDK error:', switchError?.message);
          // Fallback to native API if WDK fails (e.g., chain not in config)
          const ethereum = (window as any).ethereum;
          if (!ethereum) {
            clearTimeout(timeoutId);
            dispatchPool({ type: 'SET_ERROR', payload: 'No wallet detected.' });
            return;
          }
          
          const params = chainParams[targetChainId];
          if (!params) {
            clearTimeout(timeoutId);
            dispatchPool({ type: 'SET_ERROR', payload: `Chain ${targetChainId} not supported` });
            return;
          }
          
          try {
            console.error('🔴🔴🔴 CHAIN SWITCH v4 - Falling back to native API');
            await ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: params.chainId }],
            });
            console.error('🔴🔴🔴 CHAIN SWITCH v4 - Native switch SUCCESS');
            clearTimeout(timeoutId);
            skipChainCheckRef.current = true;
            pendingChainSwitchRef.current = null;
            dispatchPool({ type: 'SET_ERROR', payload: null });
            // Wait a bit longer for WDK to sync via chainChanged event
            setTimeout(() => {
              console.error('🔴🔴🔴 CHAIN SWITCH v4 - Retrying deposit after native switch');
              handleDeposit();
            }, 1000);
          } catch (nativeError: any) {
            console.error('🔴🔴🔴 CHAIN SWITCH v4 - Native error:', nativeError?.code, nativeError?.message);
            if (nativeError?.code === 4902) {
              // Chain not added - try to add it
              try {
                await ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [params],
                });
                console.error('🔴🔴🔴 CHAIN SWITCH v4 - Chain added');
                clearTimeout(timeoutId);
                skipChainCheckRef.current = true;
                pendingChainSwitchRef.current = null;
                dispatchPool({ type: 'SET_ERROR', payload: null });
                setTimeout(() => handleDeposit(), 1000);
              } catch (addError: any) {
                clearTimeout(timeoutId);
                pendingChainSwitchRef.current = null;
                dispatchPool({ type: 'SET_ERROR', payload: `Please add ${chainConfig?.name} to your wallet manually.` });
              }
            } else if (nativeError?.code === 4001) {
              clearTimeout(timeoutId);
              pendingChainSwitchRef.current = null;
              dispatchPool({ type: 'SET_ERROR', payload: 'Chain switch rejected. Please switch manually.' });
            } else {
              clearTimeout(timeoutId);
              pendingChainSwitchRef.current = null;
              dispatchPool({ type: 'SET_ERROR', payload: nativeError?.message || 'Chain switch failed' });
            }
          }
        });
      return;
    }
    
    if (!poolDeployed) {
      dispatchPool({ type: 'SET_ERROR', payload: `Pool not deployed on ${chainConfig?.name} ${network}` });
      return;
    }
    
    // Get the target chain ID for this deposit (use selected chain, not WDK's stale value)
    const targetChainId = validChainIds[0];
    console.error('🔴🔴🔴 DEPOSIT - Proceeding with deposit', { 
      amount, 
      targetChainId, 
      wdkChainId: chainId, 
      USDT_ADDRESS, 
      COMMUNITY_POOL_ADDRESS,
      poolDeployed,
      permitSupported,
    });
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    
    // =========================================
    // TRY GASLESS (AA) FLOW
    // =========================================
    // Sepolia supports AA/Gasless. Try this first if available to save gas (USDT paid).
    if (validChainIds.includes(11155111)) {
        console.log('Attempting Gasless (Account Abstraction) flow...');
        try {
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'signing_permit' }); // Reusing status for signing
            const tx = await depositWithGasless(amount.toString());
            
            console.log('Gasless Deposit Success:', tx);
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' }); // Show depositing spinner
            
            // Wait a bit for indexing/propagation (simplified for now)
            await new Promise(r => setTimeout(r, 5000));
            
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
            dispatchPool({ type: 'SET_SUCCESS', payload: `Gasless Deposit Submitted! Tx: ${tx.slice(0,10)}...` });
            dispatchTx({ type: 'SET_DEPOSIT_AMOUNT', payload: '' });
            dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
            dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
            
            // Refresh
            setTimeout(() => {
                fetchPoolData(true);
                dispatchPool({ type: 'SET_SUCCESS', payload: null });
                dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
            }, 3000);
            return;
            
        } catch (err: any) {
            console.warn('Gasless flow failed/skipped:', err.message);
            // Only fall back if it wasn't a user rejection or if it's explicitly "Not a smart account"
            if (err.message?.includes('User rejected')) {
                 dispatchPool({ type: 'SET_ERROR', payload: 'Transaction cancelled' });
                 dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
                 dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
                 return;
            }
            
            // If failed because not a smart account, fall back to EOA flow
            // Otherwise, show error?
            // For now, let's assume we fall back to EOA flow for robustness.
            console.log('Falling back to standard EOA deposit...');
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' }); // Reset for standard flow
        }
    }
    
    // =========================================
    // CHECK & FUND GAS FOR WDK EOA WALLETS
    // =========================================
    // WDK wallets may have USDT but no ETH for gas. Request server-side gas funding if needed.
    try {
      const rpcUrl = chainConfig.rpcUrls[network];
      const gasCheckProvider = new ethers.JsonRpcProvider(rpcUrl);
      const ethBalance = await gasCheckProvider.getBalance(address as string);
      const minGas = ethers.parseEther('0.001');
      
      if (ethBalance < minGas) {
        console.log('🔵🔵🔵 GAS FUND - Wallet has insufficient ETH, requesting gas funding...');
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'signing_permit' }); // reuse status for "preparing"
        
        const fundResp = await fetch('/api/community-pool/deposit-usdt?action=fund-gas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: address,
            chainId: targetChainId,
          }),
        });
        
        const fundResult = await fundResp.json();
        
        if (!fundResp.ok) {
          console.error('🔵🔵🔵 GAS FUND - Failed:', fundResult.error);
          dispatchPool({ type: 'SET_ERROR', payload: fundResult.error || 'Failed to obtain gas funding. Please get Sepolia ETH from a faucet.' });
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
          dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
          return;
        }
        
        if (fundResult.funded && fundResult.txHash) {
          console.log('🔵🔵🔵 GAS FUND - Funded! TX:', fundResult.txHash);
          // Brief wait for balance to propagate
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.log('🔵🔵🔵 GAS FUND - Already funded:', fundResult.message);
        }
      }
    } catch (fundErr: any) {
      console.warn('Gas funding check failed, proceeding anyway:', fundErr.message);
    }
    
    // =========================================
    // TRY EIP-2612 PERMIT FLOW (Single TX!)
    // =========================================
    if (permitSupported && permitNonce !== undefined && tokenName && signTypedDataAsync) {
      console.error('🟢🟢🟢 PERMIT - Token supports EIP-2612, trying gasless approval');
      
      try {
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'signing_permit' });
        
        const amountInUnits = parseUnits(amount.toString(), 6);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now
        const nonce = BigInt(permitNonce.toString());
        
        // EIP-712 Permit typed data
        const domain = {
          name: tokenName as string,
          version: '1',
          chainId: targetChainId,
          verifyingContract: USDT_ADDRESS as `0x${string}`,
        };
        
        const types = {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        };
        
        const message = {
          owner: address as `0x${string}`,
          spender: COMMUNITY_POOL_ADDRESS as `0x${string}`,
          value: amountInUnits,
          nonce: nonce,
          deadline: deadline,
        };
        
        console.error('🟢🟢🟢 PERMIT - Signing permit message', { domain, message });
        
        // Sign the permit (gasless - just a signature!)
        const signature = await signTypedDataAsync({
          domain,
          types,
          primaryType: 'Permit',
          message,
        });

        if (!signature) throw new Error('Failed to obtain signature');

        console.error('🟢🟢🟢 PERMIT - Signature obtained', { signature: signature.slice(0, 20) + '...' });
        
        // Parse signature into v, r, s
        const r = signature.slice(0, 66) as `0x${string}`;
        const s = ('0x' + signature.slice(66, 130)) as `0x${string}`;
        const v = parseInt(signature.slice(130, 132), 16);
        
        console.error('🟢🟢🟢 PERMIT - Calling depositWithPermit (single TX!)', { amount: amountInUnits.toString(), deadline: deadline.toString(), v, r: r.slice(0, 10) + '...' });
        
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
        
        // Call depositWithPermit - single transaction using async/await!
        const permitDepositTxHash = await writeContractAsync({
          chainId: targetChainId,
          address: COMMUNITY_POOL_ADDRESS,
          abi: [{
            name: 'depositWithPermit',
            type: 'function',
            inputs: [
              { name: 'amount', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'v', type: 'uint8' },
              { name: 'r', type: 'bytes32' },
              { name: 's', type: 'bytes32' },
            ],
            outputs: [{ type: 'uint256' }],
            stateMutability: 'nonpayable',
          }],
          functionName: 'depositWithPermit',
          args: [amountInUnits, deadline, v, r, s],
        });
        
        console.error('🟢🟢🟢 PERMIT - depositWithPermit tx submitted:', permitDepositTxHash);
        {
          const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrls[network]);
          await provider.waitForTransaction(permitDepositTxHash, 1, 60000);
        }
        console.error('🟢🟢🟢 PERMIT - Deposit confirmed!');
        
        // SUCCESS!
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
        dispatchTx({ type: 'SET_LAST_TX_HASH', payload: permitDepositTxHash });
        dispatchPool({ type: 'SET_SUCCESS', payload: `Deposit successful (gasless)! Tx: ${permitDepositTxHash.slice(0, 10)}...` });
        dispatchTx({ type: 'SET_DEPOSIT_AMOUNT', payload: '' });
        dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        
        // Refresh pool data
        fetchPoolData(true);
        return; // Done with permit flow
        
      } catch (permitError: any) {
        // If it's an insufficient funds error, don't bother falling back — the wallet has no gas
        const code = permitError?.code || permitError?.info?.error?.code;
        const msg = permitError?.shortMessage || permitError?.message || '';
        if (code === 'INSUFFICIENT_FUNDS' || msg.includes('insufficient funds')) {
          dispatchPool({ type: 'SET_ERROR', payload: 'Insufficient ETH for gas. Please get Sepolia ETH from a faucet (e.g. Google Cloud faucet or Alchemy faucet).' });
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
          dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
          return;
        }
        console.error('🟠🟠🟠 PERMIT - Failed, falling back to approve+deposit', msg);
        // Fall through to regular approve+deposit flow
      }
    }
    
    // =========================================
    // FALLBACK: Regular Approve + Deposit (2 TXs)
    // Using async/await for reliable sequencing
    // =========================================
    console.error('🔴🔴🔴 DEPOSIT - Using regular approve+deposit flow');
    
    try {
      // Refetch current allowance
      await refetchAllowance();
      const allowance = currentAllowance ? BigInt(currentAllowance.toString()) : BigInt(0);
      const amountInUnits = parseUnits(amount.toString(), 6);
      console.error('🔴🔴🔴 DEPOSIT - Current allowance:', allowance.toString(), 'needed:', amountInUnits.toString());
      
      // STEP 1: Reset allowance if needed (USDT non-standard requirement)
      if (allowance > BigInt(0)) {
        logger.info('[CommunityPool] USDT: Resetting allowance to 0 first', { currentAllowance: allowance.toString() });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'resetting_approval' });
        console.error('🔴🔴🔴 DEPOSIT - Step 1: Resetting allowance to 0');
        
        const resetTxHash = await writeContractAsync({
          chainId: targetChainId,
          address: USDT_ADDRESS,
          abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
          functionName: 'approve',
          args: [COMMUNITY_POOL_ADDRESS, BigInt(0)],
        });
        
        console.error('🔴🔴🔴 DEPOSIT - Reset tx submitted:', resetTxHash);
        {
          const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrls[network]);
          await provider.waitForTransaction(resetTxHash, 1, 60000);
        }
        console.error('🔴🔴🔴 DEPOSIT - Reset confirmed!');
      }
      
      // STEP 2: Approve the deposit amount
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'approving' });
      console.error('🔴🔴🔴 DEPOSIT - Step 2: Approving', amountInUnits.toString());
      
      const approveTxHash = await writeContractAsync({
        chainId: targetChainId,
        address: USDT_ADDRESS,
        abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
        functionName: 'approve',
        args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
      });
      
      console.error('🔴🔴🔴 DEPOSIT - Approve tx submitted:', approveTxHash);
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'approved' });
      {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrls[network]);
        await provider.waitForTransaction(approveTxHash, 1, 60000);
      }
      console.error('🔴🔴🔴 DEPOSIT - Approve confirmed!');
      
      // STEP 3: Deposit to pool
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
      console.error('🔴🔴🔴 DEPOSIT - Step 3: Depositing', amountInUnits.toString());
      
      const depositTxHash = await writeContractAsync({
        chainId: targetChainId,
        address: COMMUNITY_POOL_ADDRESS,
        abi: [{ name: 'deposit', type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' }],
        functionName: 'deposit',
        args: [amountInUnits],
      });
      
      console.error('🔴🔴🔴 DEPOSIT - Deposit tx submitted:', depositTxHash);
      {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrls[network]);
        await provider.waitForTransaction(depositTxHash, 1, 60000);
      }
      console.error('🔴🔴🔴 DEPOSIT - Deposit confirmed!');
      
      // SUCCESS!
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
      dispatchTx({ type: 'SET_LAST_TX_HASH', payload: depositTxHash });
      dispatchPool({ type: 'SET_SUCCESS', payload: `Deposit successful! Tx: ${depositTxHash.slice(0, 10)}...` });
      dispatchTx({ type: 'SET_DEPOSIT_AMOUNT', payload: '' });
      dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
      
      // Refresh pool data
      fetchPoolData(true);
      
    } catch (err: any) {
      console.error('🔴🔴🔴 DEPOSIT - Error:', err);
      pendingDepositAmountRef.current = ''; // Clear on error
      // Detect insufficient ETH for gas and show helpful message
      const code = err?.code || err?.info?.error?.code;
      const msg = err?.shortMessage || err?.message || '';
      if (code === 'INSUFFICIENT_FUNDS' || msg.includes('insufficient funds')) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Insufficient ETH for gas. Please get Sepolia ETH from a faucet (e.g. Google Cloud faucet or Alchemy faucet).' });
      } else {
        dispatchPool({ type: 'SET_ERROR', payload: msg });
      }
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [isConnected, address, txState.depositAmount, selectedChain, chainId, chainConfig, network, poolDeployed, writeContractAsync, USDT_ADDRESS, COMMUNITY_POOL_ADDRESS, currentAllowance, refetchAllowance, isFirstDeposit, permitSupported, permitNonce, tokenName, signTypedDataAsync, switchChainAsync, fetchPoolData]);
  
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
      const targetChainId = validChainIds[0];
      console.log(`[CommunityPool] Withdraw chain mismatch - wallet chainId: ${chainId}, target: ${targetChainId}`);
      dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
      pendingChainSwitchRef.current = { action: 'withdraw', targetChainId };
      
      // Chain parameters for adding to wallet (same as deposit)
      const chainParams: Record<number, { chainId: string; chainName: string; rpcUrls: string[]; blockExplorerUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number } }> = {
        11155111: { // Sepolia
          chainId: '0xaa36a7',
          chainName: 'Sepolia',
          rpcUrls: ['https://sepolia.drpc.org', 'https://rpc.sepolia.org'],
          blockExplorerUrls: ['https://sepolia.etherscan.io'],
          nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        },
        338: { // Cronos Testnet
          chainId: '0x152',
          chainName: 'Cronos Testnet',
          rpcUrls: ['https://evm-t3.cronos.org'],
          blockExplorerUrls: ['https://explorer.cronos.org/testnet'],
          nativeCurrency: { name: 'Test Cronos', symbol: 'tCRO', decimals: 18 },
        },
        421614: { // Arbitrum Sepolia
          chainId: '0x66eee',
          chainName: 'Arbitrum Sepolia',
          rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
          blockExplorerUrls: ['https://sepolia.arbiscan.io'],
          nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
        },
      };
      
      // Try to add and switch chain using native wallet API
      const addAndSwitchChain = async () => {
        const ethereum = (window as any).ethereum;
        if (!ethereum) {
          throw new Error('No wallet detected');
        }
        
        const params = chainParams[targetChainId];
        if (!params) {
          throw new Error(`Chain ${targetChainId} not configured`);
        }
        
        try {
          // First try to just switch (chain might already be added)
          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: params.chainId }],
          });
        } catch (switchError: any) {
          // 4902 = Chain not added, try to add it
          if (switchError.code === 4902) {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [params],
            });
            // After adding, switch to it
            await ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: params.chainId }],
            });
          } else {
            throw switchError;
          }
        }
      };
      
      // Set a timeout to show manual switch message if wallet doesn't respond
      const timeoutId = setTimeout(() => {
        if (pendingChainSwitchRef.current?.action === 'withdraw') {
          console.log('[CommunityPool] Switch timeout - showing manual message');
          dispatchPool({ type: 'SET_ERROR', payload: `Please add ${chainConfig?.name} to your wallet and switch to it, then click Withdraw again.` });
          pendingChainSwitchRef.current = null;
        }
      }, 15000);
      
      console.log('[CommunityPool] Adding and switching chain for withdraw...');
      addAndSwitchChain()
        .then(() => {
          console.log('[CommunityPool] Chain switch successful for withdraw!');
          clearTimeout(timeoutId);
        })
        .catch((err: any) => {
          console.error('[CommunityPool] Chain switch failed:', err);
          clearTimeout(timeoutId);
          pendingChainSwitchRef.current = null;
          if (err?.code === 4001 || err?.message?.includes('rejected')) {
            dispatchPool({ type: 'SET_ERROR', payload: 'Chain switch rejected. Please add the chain manually in your wallet.' });
          } else {
            dispatchPool({ type: 'SET_ERROR', payload: `Please add ${chainConfig?.name} to your wallet and switch to it manually.` });
          }
        });
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
  }, [isConnected, address, txState.withdrawShares, selectedChain, chainId, chainConfig, network, poolDeployed, writeContract, COMMUNITY_POOL_ADDRESS]);
  
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
    console.error('🟢🟢🟢 AUTO-EXECUTE EFFECT - chainId changed to:', chainId);
    const pending = pendingChainSwitchRef.current;
    console.error('🟢🟢🟢 AUTO-EXECUTE EFFECT - pending action:', pending);
    if (!pending) return;
    if (!chainId) return;
    
    const { action, targetChainId } = pending;
    console.error('🟢🟢🟢 AUTO-EXECUTE EFFECT - comparing chainId:', chainId, 'with target:', targetChainId);
    
    // Execute only when we're on the target chain
    if (chainId === targetChainId) {
      // Clear pending action BEFORE executing to prevent re-triggering
      pendingChainSwitchRef.current = null;
      
      console.error('🟢🟢🟢 AUTO-EXECUTE EFFECT - MATCH! Executing:', action);
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
    
    // Determine active address based on wallet type
    // Priority: SUI (for sui chain) > EVM
    // Note: WDK treasury is server-side, users connect via WDK self-custodial wallet
    let activeAddress: string | null = null;
    let isActiveWalletConnected = false;
    
    if (isSui) {
      activeAddress = suiAddress;
      isActiveWalletConnected = suiIsConnected;
    } else {
      activeAddress = address ?? null;
      isActiveWalletConnected = isConnected;
    }
    
    return {
      address,
      isConnected,
      chainId,
      suiAddress,
      suiIsConnected,
      suiBalance,
      suiNetwork,
      suiIsWrongNetwork,
      activeWalletType,
      // Chain-aware helpers
      activeAddress,
      isActiveWalletConnected,
    };
  }, [address, isConnected, chainId, suiAddress, suiIsConnected, suiBalance, suiNetwork, suiIsWrongNetwork, selectedChain, activeWalletType]);
  
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
