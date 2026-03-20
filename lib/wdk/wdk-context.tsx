/**
 * Tether WDK Context & Provider
 * 
 * DEPRECATED: This file is no longer used in production.
 * Use wdk-provider-stub.tsx instead for browser-safe operations.
 * The actual WDK operations should go through server-side API routes.
 * 
 * @see https://docs.wdk.tether.io/
 */

// @ts-nocheck - Deprecated file, types may not match WDK runtime API
'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import WdkManager from '@tetherto/wdk';
import WalletManagerEvm, { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import { WDK_USDT_CONFIGS } from '@/lib/config/wdk-usdt';
import { WDK_CHAINS } from '@/lib/config/wdk';

// ============================================
// Types
// ============================================

export interface WdkWalletState {
  isInitialized: boolean;
  isCreating: boolean;
  address: string | null;
  seedPhrase: string | null; // Only shown once during creation
  balance: string;
  error: string | null;
}

export interface WdkContextValue {
  // Wallet state
  wallet: WdkWalletState;
  
  // Actions
  createWallet: () => Promise<string | null>; // Returns seed phrase
  importWallet: (seedPhrase: string) => Promise<boolean>;
  disconnectWallet: () => void;
  
  // USDT Operations (gasless via permit when supported)
  getUsdtBalance: (chainId: number) => Promise<string>;
  transfer: (to: string, amount: string, chainId: number) => Promise<string | null>; // Returns tx hash
  signPermit: (spender: string, amount: string, deadline: number, chainId: number) => Promise<{ v: number; r: string; s: string } | null>;
  
  // Chain support
  getSupportedChains: () => number[];
  isChainSupported: (chainId: number) => boolean;
}

const defaultWalletState: WdkWalletState = {
  isInitialized: false,
  isCreating: false,
  address: null,
  seedPhrase: null,
  balance: '0',
  error: null,
};

const WdkContext = createContext<WdkContextValue | null>(null);

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY = 'wdk_wallet_encrypted';
const SESSION_KEY = 'wdk_session';

// ============================================
// Provider
// ============================================

interface WdkProviderProps {
  children: ReactNode;
}

export function WdkProvider({ children }: WdkProviderProps) {
  const [wallet, setWallet] = useState<WdkWalletState>(defaultWalletState);
  const [wdkManager, setWdkManager] = useState<WdkManager | null>(null);
  const [evmAccount, setEvmAccount] = useState<any>(null);

  // Initialize WDK manager from stored seed (if exists)
  useEffect(() => {
    const initFromStorage = async () => {
      try {
        // Check for existing session (in-memory for security)
        const sessionData = sessionStorage.getItem(SESSION_KEY);
        if (sessionData) {
          const { seed } = JSON.parse(sessionData);
          await initializeWdk(seed);
        }
      } catch (err) {
        console.error('[WDK] Failed to restore session:', err);
      }
    };
    
    initFromStorage();
  }, []);

  // Initialize WDK with seed phrase
  const initializeWdk = async (seed: string): Promise<string | null> => {
    try {
      // Validate seed
      if (!WdkManager.isValidSeed(seed)) {
        setWallet(prev => ({ ...prev, error: 'Invalid seed phrase' }));
        return null;
      }

      // Create WDK manager
      const manager = new WdkManager(seed);
      
      // Register EVM wallet for Sepolia (primary WDK testnet)
      const sepoliaConfig = WDK_CHAINS['sepolia'];
      manager.registerWallet('ethereum', WalletManagerEvm, {
        chainId: sepoliaConfig.chainId,
        rpcUrl: sepoliaConfig.rpcUrl,
      });

      // Get account
      const account = await manager.getAccount('ethereum', 0);
      const address = await (account as any).getAddress();

      setWdkManager(manager);
      setEvmAccount(account);
      setWallet({
        isInitialized: true,
        isCreating: false,
        address,
        seedPhrase: null, // Don't store seed in state after init
        balance: '0',
        error: null,
      });

      // Store session (seed in sessionStorage - cleared on browser close)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ seed }));

      return address;
    } catch (err: any) {
      console.error('[WDK] Initialization error:', err);
      setWallet(prev => ({ ...prev, error: err.message, isCreating: false }));
      return null;
    }
  };

  // Create new wallet
  const createWallet = useCallback(async (): Promise<string | null> => {
    setWallet(prev => ({ ...prev, isCreating: true, error: null }));
    
    try {
      // Generate random seed phrase
      const seed = WdkManager.getRandomSeedPhrase();
      
      // Initialize with new seed
      const address = await initializeWdk(seed);
      
      if (address) {
        // Return seed phrase (user must save it!)
        setWallet(prev => ({ ...prev, seedPhrase: seed }));
        return seed;
      }
      
      return null;
    } catch (err: any) {
      console.error('[WDK] Create wallet error:', err);
      setWallet(prev => ({ ...prev, error: err.message, isCreating: false }));
      return null;
    }
  }, []);

  // Import existing wallet
  const importWallet = useCallback(async (seedPhrase: string): Promise<boolean> => {
    setWallet(prev => ({ ...prev, isCreating: true, error: null }));
    
    const address = await initializeWdk(seedPhrase);
    return !!address;
  }, []);

  // Disconnect wallet
  const disconnectWallet = useCallback(() => {
    if (wdkManager) {
      wdkManager.dispose();
    }
    
    setWdkManager(null);
    setEvmAccount(null);
    setWallet(defaultWalletState);
    sessionStorage.removeItem(SESSION_KEY);
  }, [wdkManager]);

  // Get USDT balance
  const getUsdtBalance = useCallback(async (chainId: number): Promise<string> => {
    if (!evmAccount) return '0';
    
    try {
      const config = WDK_USDT_CONFIGS[chainId];
      if (!config) return '0';
      
      const balance = await (evmAccount as any).getTokenBalance(config.address);
      return balance.toString();
    } catch (err) {
      console.error('[WDK] Balance fetch error:', err);
      return '0';
    }
  }, [evmAccount]);

  // Transfer USDT
  const transfer = useCallback(async (
    to: string,
    amount: string,
    chainId: number
  ): Promise<string | null> => {
    if (!evmAccount) return null;
    
    try {
      const config = WDK_USDT_CONFIGS[chainId];
      if (!config) {
        throw new Error(`Chain ${chainId} not supported`);
      }
      
      const result = await (evmAccount as any).transfer({
        to,
        amount,
        token: config.address,
      });
      
      return result.txHash;
    } catch (err: any) {
      console.error('[WDK] Transfer error:', err);
      setWallet(prev => ({ ...prev, error: err.message }));
      return null;
    }
  }, [evmAccount]);

  // Sign EIP-2612 permit (for gasless approve)
  const signPermit = useCallback(async (
    spender: string,
    amount: string,
    deadline: number,
    chainId: number
  ): Promise<{ v: number; r: string; s: string } | null> => {
    if (!evmAccount) return null;
    
    try {
      const config = WDK_USDT_CONFIGS[chainId];
      if (!config) {
        throw new Error(`Chain ${chainId} not supported`);
      }
      
      // Get nonce for permit
      const address = await (evmAccount as any).getAddress();
      
      // Create permit typed data (EIP-712)
      const domain = {
        name: 'Tether USD',
        version: '1',
        chainId,
        verifyingContract: config.address,
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
      
      // Get current nonce from contract (WDK account should handle this)
      const nonce = 0; // TODO: Fetch from contract
      
      const value = {
        owner: address,
        spender,
        value: amount,
        nonce,
        deadline,
      };
      
      // Sign with WDK account
      const signature = await (evmAccount as any).signTypedData(domain, types, value);
      
      // Parse signature into v, r, s
      const r = signature.slice(0, 66);
      const s = '0x' + signature.slice(66, 130);
      const v = parseInt(signature.slice(130, 132), 16);
      
      return { v, r, s };
    } catch (err: any) {
      console.error('[WDK] Permit signing error:', err);
      return null;
    }
  }, [evmAccount]);

  // Get supported chains
  const getSupportedChains = useCallback((): number[] => {
    return Object.keys(WDK_USDT_CONFIGS).map(Number);
  }, []);

  // Check if chain is supported
  const isChainSupported = useCallback((chainId: number): boolean => {
    return !!WDK_USDT_CONFIGS[chainId];
  }, []);

  const value = useMemo<WdkContextValue>(() => ({
    wallet,
    createWallet,
    importWallet,
    disconnectWallet,
    getUsdtBalance,
    transfer,
    signPermit,
    getSupportedChains,
    isChainSupported,
  }), [
    wallet,
    createWallet,
    importWallet,
    disconnectWallet,
    getUsdtBalance,
    transfer,
    signPermit,
    getSupportedChains,
    isChainSupported,
  ]);

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

// Safe version that doesn't throw
export function useWdkSafe(): WdkContextValue | null {
  return useContext(WdkContext);
}
