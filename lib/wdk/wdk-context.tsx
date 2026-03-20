/**
 * WDK Wallet Context (Browser-Safe)
 * 
 * SECURITY: This provider does NOT handle native WDK bindings in the browser.
 * The actual @tetherto/wdk-wallet-evm package uses sodium-native which
 * requires native Node.js bindings that can't be bundled for Vercel/browser.
 * 
 * All sensitive WDK operations are handled server-side via:
 * - GET /api/community-pool/treasury/status (treasury wallet status)
 * - POST /api/community-pool/treasury/transfer (execute transfers)
 * 
 * This module provides the same API surface as the full implementation
 * (wdk-context-native.tsx) so all consumer imports work unchanged.
 * 
 * @see https://docs.wdk.tether.io/
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { WDK_CHAINS } from '@/lib/config/wdk';

// ============================================
// TYPES (same exports as native context)
// ============================================

export interface WdkAccount {
  address: string;
  chainKey: string;
  chainId: number;
}

export interface WdkWalletState {
  isConnected: boolean;
  isLoading: boolean;
  address: string | null;
  chainId: number | null;
  chainKey: string | null;
  accounts: WdkAccount[];
  error: string | null;
}

export interface WdkTransactionRequest {
  to: string;
  value?: bigint;
  data?: string;
}

export interface WdkContextValue {
  // State
  state: WdkWalletState;
  
  // Wallet Management
  createWallet: () => Promise<string | null>;
  importWallet: (mnemonic: string) => Promise<boolean>;
  lockWallet: () => void;
  unlockWallet: (password: string) => Promise<boolean>;
  disconnect: () => void;
  
  // Chain Operations
  switchChain: (chainKey: string) => Promise<boolean>;
  getBalance: (chainKey?: string) => Promise<string>;
  getUsdtBalance: (chainKey?: string) => Promise<string>;
  
  // Transaction Operations
  sendTransaction: (tx: WdkTransactionRequest) => Promise<string | null>;
  sendUsdt: (to: string, amount: string) => Promise<string | null>;
  signMessage: (message: string) => Promise<string | null>;
  
  // Utility
  getSupportedChains: () => string[];
  isChainSupported: (chainKey: string) => boolean;
}

const initialState: WdkWalletState = {
  isConnected: false,
  isLoading: false,
  address: null,
  chainId: null,
  chainKey: null,
  accounts: [],
  error: null,
};

// ============================================
// CONTEXT
// ============================================

const WdkContext = createContext<WdkContextValue | null>(null);

interface WdkProviderProps {
  children: ReactNode;
  defaultChain?: string;
}

/**
 * WDK Provider (Browser-Safe)
 * 
 * Provides chain support info and stub wallet operations.
 * All sensitive operations happen server-side via API routes.
 */
export function WdkProvider({ children, defaultChain = 'sepolia' }: WdkProviderProps) {
  const [state, setState] = useState<WdkWalletState>({
    ...initialState,
    chainKey: defaultChain,
    chainId: WDK_CHAINS[defaultChain]?.chainId ?? null,
  });

  const supportedChainKeys = Object.keys(WDK_CHAINS);

  const getSupportedChains = useCallback(() => supportedChainKeys, []);

  const isChainSupported = useCallback(
    (chainKey: string) => chainKey in WDK_CHAINS,
    []
  );

  const switchChain = useCallback(async (chainKey: string): Promise<boolean> => {
    if (!(chainKey in WDK_CHAINS)) return false;
    setState(prev => ({
      ...prev,
      chainKey,
      chainId: WDK_CHAINS[chainKey]?.chainId ?? null,
    }));
    return true;
  }, []);

  // Stub wallet operations - these are handled server-side
  const createWallet = useCallback(async (): Promise<string | null> => {
    console.warn('[WDK] createWallet is not available in browser-safe mode. Use server API.');
    return null;
  }, []);

  const importWallet = useCallback(async (_mnemonic: string): Promise<boolean> => {
    console.warn('[WDK] importWallet is not available in browser-safe mode. Use server API.');
    return false;
  }, []);

  const lockWallet = useCallback(() => {
    setState(prev => ({ ...prev, isConnected: false, address: null }));
  }, []);

  const unlockWallet = useCallback(async (_password: string): Promise<boolean> => {
    console.warn('[WDK] unlockWallet is not available in browser-safe mode. Use server API.');
    return false;
  }, []);

  const disconnect = useCallback(() => {
    setState({ ...initialState, chainKey: defaultChain, chainId: WDK_CHAINS[defaultChain]?.chainId ?? null });
  }, [defaultChain]);

  const getBalance = useCallback(async (_chainKey?: string): Promise<string> => {
    return '0';
  }, []);

  const getUsdtBalance = useCallback(async (_chainKey?: string): Promise<string> => {
    return '0';
  }, []);

  const sendTransaction = useCallback(async (_tx: WdkTransactionRequest): Promise<string | null> => {
    console.warn('[WDK] sendTransaction is not available in browser-safe mode. Use server API.');
    return null;
  }, []);

  const sendUsdt = useCallback(async (_to: string, _amount: string): Promise<string | null> => {
    console.warn('[WDK] sendUsdt is not available in browser-safe mode. Use server API.');
    return null;
  }, []);

  const signMessage = useCallback(async (_message: string): Promise<string | null> => {
    console.warn('[WDK] signMessage is not available in browser-safe mode. Use server API.');
    return null;
  }, []);

  const value: WdkContextValue = {
    state,
    createWallet,
    importWallet,
    lockWallet,
    unlockWallet,
    disconnect,
    switchChain,
    getBalance,
    getUsdtBalance,
    sendTransaction,
    sendUsdt,
    signMessage,
    getSupportedChains,
    isChainSupported,
  };

  return (
    <WdkContext.Provider value={value}>
      {children}
    </WdkContext.Provider>
  );
}

// ============================================
// HOOKS (same exports as native context)
// ============================================

export function useWdk(): WdkContextValue {
  const context = useContext(WdkContext);
  if (!context) {
    throw new Error('useWdk must be used within a WdkProvider');
  }
  return context;
}

export function useWdkSafe(): WdkContextValue | null {
  return useContext(WdkContext);
}

export function useWdkAccount() {
  const { state } = useWdk();
  return {
    address: state.address,
    isConnected: state.isConnected,
    chainId: state.chainId,
    chainKey: state.chainKey,
  };
}

export function useWdkChain() {
  const { state, switchChain, getSupportedChains } = useWdk();
  return {
    chainId: state.chainId,
    chainKey: state.chainKey,
    switchChain,
    supportedChains: getSupportedChains(),
  };
}

export { WdkContext };
