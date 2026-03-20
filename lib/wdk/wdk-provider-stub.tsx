/**
 * WDK Provider Stub (Browser-Safe)
 * 
 * SECURITY: This provider does NOT handle any wallet credentials.
 * 
 * The actual @tetherto/wdk-wallet-evm package uses sodium-native which
 * requires native Node.js bindings that can't be bundled for the browser.
 * 
 * All WDK operations are handled server-side via:
 * - GET /api/community-pool/treasury/status (treasury wallet status)
 * - POST /api/community-pool/treasury/transfer (execute transfers)
 * 
 * Users deposit via their own wallets using WDK.
 * The AI agent's treasury wallet is managed securely on the server.
 */

'use client';

import { createContext, useContext, useCallback, ReactNode } from 'react';

// Minimal context - no wallet credentials ever in browser
export interface WdkContextValue {
  getSupportedChains: () => number[];
  isChainSupported: (chainId: number) => boolean;
}

const WdkContext = createContext<WdkContextValue | null>(null);

interface WdkProviderProps {
  children: ReactNode;
}

/**
 * WDK Provider (Browser-Safe)
 * 
 * Provides chain support info only.
 * All sensitive operations happen server-side.
 */
export function WdkProvider({ children }: WdkProviderProps) {
  // WDK USDT supported chains
  const supportedChains = [11155111, 25, 42161]; // Sepolia, Cronos, Arbitrum

  const getSupportedChains = useCallback(() => supportedChains, []);
  
  const isChainSupported = useCallback((chainId: number) => 
    supportedChains.includes(chainId), []);

  const value: WdkContextValue = {
    getSupportedChains,
    isChainSupported,
  };

  return (
    <WdkContext.Provider value={value}>
      {children}
    </WdkContext.Provider>
  );
}

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

export { WdkContext };
