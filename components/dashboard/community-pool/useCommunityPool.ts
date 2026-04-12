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
import type { ChainKey, TxStatus } from './types';
import {
  type PoolAction, type TxAction,
  initialPoolState, initialTxState,
  poolReducer, txReducer,
} from './pool-reducers';
import { EVM_CHAIN_PARAMS, switchChainNative } from './chain-params';

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
  
  // Debug: Track transaction state changes (only log when values actually matter)
  useEffect(() => {
    if (txHash || isPending || isConfirming || txState.txStatus !== 'idle') {
      logger.debug('[TX STATE]', {
        txHash: txHash ? `${txHash.slice(0, 10)}...` : null,
        isPending,
        isConfirming,
        isConfirmed,
        txStatus: txState.txStatus,
        writeError: writeError?.message || null,
      });
    }
  }, [txHash, isPending, isConfirming, isConfirmed, txState.txStatus, writeError]);
  
  // SUI hooks
  const suiContext = useSuiSafe();
  const suiAddress = suiContext?.address ?? null;
  const suiIsConnected = suiContext?.isConnected ?? false;
  const suiBalance = suiContext?.balance ?? '0';
  const suiExecuteTransaction = suiContext?.executeTransaction;
  const suiSponsoredExecute = suiContext?.sponsoredExecute;
  const suiRequestFaucet = suiContext?.requestFaucetTokens;
  const suiNetwork = suiContext?.network ?? 'testnet';
  const suiIsWrongNetwork = suiContext?.isWrongNetwork ?? false;
  const suiSetNetwork = suiContext?.setNetwork;
  
  // WDK chain support check (treasury wallet is server-side)
  const wdkContext = useWdkSafe();
  const isWdkChainSupported = wdkContext?.isChainSupported;
  
  // Derived values
  const { selectedChain } = poolState;
  const chainConfig = POOL_CHAIN_CONFIGS[selectedChain];
  const isSuiChain = selectedChain === 'sui';
  const detectedNetwork: 'testnet' | 'mainnet' = isSuiChain
    ? (suiNetwork === 'mainnet' ? 'mainnet' : 'testnet')
    : (chainId ? getNetworkFromChainId(chainId) : 'testnet');
  const network: 'testnet' | 'mainnet' = isPoolDeployed(selectedChain, detectedNetwork) ? detectedNetwork : (isSuiChain ? (suiNetwork === 'mainnet' ? 'mainnet' : 'testnet') : 'testnet');
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
  // DEPRECATED HOOK: Replaced by imperative check in handleDeposit
  
  // User's USDT balance (show how much they can deposit) - keep this for UI
  const { data: userUsdtBalance } = useReadContract({
    address: USDT_ADDRESS,
    abi: [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    enabled: !!address && !!USDT_ADDRESS && selectedChain !== 'sui',
  });
  
  // Typed data signing hook for EIP-2612 permit
  const { signTypedDataAsync } = useSignTypedData();
  
  // Account Abstraction (Gasless) support - kept for future use
  // const { depositWithGasless } = useSmartAccount();
  
  // Pool total shares (to detect first deposit) - DEPRECATED HOOK, assume non-empty or check lazily
  // const { data: poolTotalShares } = useReadContract({...});
  
  // Derived: is first deposit (requires $100 minimum for inflation attack protection)
  // OPTIMIZATION: Assume false by default to speed up load. API enforces the rule anyway.
  const isFirstDeposit = false;
  
  // Helper to lazily fetch permit details only when needed
  const getPermitDetails = useCallback(async (tokenAddress: string, walletAddress: string, chainId: number) => {
    try {
      const chainConfig = POOL_CHAIN_CONFIGS[selectedChain];
      const rpcUrl = chainConfig?.rpcUrls[network] || 'https://sepolia.drpc.org';
      const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
      
      const erc20 = new ethers.Contract(tokenAddress, [
        'function nonces(address) view returns (uint256)',
        'function name() view returns (string)',
        'function DOMAIN_SEPARATOR() view returns (bytes32)',
      ], provider);
      
      const [nonce, name, domainSeparator] = await Promise.all([
        erc20.nonces(walletAddress).catch(() => null),
        erc20.name().catch(() => null),
        erc20.DOMAIN_SEPARATOR().catch(() => null),
      ]);
      
      return { 
        nonce: nonce ? BigInt(nonce) : undefined, 
        name, 
        domainSeparator,
        supported: !!nonce && !!domainSeparator 
      };
    } catch (e) {
      logger.warn('Failed to fetch permit details', e);
      return { supported: false };
    }
  }, [selectedChain, network]);
  
  // Helper to lazily fetch allowance
  const getAllowance = useCallback(async (tokenAddress: string, owner: string, spender: string) => {
    try {
      const chainConfig = POOL_CHAIN_CONFIGS[selectedChain];
      const rpcUrl = chainConfig?.rpcUrls[network] || 'https://sepolia.drpc.org';
      const targetChainId = getValidChainIds(selectedChain)[0];
      const provider = new ethers.JsonRpcProvider(rpcUrl, targetChainId, { staticNetwork: true });
      const erc20 = new ethers.Contract(tokenAddress, ['function allowance(address,address) view returns (uint256)'], provider);
      const allowance = await erc20.allowance(owner, spender);
      return BigInt(allowance);
    } catch (e) { 
      logger.warn('Failed to fetch allowance', e);
      return BigInt(0); 
    }
  }, [selectedChain, network]);
  
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
        // Fetch pool summary + allocation + user position (USDC-based from DB)
        const [poolRes, allocRes, userRes] = await Promise.all([
          fetch(`/api/sui/community-pool?network=${suiNetwork}`),
          fetch(`/api/sui/community-pool?action=allocation&network=${suiNetwork}`),
          userAddress ? fetch(`/api/sui/community-pool?action=user-position&wallet=${userAddress}&network=${suiNetwork}`) : null,
        ]);
        
        const [poolJson, allocJson, userJson] = await Promise.all([
          poolRes.json(),
          allocRes.json(),
          userRes ? userRes.json() : null,
        ]);
        
        if (!mountedRef.current) return;
        
        // Parse share price from pool data (available to both pool and user position blocks)
        const poolSharePrice = (poolJson.success && poolJson.data)
          ? (parseFloat(poolJson.data.sharePriceUsd) || (
              (parseFloat(poolJson.data.totalShares) || 0) > 0
                ? (parseFloat(poolJson.data.totalNAVUsd) || 0) / parseFloat(poolJson.data.totalShares)
                : 1.0
            ))
          : 1.0;
        
        if (poolJson.success) {
          if (poolJson.data.poolStateId) {
            dispatchPool({ type: 'SET_SUI_POOL_STATE_ID', payload: poolJson.data.poolStateId });
          }
          
          // Use USDC-denominated values (server provides share price)
          const totalShares = parseFloat(poolJson.data.totalShares) || 0;
          const totalValueUSD = parseFloat(poolJson.data.totalNAVUsd) || totalShares;
          
          // Get allocation from the allocation endpoint
          const alloc = allocJson?.success ? allocJson.data.allocation : { BTC: 30, ETH: 30, SUI: 25, CRO: 15 };
          
          dispatchPool({
            type: 'SET_POOL_DATA',
            payload: {
              totalShares,
              totalNAV: totalShares, // In USDC pool, NAV = total shares in USDC
              totalValueUSD,
              sharePrice: poolSharePrice,
              sharePriceUSD: poolSharePrice,
              memberCount: poolJson.data.memberCount || 0,
              allocations: alloc,
              aiLastUpdate: null,
              aiReasoning: null,
            },
          });
        }
        
        // User position from DB (USDC-denominated, synced with on-chain)
        if (userJson?.success && userJson.data) {
          const userData = userJson.data;
          const shares = Number(userData.shares) || 0;
          const totalShares = parseFloat(poolJson?.data?.totalShares) || 0;
          // Prefer server-computed percentage (validated against on-chain), fallback to local calc
          const percentage = userData.percentage != null
            ? Number(userData.percentage)
            : (totalShares > 0 && shares > 0 ? (shares / totalShares) * 100 : 0);
          
          dispatchPool({
            type: 'SET_USER_POSITION',
            payload: {
              walletAddress: userAddress || '',
              shares,
              valueUSD: Number(userData.valueUsdc) || (shares * poolSharePrice), // server value or compute from share price
              valueSUI: 0,
              percentage,
              isMember: userData.isMember || false,
              totalDeposited: Number(userData.costBasisUsd) || 0,
              totalWithdrawn: 0,
              depositCount: userData.depositCount || 0,
              withdrawalCount: userData.withdrawalCount || 0,
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
    
    const fetchWithTimeout = async (url: string, ms = 8000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), ms);
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return response;
      } catch (error) {
        clearTimeout(id);
        throw error;
      }
    };

    try {
      // Fetch pool and user data first (critical for UI)
      const [poolRes, userRes] = await Promise.all([
        fetchWithTimeout(`/api/community-pool?${chainParam.substring(1)}`),
        address ? fetchWithTimeout(`/api/community-pool?user=${address}${chainParam}`) : null,
      ]);
      
      const [poolJson, userJson] = await Promise.all([
        poolRes.json(),
        userRes ? userRes.json() : null,
      ]);
      
      if (!mountedRef.current) return;
      
      if (poolJson.success) {
        dispatchPool({ type: 'SET_POOL_DATA', payload: poolJson.pool });
      }
      if (userJson?.success) {
        dispatchPool({ type: 'SET_USER_POSITION', payload: userJson.user });
      }
      
      // Stop loading spinner as soon as critical data is ready
      dispatchPool({ type: 'SET_LOADING', payload: false });
      
      // Fetch leaderboard separately (non-blocking)
      // This heavy operation iterates all members on-chain
      fetch(`/api/community-pool?action=leaderboard&limit=5${chainParam}`)
        .then(res => res.json())
        .then(leaderJson => {
          if (mountedRef.current && leaderJson.success) {
            dispatchPool({ type: 'SET_LEADERBOARD', payload: leaderJson.leaderboard });
          }
        })
        .catch(err => logger.warn('[CommunityPool] Leaderboard fetch warning:', err));
        
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
        logger.info('[CommunityPool] Reset confirmed, scheduling approval', { targetChainId });
        
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
        logger.info('[CommunityPool] Approval confirmed, scheduling deposit', { targetChainId });
        
        setTimeout(() => {
          if (pendingDepositRef.current && COMMUNITY_POOL_ADDRESS) {
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
            const depositAmount = parseFloat(pendingDepositRef.current.amount);
            const amountInUnits = parseUnits(depositAmount.toString(), 6);
            
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
    
    // Check minimum deposit amount (first deposit requires $100 for inflation attack protection)
    const minDeposit = isFirstDeposit ? 100 : 10;
    if (isNaN(amount) || amount < minDeposit) {
      dispatchPool({ type: 'SET_ERROR', payload: `Minimum deposit is $${minDeposit}${isFirstDeposit ? ' (first deposit)' : ''}` });
      return;
    }
    
    const validChainIds = getValidChainIds(selectedChain);
    
    // Skip chain check if we just did a successful wallet switch (WDK lags behind native API)
    if (skipChainCheckRef.current) {
      logger.info('[CommunityPool] Chain check skipped (recent switch)', { chainId });
      skipChainCheckRef.current = false;
      // Fall through to actual deposit logic below
    } else if (!validChainIds.includes(chainId as number)) {
      const targetChainId = validChainIds[0];
      logger.info('[CommunityPool] Chain mismatch, initiating switch', { current: chainId, target: targetChainId });
      
      // Preserve the deposit amount in ref before chain switch (UI state may be lost during switch)
      pendingDepositAmountRef.current = txState.depositAmount;
      
      dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
      pendingChainSwitchRef.current = { action: 'deposit', targetChainId };
      
      // Use WDK switchChainAsync - this properly syncs state
      logger.info('[CommunityPool] Switching chain (WDK)', { targetChainId });
      
      // Set timeout for user feedback
      const timeoutId = setTimeout(() => {
        if (pendingChainSwitchRef.current?.action === 'deposit') {
          logger.debug('[CommunityPool] Switch timeout');
          dispatchPool({ type: 'SET_ERROR', payload: `Please switch to ${chainConfig?.name} in your wallet, then click Deposit again.` });
          pendingChainSwitchRef.current = null;
        }
      }, 20000);
      
      // Try WDK switchChainAsync (syncs state properly)
      switchChainAsync({ chainId: targetChainId })
        .then(() => {
          logger.info('[CommunityPool] Chain switch success (WDK)');
          clearTimeout(timeoutId);
          pendingChainSwitchRef.current = null;
          dispatchPool({ type: 'SET_ERROR', payload: null });
          
          // State is now synced, proceed immediately
          logger.info('[CommunityPool] Proceeding with deposit (synced)');
          setTimeout(() => {
            handleDeposit();
          }, 100);
        })
        .catch(async (switchError: any) => {
          logger.warn('[CommunityPool] WDK switch failed, trying native', { error: switchError?.message });
          
          try {
            await switchChainNative(targetChainId);
            logger.info('[CommunityPool] Native switch success');
            clearTimeout(timeoutId);
            skipChainCheckRef.current = true;
            pendingChainSwitchRef.current = null;
            dispatchPool({ type: 'SET_ERROR', payload: null });
            
            // Wait a bit longer for WDK to sync via chainChanged event
            setTimeout(() => {
              logger.info('[CommunityPool] Retrying deposit after native switch');
              handleDeposit();
            }, 1000);
          } catch (nativeError: any) {
            logger.error('[CommunityPool] Native switch failed', { code: nativeError?.code, message: nativeError?.message });
            clearTimeout(timeoutId);
            pendingChainSwitchRef.current = null;
            if (nativeError?.code === 4001 || nativeError?.message?.includes('rejected')) {
              dispatchPool({ type: 'SET_ERROR', payload: 'Chain switch rejected. Please switch manually.' });
            } else {
              dispatchPool({ type: 'SET_ERROR', payload: nativeError?.message || `Please add ${chainConfig?.name} to your wallet manually.` });
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
    logger.error('🔴🔴🔴 DEPOSIT - Proceeding with deposit', { 
      amount, 
      targetChainId, 
      wdkChainId: chainId, 
      USDT_ADDRESS, 
      COMMUNITY_POOL_ADDRESS,
      poolDeployed,
    });
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    
    const amountInUnits = parseUnits(amount.toString(), 6);
    
    // Single shared provider — staticNetwork skips eth_chainId auto-detection on every call
    const rpcUrl = chainConfig.rpcUrls[network] || 'https://sepolia.drpc.org';
    const txProvider = new ethers.JsonRpcProvider(rpcUrl, targetChainId, { staticNetwork: true });

    // =========================================
    // RECOVERY CHECK: Recover any orphaned USDT from interrupted deposits
    // =========================================
    try {
      const recoverResp = await fetch('/api/community-pool/deposit-usdt?action=recover-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address, chainId: targetChainId }),
      });
      const recoverResult = await recoverResp.json();
      if (recoverResult.recovered) {
        logger.info('[CommunityPool] Recovered orphaned USDT from previous failed deposit', {
          amount: recoverResult.orphanedAmount,
          txHash: recoverResult.refundTxHash,
        });
        dispatchPool({ type: 'SET_SUCCESS', payload: `Recovered ${recoverResult.orphanedAmount} USDT from a previous interrupted deposit. You can now retry.` });
      }
    } catch {
      // Non-fatal — recovery is best-effort
    }

    // =========================================
    // PARALLEL STEP: Balance + Oracle + Gas + Permit details (all independent)
    // =========================================
    // Fire all checks simultaneously instead of sequentially
    const usdt = new ethers.Contract(USDT_ADDRESS, ['function balanceOf(address) view returns (uint256)'], txProvider);
    
    const [balanceResult, gasResult, oracleResult, permitResult] = await Promise.allSettled([
      // Balance check
      usdt.balanceOf(address),
      // Gas balance check
      txProvider.getBalance(address as string),
      // Oracle price update (fire early, non-blocking for deposit)
      fetch('/api/community-pool/deposit-usdt?action=update-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId: targetChainId }),
      }).then(r => r.json()).catch(() => ({ success: false })),
      // Permit details
      getPermitDetails(USDT_ADDRESS, address, targetChainId),
    ]);
    
    // Check USDT balance (fail fast)
    if (balanceResult.status === 'fulfilled') {
      const usdtBalance = balanceResult.value;
      logger.info('[CommunityPool] USDT balance check', { balance: usdtBalance.toString(), needed: amountInUnits.toString() });
      if (BigInt(usdtBalance) < BigInt(amountInUnits)) {
        const balFormatted = (Number(usdtBalance) / 1e6).toFixed(2);
        dispatchPool({ type: 'SET_ERROR', payload: `Insufficient USDT balance. You have ${balFormatted} USDT but need ${amount} USDT.` });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        return;
      }
    }
    
    // Log oracle result (non-fatal)
    if (oracleResult.status === 'fulfilled' && oracleResult.value?.success) {
      logger.info('[CommunityPool] Oracle prices updated', { txHash: oracleResult.value.txHash });
    } else {
      logger.info('[CommunityPool] Oracle update skipped or failed (non-fatal)');
    }
    
    // =========================================
    // GAS FUNDING (only if needed)
    // =========================================
    try {
      const ethBalance = gasResult.status === 'fulfilled' ? gasResult.value : await txProvider.getBalance(address as string);
      const minGas = ethers.parseEther('0.001');
      
      if (ethBalance < minGas) {
        logger.info('[CommunityPool] Insufficient ETH for gas, requesting funding...', { balance: ethers.formatEther(ethBalance) });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'signing_permit' }); // "Preparing..."
        
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
          logger.error('[CommunityPool] Gas funding failed', { error: fundResult.error });
          dispatchPool({ type: 'SET_ERROR', payload: fundResult.error || 'Failed to obtain gas funding. Please get Sepolia ETH from a faucet.' });
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
          dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
          return;
        }
        
        if (fundResult.funded && fundResult.txHash) {
          logger.info('[CommunityPool] Gas funded, waiting for confirmation...', { txHash: fundResult.txHash });
          // Wait until the ETH actually appears in the wallet (poll up to 5s)
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 500));
            const newBalance = await txProvider.getBalance(address as string);
            if (newBalance >= minGas) {
              logger.info('[CommunityPool] Gas funding confirmed in wallet', { balance: ethers.formatEther(newBalance) });
              break;
            }
          }
        } else {
          logger.info('[CommunityPool] Gas already sufficient', { message: fundResult.message });
        }
      }
    } catch (fundErr: any) {
      logger.warn('[CommunityPool] Gas funding check failed, proceeding anyway', { error: fundErr.message });
    }
    
    // =========================================
    // STEP 2: TRY PROXY DEPOSIT VIA PERMIT (Privacy-preserving!)
    // =========================================
    // User signs a permit granting the server wallet USDT allowance.
    // Server relays deposit through a proxy wallet address so the
    // user's real address never appears on-chain as a pool member.
    // Falls back to direct deposit if proxy flow fails.
    let permitAttempted = false;
    
    // Server relayer wallet address (deposits on behalf of proxy)
    // NOTE: This is ALWAYS the same testnet server wallet until mainnet launch
    // After mainnet, this should be read from env: process.env.NEXT_PUBLIC_SERVER_WALLET_ADDRESS
    const SERVER_WALLET = (process.env.NEXT_PUBLIC_SERVER_WALLET_ADDRESS || '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c') as `0x${string}`;
    
    // Use permit details from parallel fetch above
    const permitDetails = permitResult.status === 'fulfilled' ? permitResult.value : { supported: false };
    logger.info('[CommunityPool] Permit details', { supported: permitDetails.supported, hasNonce: !!permitDetails.nonce, hasName: !!permitDetails.name });

    const { supported: permitSupported, nonce: permitNonce, name: tokenName, domainSeparator: domainSep } = permitDetails;

    if (permitSupported && permitNonce !== undefined && tokenName && signTypedDataAsync && domainSep) {
      logger.info('[CommunityPool] Using proxy deposit via permit (privacy mode)');
      permitAttempted = true;
      
      try {
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'signing_permit' });
        
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour
        const nonce = BigInt(permitNonce.toString());
        
        // EIP-712 Permit typed data — spender is SERVER WALLET (not pool!)
        // Server will transfer USDT from user, then depositFor(proxy, amount)
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
          spender: SERVER_WALLET,
          value: amountInUnits,
          nonce: nonce,
          deadline: deadline,
        };
        
        logger.info('[CommunityPool] Requesting permit signature for proxy deposit...');
        
        // Sign the permit (gasless - just a signature!)
        const signature = await signTypedDataAsync({
          domain,
          types,
          primaryType: 'Permit',
          message,
        });

        if (!signature) throw new Error('Failed to obtain signature');

        logger.info('[CommunityPool] Permit signature obtained, sending to proxy deposit API...');
        
        // Parse signature into v, r, s
        const r = signature.slice(0, 66) as `0x${string}`;
        const s = ('0x' + signature.slice(66, 130)) as `0x${string}`;
        const v = parseInt(signature.slice(130, 132), 16);
        
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
        
        // Call proxy deposit API — server handles everything
        const proxyResp = await fetch('/api/community-pool/deposit-usdt?action=deposit-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: address,
            chainId: targetChainId,
            amount: amount,
            permit: {
              deadline: deadline.toString(),
              v,
              r,
              s,
            },
          }),
        });
        
        const proxyResult = await proxyResp.json();
        
        if (!proxyResp.ok || !proxyResult.success) {
          throw new Error(proxyResult.error || 'Proxy deposit failed');
        }
        
        logger.info('[CommunityPool] Proxy deposit confirmed!', { 
          txHash: proxyResult.txHash, 
          proxyAddress: proxyResult.proxyAddress,
        });
        
        // SUCCESS!
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
        dispatchTx({ type: 'SET_LAST_TX_HASH', payload: proxyResult.txHash });
        dispatchPool({ type: 'SET_SUCCESS', payload: `Deposit successful via treasury proxy! Your real address is protected. Tx: ${proxyResult.txHash.slice(0, 10)}...` });
        dispatchTx({ type: 'SET_DEPOSIT_AMOUNT', payload: '' });
        dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        
        // Refresh pool data
        fetchPoolData(true);
        return; // Done!
        
      } catch (permitError: any) {
        const code = permitError?.code || permitError?.info?.error?.code;
        const msg = permitError?.shortMessage || permitError?.message || '';
        
        // User rejected — stop entirely
        if (code === 4001 || msg.includes('User rejected') || msg.includes('user rejected') || msg.includes('denied')) {
          dispatchPool({ type: 'SET_ERROR', payload: 'Transaction cancelled by user.' });
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
          dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
          return;
        }
        
        // Insufficient ETH — stop with helpful message
        if (code === 'INSUFFICIENT_FUNDS' || msg.includes('insufficient funds')) {
          dispatchPool({ type: 'SET_ERROR', payload: 'Insufficient ETH for gas. Please get Sepolia ETH from a faucet.' });
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
          dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
          return;
        }
        
        logger.warn('[CommunityPool] Permit flow failed, falling back to approve+deposit', { error: msg });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' }); // Reset for fallback
      }
    } else {
      logger.info('[CommunityPool] Permit not available, using approve+deposit', {
        supported: permitSupported,
        hasNonce: permitNonce !== undefined,
        hasName: !!tokenName,
        hasSigner: !!signTypedDataAsync,
        hasDomainSep: !!domainSep,
      });
    }
    
    // =========================================
    // STEP 3: FALLBACK - Approve + Deposit (2 TXs)
    // =========================================
    logger.info('[CommunityPool] Using standard Approve+Deposit flow');
    
    try {
      // Refetch current allowance
      const currentAllowance = await getAllowance(USDT_ADDRESS, address, COMMUNITY_POOL_ADDRESS);
      const allowance = BigInt(currentAllowance.toString());
      logger.info('[CommunityPool] Current allowance', { allowance: allowance.toString(), needed: amountInUnits.toString() });
      
      // STEP 3a: Reset allowance if needed (USDT non-standard requirement)
      if (allowance > BigInt(0) && allowance < BigInt(amountInUnits)) {
        logger.info('[CommunityPool] Resetting USDT allowance to 0 first');
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'resetting_approval' });
        
        const resetTxHash = await writeContractAsync({
          chainId: targetChainId,
          address: USDT_ADDRESS,
          abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
          functionName: 'approve',
          args: [COMMUNITY_POOL_ADDRESS, BigInt(0)],
        });
        
        logger.info('[CommunityPool] Reset tx submitted', { txHash: resetTxHash });
        await txProvider.waitForTransaction(resetTxHash, 1, 90000);
        logger.info('[CommunityPool] Reset confirmed');
      }
      
      // STEP 3b: Approve the deposit amount
      if (allowance < BigInt(amountInUnits)) {
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'approving' });
        logger.info('[CommunityPool] Approving USDT spend', { amount: amountInUnits.toString() });
        
        const approveTxHash = await writeContractAsync({
          chainId: targetChainId,
          address: USDT_ADDRESS,
          abi: [{ name: 'approve', type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
          functionName: 'approve',
          args: [COMMUNITY_POOL_ADDRESS, amountInUnits],
        });
        
        logger.info('[CommunityPool] Approve tx submitted', { txHash: approveTxHash });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'approved' });
        await txProvider.waitForTransaction(approveTxHash, 1, 90000);
        logger.info('[CommunityPool] Approve confirmed');
        
        // Verify allowance was actually set (belt and suspenders)
        const verifiedAllowance = await getAllowance(USDT_ADDRESS, address, COMMUNITY_POOL_ADDRESS);
        logger.info('[CommunityPool] Verified allowance after approve', { allowance: verifiedAllowance.toString() });
        if (BigInt(verifiedAllowance.toString()) < BigInt(amountInUnits)) {
          throw new Error(`Approval succeeded but allowance is still insufficient (${verifiedAllowance.toString()}). Please try again.`);
        }
      } else {
         logger.info('[CommunityPool] Allowance already sufficient, skipping approve');
      }
      
      // STEP 3c: Deposit to pool
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
      logger.info('[CommunityPool] Depositing tokens', { amount: amountInUnits.toString() });
      
      const depositTxHash = await writeContractAsync({
        chainId: targetChainId,
        address: COMMUNITY_POOL_ADDRESS,
        abi: [{ name: 'deposit', type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' }],
        functionName: 'deposit',
        args: [amountInUnits],
      });
      
      logger.info('[CommunityPool] Deposit tx submitted', { txHash: depositTxHash });
      await txProvider.waitForTransaction(depositTxHash, 1, 90000);
      logger.info('[CommunityPool] Deposit confirmed!');
      
      // SUCCESS!
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
      dispatchTx({ type: 'SET_LAST_TX_HASH', payload: depositTxHash });
      dispatchPool({ type: 'SET_SUCCESS', payload: `Deposit successful! Tx: ${depositTxHash.slice(0, 10)}...` });
      dispatchTx({ type: 'SET_DEPOSIT_AMOUNT', payload: '' });
      dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
      
      // Refresh pool data
      fetchPoolData(true);
      
    } catch (err: any) {
      logger.error('[CommunityPool] Deposit failed:', err);
      pendingDepositAmountRef.current = '';
      const code = err?.code || err?.info?.error?.code;
      const msg = err?.shortMessage || err?.message || '';
      
      if (code === 4001 || msg.includes('User rejected') || msg.includes('user rejected') || msg.includes('denied')) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Transaction cancelled by user.' });
      } else if (code === 'INSUFFICIENT_FUNDS' || msg.includes('insufficient funds')) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Insufficient ETH for gas. Please get Sepolia ETH from a faucet.' });
      } else if (msg.includes('execution reverted')) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Transaction reverted on-chain. The contract rejected the deposit. Please check your USDT balance and try again.' });
      } else {
        dispatchPool({ type: 'SET_ERROR', payload: msg || 'Deposit failed. Please try again.' });
      }
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [isConnected, address, txState.depositAmount, selectedChain, chainId, chainConfig, network, poolDeployed, writeContractAsync, USDT_ADDRESS, COMMUNITY_POOL_ADDRESS, isFirstDeposit, signTypedDataAsync, switchChainAsync, fetchPoolData]);
  
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
      logger.debug(`[CommunityPool] Withdraw chain mismatch - wallet chainId: ${chainId}, target: ${targetChainId}`);
      dispatchPool({ type: 'SET_ERROR', payload: `Switching to ${chainConfig?.name}...` });
      pendingChainSwitchRef.current = { action: 'withdraw', targetChainId };
      
      // Set a timeout to show manual switch message if wallet doesn't respond
      const timeoutId = setTimeout(() => {
        if (pendingChainSwitchRef.current?.action === 'withdraw') {
          logger.debug('[CommunityPool] Switch timeout - showing manual message');
          dispatchPool({ type: 'SET_ERROR', payload: `Please add ${chainConfig?.name} to your wallet and switch to it, then click Withdraw again.` });
          pendingChainSwitchRef.current = null;
        }
      }, 15000);
      
      logger.debug('[CommunityPool] Switching chain for withdraw...');
      switchChainNative(targetChainId)
        .then(() => {
          logger.debug('[CommunityPool] Chain switch successful for withdraw!');
          clearTimeout(timeoutId);
        })
        .catch((err: any) => {
          logger.error('[CommunityPool] Chain switch failed:', err);
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
  
  // SUI handlers - On-chain USDC deposit via wallet signing
  // Both mainnet and testnet use community_pool_usdc::deposit with Coin<USDC>, 6 decimals
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
    
    const depositAmount = parseFloat(txState.suiDepositAmount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Invalid deposit amount' });
      return;
    }

    if (depositAmount < 10) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Minimum deposit is $10 USDC' });
      return;
    }

    const isMainnet = suiNetwork === 'mainnet';

    // USDC contract config — both networks use community_pool_usdc module
    const packageId = (isMainnet
      ? (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID || process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || '')
      : (process.env.NEXT_PUBLIC_SUI_USDC_POOL_PACKAGE_ID || '')).trim();
    const poolStateId = (isMainnet
      ? (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE || '')
      : (process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET || process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE || '')).trim();
    const usdcCoinType = isMainnet
      ? '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
      : '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
    
    if (!packageId || !poolStateId) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Pool contract not configured. Please try again later.' });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    dispatchTx({ type: 'SET_TX_STATUS', payload: 'depositing' });
    
    try {
      const rpcUrl = isMainnet
        ? 'https://fullnode.mainnet.sui.io:443'
        : 'https://fullnode.testnet.sui.io:443';
      
      // Check SUI gas balance
      const gasBalRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'suix_getBalance',
          params: [suiAddress, '0x2::sui::SUI'],
        }),
      });
      const gasBalJson = await gasBalRes.json();
      const suiGasBalance = BigInt(gasBalJson.result?.totalBalance || '0');
      
      const needsSponsoring = suiGasBalance < BigInt(10_000_000);
      if (needsSponsoring) {
        if (!isMainnet && suiRequestFaucet) {
          dispatchPool({ type: 'SET_ERROR', payload: 'No SUI for gas fees. Requesting testnet SUI from faucet...' });
          const faucetRes = await suiRequestFaucet();
          if (!faucetRes.success) {
            dispatchPool({ type: 'SET_ERROR', payload: `No SUI for gas fees. Faucet failed: ${faucetRes.message}. Visit https://faucet.testnet.sui.io` });
            dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
            return;
          }
          dispatchPool({ type: 'SET_ERROR', payload: 'Faucet SUI requested! Waiting for it to arrive...' });
          await new Promise(r => setTimeout(r, 3000));
          dispatchPool({ type: 'SET_ERROR', payload: null });
        } else if (!isMainnet || !suiSponsoredExecute) {
          const currentSui = (Number(suiGasBalance) / 1e9).toFixed(4);
          dispatchPool({ type: 'SET_ERROR', payload: `Insufficient SUI for gas (have ${currentSui} SUI, need ~0.01). Send a small amount of SUI to this wallet for transaction fees.` });
          dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
          return;
        }
        // On mainnet with sponsoring available — continue, will use sponsored execute below
      }
      
      const amountMicroUsdc = Math.round(depositAmount * 1_000_000);
      
      // Fetch USDC coins
      const usdcCoinsRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2,
          method: 'suix_getCoins',
          params: [suiAddress, usdcCoinType, null, 50],
        }),
      });
      const coinsJson = await usdcCoinsRes.json();
      const coins: Array<{ coinObjectId: string; balance: string }> = coinsJson.result?.data || [];
      
      if (coins.length === 0) {
        dispatchPool({ type: 'SET_ERROR', payload: 'No USDC found in your wallet. You need USDC on SUI to deposit.' });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      const totalBalance = coins.reduce((sum, c) => sum + BigInt(c.balance), BigInt(0));
      if (totalBalance < BigInt(amountMicroUsdc)) {
        dispatchPool({ type: 'SET_ERROR', payload: `Insufficient USDC. You have ${(Number(totalBalance) / 1e6).toFixed(2)} USDC.` });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      const { Transaction } = await import('@mysten/sui/transactions');
      const tx = new Transaction();
      const primaryCoinRef = tx.object(coins[0].coinObjectId);
      if (coins.length > 1) {
        tx.mergeCoins(primaryCoinRef, coins.slice(1).map(c => tx.object(c.coinObjectId)));
      }
      const [depositCoin] = tx.splitCoins(primaryCoinRef, [amountMicroUsdc]);
      
      tx.moveCall({
        target: `${packageId}::community_pool_usdc::deposit`,
        typeArguments: [usdcCoinType],
        arguments: [
          tx.object(poolStateId),
          depositCoin,
          tx.object('0x6'),
        ],
      });
      
      // Use sponsored execute (admin pays gas) when user has insufficient SUI on mainnet
      const executeFn = (needsSponsoring && isMainnet && suiSponsoredExecute)
        ? suiSponsoredExecute
        : suiExecuteTransaction;
      const result = await executeFn(tx);
      
      if (!result.success) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Transaction rejected or failed. Please try again.' });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      const recordRes = await fetch(`/api/sui/community-pool?action=record-deposit&network=${suiNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: suiAddress,
          amountUsdc: depositAmount,
          allocations: { BTC: 30, ETH: 30, SUI: 25, CRO: 15 },
          txDigest: result.digest,
        }),
      });
      const recordJson = await recordRes.json();
      
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
      dispatchTx({ type: 'SET_LAST_TX_HASH', payload: result.digest });
      const sharesMsg = recordJson.success && recordJson.data
        ? `${recordJson.data.sharesMinted} shares minted`
        : 'shares minted on-chain';
      dispatchPool({ type: 'SET_SUCCESS', payload: `Deposited $${depositAmount.toFixed(2)} USDC! ${sharesMsg}. TX: ${result.digest.slice(0, 12)}...` });

      dispatchTx({ type: 'SET_SUI_DEPOSIT_AMOUNT', payload: '' });
      dispatchTx({ type: 'SET_SHOW_DEPOSIT', payload: false });
      
      setTimeout(() => {
        fetchPoolData(true);
        dispatchPool({ type: 'SET_SUCCESS', payload: null });
      }, 3000);
    } catch (err: any) {
      logger.error('SUI deposit error', err);
      dispatchPool({ type: 'SET_ERROR', payload: err.message || 'Deposit failed' });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    }
  }, [suiIsConnected, suiAddress, suiExecuteTransaction, suiSponsoredExecute, txState.suiDepositAmount, suiNetwork, fetchPoolData]);
  
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
    
    const userAvailableShares = poolState.userPosition?.shares || 0;
    if (shares > userAvailableShares) {
      dispatchPool({ type: 'SET_ERROR', payload: `Insufficient shares. You have ${userAvailableShares.toFixed(2)} shares.` });
      return;
    }

    const isMainnet = suiNetwork === 'mainnet';

    // Both networks use USDC pool — shares use 6 decimals (matching USDC)
    const sharesOnChain = Math.round(shares * 1_000_000);
    
    const packageId = (isMainnet
      ? (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID || process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || '')
      : (process.env.NEXT_PUBLIC_SUI_USDC_POOL_PACKAGE_ID || '')).trim();
    const poolStateId = (isMainnet
      ? (process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE || '')
      : (process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET || process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE || '0x9f77819f91d75833f86259025068da493bb1c7215ed84f39d5ad0f5bc1b40971')).trim();
    const usdcCoinType = isMainnet
      ? '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
      : '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
    
    if (!packageId || !poolStateId) {
      dispatchPool({ type: 'SET_ERROR', payload: 'Pool contract not configured. Please try again later.' });
      return;
    }
    
    dispatchTx({ type: 'SET_ACTION_LOADING', payload: true });
    dispatchTx({ type: 'SET_TX_STATUS', payload: 'withdrawing' });
    
    try {
      const rpcUrl = isMainnet
        ? 'https://fullnode.mainnet.sui.io:443'
        : 'https://fullnode.testnet.sui.io:443';
      
      // Check SUI gas balance
      const gasBalRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'suix_getBalance',
          params: [suiAddress, '0x2::sui::SUI'],
        }),
      });
      const gasBalJson = await gasBalRes.json();
      const suiGasBalance = BigInt(gasBalJson.result?.totalBalance || '0');
      
      const needsSponsoring = suiGasBalance < BigInt(10_000_000);
      if (needsSponsoring) {
        if (!isMainnet && suiRequestFaucet) {
          dispatchPool({ type: 'SET_ERROR', payload: 'No SUI for gas fees. Requesting testnet SUI from faucet...' });
          const faucetRes = await suiRequestFaucet();
          if (!faucetRes.success) {
            dispatchPool({ type: 'SET_ERROR', payload: `No SUI for gas fees. Faucet failed: ${faucetRes.message}. Visit https://faucet.testnet.sui.io` });
            dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
            dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
            return;
          }
          dispatchPool({ type: 'SET_ERROR', payload: 'Faucet SUI requested! Waiting for it to arrive...' });
          await new Promise(r => setTimeout(r, 3000));
          dispatchPool({ type: 'SET_ERROR', payload: null });
        } else if (!isMainnet || !suiSponsoredExecute) {
          const currentSui = (Number(suiGasBalance) / 1e9).toFixed(4);
          dispatchPool({ type: 'SET_ERROR', payload: `Insufficient SUI for gas (have ${currentSui} SUI, need ~0.01). Send a small amount of SUI to this wallet for transaction fees.` });
          dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
          dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
          return;
        }
      }
      
      const { Transaction } = await import('@mysten/sui/transactions');
      const tx = new Transaction();
      
      // Both networks use community_pool_usdc::withdraw
      tx.moveCall({
        target: `${packageId}::community_pool_usdc::withdraw`,
        typeArguments: [usdcCoinType],
        arguments: [
          tx.object(poolStateId),
          tx.pure.u64(sharesOnChain as number),
          tx.object('0x6'),
        ],
      });
      
      // Use sponsored execute (admin pays gas) when user has insufficient SUI on mainnet
      const executeFn = (needsSponsoring && isMainnet && suiSponsoredExecute)
        ? suiSponsoredExecute
        : suiExecuteTransaction;
      const result = await executeFn(tx);
      
      if (!result.success) {
        dispatchPool({ type: 'SET_ERROR', payload: 'Transaction rejected or failed. Please try again.' });
        dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
        dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
        return;
      }
      
      // Record withdrawal in backend DB
      try {
        const recordRes = await fetch(`/api/sui/community-pool?action=record-withdraw&network=${suiNetwork}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: suiAddress,
            sharesToBurn: shares,
            txDigest: result.digest,
          }),
        });
        if (!recordRes.ok) {
          logger.warn('Failed to record withdrawal in DB', { status: recordRes.status });
        }
      } catch (recordErr) {
        logger.warn('Withdrawal DB record failed (on-chain tx succeeded)', { error: recordErr });
      }
      
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'complete' });
      dispatchTx({ type: 'SET_LAST_TX_HASH', payload: result.digest });
      const withdrawLabel = `~$${shares.toFixed(2)} USDC`;
      dispatchPool({ type: 'SET_SUCCESS', payload: `Withdrew ${withdrawLabel}! TX: ${result.digest.slice(0, 12)}...` });
      dispatchTx({ type: 'SET_SUI_WITHDRAW_SHARES', payload: '' });
      dispatchTx({ type: 'SET_SHOW_WITHDRAW', payload: false });
      
      setTimeout(() => {
        fetchPoolData(true);
        dispatchPool({ type: 'SET_SUCCESS', payload: null });
      }, 3000);
    } catch (err: any) {
      logger.error('SUI withdraw error', err);
      dispatchPool({ type: 'SET_ERROR', payload: err.message || 'Withdrawal failed' });
    } finally {
      dispatchTx({ type: 'SET_ACTION_LOADING', payload: false });
      dispatchTx({ type: 'SET_TX_STATUS', payload: 'idle' });
    }
  }, [suiIsConnected, suiAddress, suiExecuteTransaction, suiSponsoredExecute, txState.suiWithdrawShares, suiNetwork, fetchPoolData]);
  
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
      
      logger.info(`[CommunityPool] Chain match! Auto-executing: ${action}, chainId: ${chainId}`);
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
    txHash,
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
    txHash,
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
