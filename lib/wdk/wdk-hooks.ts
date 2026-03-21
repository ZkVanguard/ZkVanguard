/**
 * WDK Hooks
 * 
 * React hooks for Tether WDK wallet operations.
 * Provides useAccount, useChainId, useWriteContract,
 * useWaitForTransactionReceipt, useSignMessage, useSwitchChain, etc.
 */

'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useWdk, useWdkAccount, useWdkChain } from './wdk-context';
import { WDK_CHAINS } from '@/lib/config/wdk';
import { ethers } from 'ethers';

// ============================================
// CHAIN MAPPING
// ============================================

// Map chain IDs to WDK chain keys
const CHAIN_ID_TO_KEY: Record<number, string> = {
  11155111: 'sepolia',
  25: 'cronos-mainnet',
  338: 'cronos-testnet',
  42161: 'arbitrum-mainnet',
  421614: 'arbitrum-sepolia',
};

const CHAIN_KEY_TO_ID: Record<string, number> = {
  'sepolia': 11155111,
  'cronos-mainnet': 25,
  'cronos-testnet': 338,
  'arbitrum-mainnet': 42161,
  'arbitrum-sepolia': 421614,
};

// ============================================
// ACCOUNT HOOK
// ============================================

export interface UseAccountReturn {
  address: `0x${string}` | undefined;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnected: boolean;
  chain?: {
    id: number;
    name: string;
  };
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
}

export function useAccount(): UseAccountReturn {
  const { state } = useWdk();
  
  const chain = useMemo(() => {
    if (!state.chainKey) return undefined;
    const config = WDK_CHAINS[state.chainKey];
    return config ? { id: config.chainId, name: config.name } : undefined;
  }, [state.chainKey]);
  
  return {
    address: state.address as `0x${string}` | undefined,
    isConnected: state.isConnected,
    isConnecting: state.isLoading,
    isDisconnected: !state.isConnected && !state.isLoading,
    chain,
    status: state.isLoading 
      ? 'connecting' 
      : state.isConnected 
        ? 'connected' 
        : 'disconnected',
  };
}

// ============================================
// CHAIN ID HOOK
// ============================================

export function useChainId(): number {
  const { state } = useWdk();
  return state.chainId ?? 11155111; // Default to Sepolia
}

// ============================================
// SWITCH CHAIN HOOK
// ============================================

export interface UseSwitchChainReturn {
  switchChain: (args: { chainId: number }) => Promise<void>;
  switchChainAsync: (args: { chainId: number }) => Promise<boolean>;
  isPending: boolean;
  error: Error | null;
}

export function useSwitchChain(): UseSwitchChainReturn {
  const { switchChain: wdkSwitchChain } = useWdk();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const switchChainAsync = useCallback(async ({ chainId }: { chainId: number }) => {
    const chainKey = CHAIN_ID_TO_KEY[chainId];
    if (!chainKey) {
      setError(new Error(`Unsupported chain: ${chainId}`));
      return false;
    }
    
    setIsPending(true);
    setError(null);
    
    try {
      const success = await wdkSwitchChain(chainKey);
      if (!success) {
        setError(new Error('Failed to switch chain'));
      }
      return success;
    } catch (err) {
      setError(err as Error);
      return false;
    } finally {
      setIsPending(false);
    }
  }, [wdkSwitchChain]);
  
  const switchChain = useCallback(async ({ chainId }: { chainId: number }) => {
    await switchChainAsync({ chainId });
  }, [switchChainAsync]);
  
  return { switchChain, switchChainAsync, isPending, error };
}

// ============================================
// SIGN MESSAGE HOOK
// ============================================

