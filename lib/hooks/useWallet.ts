'use client';

import { useAccount } from 'wagmi';
import { useSui } from '@/app/sui-providers';

/**
 * Unified wallet hook that works with both EVM (Cronos) and SUI wallets.
 * Use this hook instead of wagmi's useAccount when you need to support both chains.
 * 
 * Priority: SUI wallet takes precedence if connected, otherwise falls back to EVM.
 */
export function useWallet() {
  // EVM wallet state
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  
  // SUI wallet state (safely handle if not in provider)
  let suiAddress: string | null = null;
  let suiConnected = false;
  let suiBalance = '0';
  let suiNetwork = 'testnet';
  
  try {
    const sui = useSui();
    suiAddress = sui.address;
    suiConnected = sui.isConnected;
    suiBalance = sui.balance;
    suiNetwork = sui.network;
  } catch {
    // useSui not available - SUI wallet not in provider tree
  }
  
  // Combined state - SUI takes priority if connected
  const isConnected = suiConnected || evmConnected;
  const address = suiConnected ? suiAddress : (evmAddress ? evmAddress.toString() : null);
  const chainType = suiConnected ? 'sui' : (evmConnected ? 'evm' : null);
  
  return {
    // Combined state
    address,
    isConnected,
    chainType,
    
    // Individual chain states
    evmAddress: evmAddress ? evmAddress.toString() : null,
    evmConnected,
    suiAddress,
    suiConnected,
    suiBalance,
    suiNetwork,
    
    // Helpers
    isEVM: evmConnected && !suiConnected,
    isSUI: suiConnected,
  };
}

/**
 * Type for the useWallet hook return value
 */
export type WalletState = ReturnType<typeof useWallet>;
