/**
 * WDK Provider Stub (Browser-Safe)
 * 
 * The actual @tetherto/wdk-wallet-evm package uses sodium-native which
 * requires native Node.js bindings that can't be bundled for the browser.
 * 
 * This stub provides the same interface for client-side code, but actual
 * WDK operations happen server-side via the treasury service API:
 * - POST /api/community-pool/treasury/transfer
 * - POST /api/community-pool/treasury/sign-permit
 * 
 * For users who want an embedded wallet experience, they should use
 * wagmi/RainbowKit with their preferred wallet (MetaMask, OKX, etc.)
 */

'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ============================================
// Types (same as wdk-context.tsx)
// ============================================

export interface WdkWalletState {
  isInitialized: boolean;
  isCreating: boolean;
  address: string | null;
  recoveryPhrase: string | null;
  balance: string;
  error: string | null;
}

export interface WdkContextValue {
  wallet: WdkWalletState;
  createWallet: () => Promise<string | null>;
  importWallet: (recoveryPhrase: string) => Promise<boolean>;
  disconnectWallet: () => void;
  getUsdtBalance: (chainId: number) => Promise<string>;
  transfer: (to: string, amount: string, chainId: number) => Promise<string | null>;
  signPermit: (spender: string, amount: string, deadline: number, chainId: number) => Promise<{ v: number; r: string; s: string } | null>;
  getSupportedChains: () => number[];
  isChainSupported: (chainId: number) => boolean;
}

const defaultWalletState: WdkWalletState = {
  isInitialized: false,
  isCreating: false,
  address: null,
  recoveryPhrase: null,
  balance: '0',
  error: null,
};

const WdkContext = createContext<WdkContextValue | null>(null);

// ============================================
// Stub Provider (Browser-Safe)
// ============================================

interface WdkProviderProps {
  children: ReactNode;
}

/**
 * Stub WDK Provider
 * 
 * Provides the WDK interface without importing native Node.js dependencies.
 * All actual USDT operations should go through the treasury API endpoints.
 */
export function WdkProvider({ children }: WdkProviderProps) {
  const [wallet, setWallet] = useState<WdkWalletState>(defaultWalletState);

  // Stub: WDK wallet creation not available in browser
  // Users should use wagmi/RainbowKit with their existing wallet
  const createWallet = useCallback(async (): Promise<string | null> => {
    setWallet(prev => ({ 
      ...prev, 
      error: 'WDK embedded wallet not available. Please use MetaMask, OKX, or another wallet.' 
    }));
    return null;
  }, []);

  const importWallet = useCallback(async (_recoveryPhrase: string): Promise<boolean> => {
    setWallet(prev => ({ 
      ...prev, 
      error: 'WDK embedded wallet not available. Please use MetaMask, OKX, or another wallet.' 
    }));
    return false;
  }, []);

  const disconnectWallet = useCallback(() => {
    setWallet(defaultWalletState);
  }, []);

  const getUsdtBalance = useCallback(async (_chainId: number): Promise<string> => {
    return '0';
  }, []);

  const transfer = useCallback(async (_to: string, _amount: string, _chainId: number): Promise<string | null> => {
    console.warn('[WDK Stub] Transfer not available client-side. Use treasury API.');
    return null;
  }, []);

  const signPermit = useCallback(async (
    _spender: string, 
    _amount: string, 
    _deadline: number, 
    _chainId: number
  ): Promise<{ v: number; r: string; s: string } | null> => {
    console.warn('[WDK Stub] Sign permit not available client-side. Use treasury API.');
    return null;
  }, []);

  // Supported chains (same as real WDK config)
  const supportedChains = [11155111, 25, 42161]; // Sepolia, Cronos, Arbitrum

  const getSupportedChains = useCallback(() => supportedChains, []);
  
  const isChainSupported = useCallback((chainId: number) => 
    supportedChains.includes(chainId), []);

  const value: WdkContextValue = {
    wallet,
    createWallet,
    importWallet,
    disconnectWallet,
    getUsdtBalance,
    transfer,
    signPermit,
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
// Hook
// ============================================

export function useWdk(): WdkContextValue {
  const context = useContext(WdkContext);
  if (!context) {
    throw new Error('useWdk must be used within a WdkProvider');
  }
  return context;
}

/**
 * Safe hook that returns null if not in provider
 */
export function useWdkSafe(): WdkContextValue | null {
  return useContext(WdkContext);
}

export { WdkContext };