export interface UseSignMessageReturn {
  signMessage: (args: { message: string }) => void;
  signMessageAsync: (args: { message: string }) => Promise<string>;
  data: string | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export function useSignMessage(): UseSignMessageReturn {
  const { signMessage: wdkSignMessage } = useWdk();
  const [data, setData] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const signMessageAsync = useCallback(async ({ message }: { message: string }) => {
    setIsPending(true);
    setError(null);
    setIsSuccess(false);
    
    try {
      const signature = await wdkSignMessage(message);
      if (!signature) {
        throw new Error('Failed to sign message');
      }
      setData(signature);
      setIsSuccess(true);
      return signature;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [wdkSignMessage]);
  
  const signMessage = useCallback(({ message }: { message: string }) => {
    signMessageAsync({ message }).catch(() => {});
  }, [signMessageAsync]);
  
  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);
  
  return { signMessage, signMessageAsync, data, isPending, isSuccess, error, reset };
}

// ============================================
// WRITE CONTRACT HOOK
// ============================================

export interface WriteContractArgs {
  address: `0x${string}`;
  abi: readonly any[];
  functionName: string;
  args?: any[];
  value?: bigint;
  chainId?: number;
  gas?: bigint;
}

export interface UseWriteContractReturn {
  writeContract: (args: WriteContractArgs) => void;
  writeContractAsync: (args: WriteContractArgs) => Promise<`0x${string}`>;
  data: `0x${string}` | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export function useWriteContract(): UseWriteContractReturn {
  const { state, sendTransaction } = useWdk();
  const [data, setData] = useState<`0x${string}` | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const writeContractAsync = useCallback(async (args: WriteContractArgs): Promise<`0x${string}`> => {
    if (!state.chainKey) {
      throw new Error('Wallet not connected');
    }
    
    setIsPending(true);
    setError(null);
    setIsSuccess(false);
    
    try {
      // Encode the function call
      const iface = new ethers.Interface(args.abi);
      const callData = iface.encodeFunctionData(args.functionName, args.args ?? []);
      
      // Send transaction via WDK (throws on failure with real error)
      const hash = await sendTransaction({
        to: args.address,
        data: callData,
        value: args.value,
      });
      
      if (!hash) {
        throw new Error('Wallet not connected or transaction cancelled');
      }
      
      setData(hash as `0x${string}`);
      setIsSuccess(true);
      return hash as `0x${string}`;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [state.chainKey, sendTransaction]);
  
  const writeContract = useCallback((args: WriteContractArgs) => {
    writeContractAsync(args).catch(() => {});
  }, [writeContractAsync]);
  
  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);
  
  return { writeContract, writeContractAsync, data, isPending, isSuccess, error, reset };
}

// ============================================
// WAIT FOR TRANSACTION HOOK
// ============================================

export interface UseWaitForTransactionReceiptReturn {
  data: any | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  error: Error | null;
}

export function useWaitForTransactionReceipt(args?: { hash?: `0x${string}` }): UseWaitForTransactionReceiptReturn {
  const { state } = useWdk();
  const [data, setData] = useState<any>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Watch for transaction confirmation
  useEffect(() => {
    if (!args?.hash || !state.chainKey) return;
    
    const chainConfig = WDK_CHAINS[state.chainKey];
    if (!chainConfig) return;
    
    const checkReceipt = async () => {
      setIsLoading(true);
      
      try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        const receipt = await provider.waitForTransaction(args.hash!, 1, 60000);
        
        if (receipt) {
          setData(receipt);
          setIsSuccess(receipt.status === 1);
        }
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
      }
    };
    
    checkReceipt();
  }, [args?.hash, state.chainKey]);
  
  return { data, isLoading, isSuccess, error };
}

// ============================================
// READ CONTRACT HOOK
// ============================================

export interface ReadContractArgs {
  address: `0x${string}`;
  abi: readonly any[];
  functionName: string;
  args?: any[];
  chainId?: number;
  enabled?: boolean;
  query?: { enabled?: boolean; refetchInterval?: number };
}

export function useReadContract<T = any>(args: ReadContractArgs): {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const { state } = useWdk();
  const [data, setData] = useState<T | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const chainKey = args.chainId 
    ? CHAIN_ID_TO_KEY[args.chainId] 
    : state.chainKey;

  // Accept `query` options inside args for backwards compatibility
  const legacyQuery = (args as any).query ?? {};
  const enabledFlag = args.enabled ?? legacyQuery.enabled ?? true;
  const refetchInterval = (args as any).refetchInterval ?? legacyQuery.refetchInterval;
  
  const refetch = useCallback(async () => {
    if (!chainKey) {
      setIsLoading(false);
      return;
    }

    if (enabledFlag === false) {
      setIsLoading(false);
      return;
    }
    
    const chainConfig = WDK_CHAINS[chainKey];
    if (!chainConfig) {
      setError(new Error(`Unknown chain: ${chainKey}`));
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      const contract = new ethers.Contract(args.address, args.abi, provider);
      const result = await contract[args.functionName](...(args.args ?? []));
      setData(result as T);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [chainKey, args.address, args.abi, args.functionName, args.args]);
  
  // Initial fetch — useEffect to avoid setState during render (hydration #301)
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Optional polling if refetchInterval supplied
  useEffect(() => {
    if (!refetchInterval || enabledFlag === false) return;
    const id = setInterval(() => {
      refetch().catch(() => {});
    }, refetchInterval);
    return () => clearInterval(id);
  }, [refetchInterval, enabledFlag, refetch]);
  
  const isError = error !== null;
  const isSuccess = data !== undefined && !isError;

  return { data, isLoading, isError, isSuccess, error, refetch };
}

// ============================================
// SIGN TYPED DATA HOOK
// ============================================

export function useSignTypedData() {
  const { signTypedData } = useWdk();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const signTypedDataAsync = useCallback(async (data: any) => {
    setIsPending(true);
    setError(null);
    
    try {
      // Use proper EIP-712 signing via ethers.js HDNodeWallet.signTypedData
      const { domain, types, message } = data;
      // ethers.js signTypedData does NOT want the EIP712Domain type in the types object
      const { EIP712Domain, ...signingTypes } = types;
      const signature = await signTypedData(domain, signingTypes, message);
      if (!signature) throw new Error('Failed to sign typed data');
      return signature;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [signTypedData]);
  
  return { signTypedDataAsync, isPending, error };
}

// ============================================
// PUBLIC CLIENT HOOK (for read operations)
// ============================================

export function usePublicClient(): any {
  const { state } = useWdk();
  
  return useMemo(() => {
    if (!state.chainKey) return null;
    const chainConfig = WDK_CHAINS[state.chainKey];
    if (!chainConfig) return null;
    
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    
    // Wrap ethers provider with viem-compatible method signatures
    return {
      _provider: provider,
      
      async getChainId(): Promise<number> {
        const network = await provider.getNetwork();
        return Number(network.chainId);
      },
      
      async getTransaction({ hash }: { hash: string }) {
        const tx = await provider.getTransaction(hash);
        if (!tx) return null;
        return {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value,
          data: tx.data,
          blockNumber: tx.blockNumber ? BigInt(tx.blockNumber) : null,
        };
      },
      
      async getTransactionReceipt({ hash }: { hash: string }) {
        const receipt = await provider.getTransactionReceipt(hash);
        if (!receipt) return null;
        return {
          status: receipt.status === 1 ? 'success' : 'reverted',
          to: receipt.to,
          from: receipt.from,
          blockNumber: BigInt(receipt.blockNumber),
          logs: receipt.logs.map(log => ({
            address: log.address,
            topics: log.topics as string[],
            data: log.data,
          })),
        };
      },
      
      async readContract({ address, abi, functionName, args }: {
        address: string; abi: any[]; functionName: string; args?: any[];
      }) {
        const contract = new ethers.Contract(address, abi, provider);
        return await contract[functionName](...(args || []));
      },
    };
  }, [state.chainKey]);
}

// ============================================
// WALLET CLIENT HOOK (for signing operations)
// ============================================

export function useWalletClient(): { data: any | null } {
  const { state, signMessage, sendTransaction } = useWdk();
  
  const data = useMemo(() => {
    if (!state.isConnected || !state.chainKey) return null;
    // Return a proxy object with signing capabilities
    return {
      signMessage,
      sendTransaction,
      account: { address: state.address },
    };
  }, [state.isConnected, state.chainKey, state.address, signMessage, sendTransaction]);
  
  return { data };
}

// ============================================
// BALANCE HOOK
// ============================================

export function useBalance(args?: { address?: `0x${string}`; chainId?: number }): {
  data: { value: bigint; formatted: string; symbol: string } | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const { state } = useWdk();
  const [data, setData] = useState<{ value: bigint; formatted: string; symbol: string } | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const address = args?.address ?? state.address as `0x${string}`;
  const chainKey = args?.chainId 
    ? CHAIN_ID_TO_KEY[args.chainId] 
    : state.chainKey;
  
  const refetch = useCallback(async () => {
    if (!address || !chainKey) {
      setIsLoading(false);
      return;
    }
    
    const chainConfig = WDK_CHAINS[chainKey];
    if (!chainConfig) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      const balance = await provider.getBalance(address);
      setData({
        value: balance,
        formatted: ethers.formatEther(balance),
        symbol: chainConfig.nativeCurrency.symbol,
      });
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [address, chainKey]);
  
  // Initial fetch — useEffect to avoid setState during render (hydration #301)
  useEffect(() => {
    refetch();
  }, [refetch]);
  
  return { data, isLoading, error, refetch };
}

// ============================================
// DISCONNECT HOOK
// ============================================

export function useDisconnect(): {
  disconnect: () => void;
  disconnectAsync: () => Promise<void>;
  isPending: boolean;
} {
  const { lockWallet } = useWdk();
  const [isPending, setIsPending] = useState(false);
  
  const disconnectAsync = useCallback(async () => {
    setIsPending(true);
    try {
      await lockWallet();
    } finally {
      setIsPending(false);
    }
  }, [lockWallet]);
  
  const disconnect = useCallback(() => {
    disconnectAsync().catch(() => {});
  }, [disconnectAsync]);
  
  return { disconnect, disconnectAsync, isPending };
}

// ============================================
// EXPORTS
// ============================================

export {
  useAccount as useWdkAccount,
  useChainId as useWdkChainId,
  useSwitchChain as useWdkSwitchChain,
  useSignMessage as useWdkSignMessage,
  useWriteContract as useWdkWriteContract,
  useWaitForTransactionReceipt as useWdkWaitForTransactionReceipt,
  useReadContract as useWdkReadContract,
  usePublicClient as useWdkPublicClient,
  useWalletClient as useWdkWalletClient,
  useBalance as useWdkBalance,
  useDisconnect as useWdkDisconnect,
};
