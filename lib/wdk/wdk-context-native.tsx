/**
 * WDK Wallet Context (Browser-Safe)
 * 
 * Full WDK wallet implementation for self-custodial wallet management.
 * This is the native Tether WDK implementation.
 * 
 * Features:
 * - Create new wallets (BIP-39 seed phrase)
 * - Import existing wallets
 * - Encrypted local storage
 * - Multi-chain support (Cronos, Hedera, Sepolia)
 * - ERC-20 token transfers (USDT)
 * 
 * @see https://docs.wdk.tether.io/
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { WDK_CHAINS, USDT_ADDRESSES } from '@/lib/config/wdk';

// ============================================
// TYPES
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
  createWallet: () => Promise<string | null>; // Returns mnemonic for user to backup
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
  isLoading: true,
  address: null,
  chainId: null,
  chainKey: null,
  accounts: [],
  error: null,
};

// ============================================
// STORAGE HELPERS
// ============================================

const STORAGE_KEY = 'wdk_wallet_v1';

interface StoredWallet {
  encryptedMnemonic: string;
  addresses: Record<string, string>;
  lastChain: string;
}

// Simple XOR encryption for demo - in production use Web Crypto API
function encryptMnemonic(mnemonic: string, password: string): string {
  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(mnemonic);
  const keyBytes = encoder.encode(password.padEnd(mnemonicBytes.length, password));
  
  const encrypted = new Uint8Array(mnemonicBytes.length);
  for (let i = 0; i < mnemonicBytes.length; i++) {
    encrypted[i] = mnemonicBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  
  return btoa(String.fromCharCode(...encrypted));
}

function decryptMnemonic(encryptedData: string, password: string): string | null {
  try {
    const encrypted = new Uint8Array(
      atob(encryptedData).split('').map(c => c.charCodeAt(0))
    );
    const keyBytes = new TextEncoder().encode(password.padEnd(encrypted.length, password));
    
    const decrypted = new Uint8Array(encrypted.length);
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ keyBytes[i % keyBytes.length];
    }
    
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

function saveWallet(wallet: StoredWallet): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  }
}

function loadWallet(): StoredWallet | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : null;
}

function clearWallet(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ============================================
// CONTEXT
// ============================================

const WdkContext = createContext<WdkContextValue | null>(null);

interface WdkProviderProps {
  children: ReactNode;
  defaultChain?: string;
}

/**
 * WDK Provider - Full wallet management
 */
export function WdkProvider({ children, defaultChain = 'sepolia' }: WdkProviderProps) {
  const [state, setState] = useState<WdkWalletState>(initialState);
  const [wdkInstance, setWdkInstance] = useState<any>(null);
  const [walletManager, setWalletManager] = useState<any>(null);
  const [unlockPassword, setUnlockPassword] = useState<string | null>(null);
  
  // Initialize WDK on mount
  useEffect(() => {
    async function initWdk() {
      try {
        // Dynamic import to avoid SSR issues with native deps
        const [WDK, WalletManagerEvm] = await Promise.all([
          import('@tetherto/wdk').then(m => m.default),
          import('@tetherto/wdk-wallet-evm').then(m => m.default),
        ]);
        
        // Check for existing wallet
        const stored = loadWallet();
        if (stored) {
          setState(prev => ({
            ...prev,
            isLoading: false,
            // Show as "locked" - needs password to unlock
            isConnected: false,
            chainKey: stored.lastChain,
            chainId: WDK_CHAINS[stored.lastChain]?.chainId ?? null,
          }));
        } else {
          setState(prev => ({ ...prev, isLoading: false }));
        }
        
        // Store module refs for later use
        setWdkInstance({ WDK, WalletManagerEvm });
      } catch (err) {
        console.error('[WDK] Init error:', err);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Failed to initialize WDK',
        }));
      }
    }
    
    initWdk();
  }, []);
  
  // Generate random mnemonic using WDK
  const generateMnemonic = useCallback(async (): Promise<string | null> => {
    if (!wdkInstance) return null;
    try {
      return wdkInstance.WDK.getRandomSeedPhrase();
    } catch (err) {
      console.error('[WDK] Mnemonic generation failed:', err);
      return null;
    }
  }, [wdkInstance]);
  
  // Initialize wallet from mnemonic
  const initializeFromMnemonic = useCallback(async (
    mnemonic: string,
    chainKey: string = defaultChain
  ): Promise<boolean> => {
    if (!wdkInstance) return false;
    
    try {
      const { WDK, WalletManagerEvm } = wdkInstance;
      const chainConfig = WDK_CHAINS[chainKey];
      
      if (!chainConfig) {
        console.error('[WDK] Unknown chain:', chainKey);
        return false;
      }
      
      // Create WDK instance with mnemonic
      const wdk = new WDK(mnemonic);
      
      // Register EVM wallet for each supported chain
      const supportedChains = ['sepolia', 'cronos-mainnet', 'hedera-mainnet'];
      const accounts: WdkAccount[] = [];
      
      for (const chain of supportedChains) {
        const config = WDK_CHAINS[chain];
        if (config) {
          wdk.registerWallet(chain, WalletManagerEvm, {
            provider: config.rpcUrl,
          });
          
          // Get account and address
          const account = await wdk.getAccount(chain, 0);
          const address = await account.getAddress();
          
          accounts.push({
            address,
            chainKey: chain,
            chainId: config.chainId,
          });
        }
      }
      
      setWalletManager(wdk);
      
      // Get address for selected chain
      const selectedAccount = accounts.find(a => a.chainKey === chainKey);
      
      setState(prev => ({
        ...prev,
        isConnected: true,
        isLoading: false,
        address: selectedAccount?.address ?? accounts[0]?.address ?? null,
        chainId: chainConfig.chainId,
        chainKey,
        accounts,
        error: null,
      }));
      
      return true;
    } catch (err) {
      console.error('[WDK] Wallet init failed:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to initialize wallet',
      }));
      return false;
    }
  }, [wdkInstance, defaultChain]);
  
  // Create new wallet
  const createWallet = useCallback(async (): Promise<string | null> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    const mnemonic = await generateMnemonic();
    if (!mnemonic) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to generate seed phrase',
      }));
      return null;
    }
    
    const success = await initializeFromMnemonic(mnemonic);
    if (!success) return null;
    
    // Default password for demo - in production, prompt user
    const password = 'wdk-demo-password';
    setUnlockPassword(password);
    
    // Save encrypted wallet
    const storedWallet: StoredWallet = {
      encryptedMnemonic: encryptMnemonic(mnemonic, password),
      addresses: {},
      lastChain: defaultChain,
    };
    
    state.accounts.forEach(acc => {
      storedWallet.addresses[acc.chainKey] = acc.address;
    });
    
    saveWallet(storedWallet);
    
    return mnemonic;
  }, [generateMnemonic, initializeFromMnemonic, defaultChain, state.accounts]);
  
  // Import existing wallet
  const importWallet = useCallback(async (mnemonic: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    // Validate mnemonic format (12 or 24 words)
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Invalid seed phrase. Must be 12 or 24 words.',
      }));
      return false;
    }
    
    const success = await initializeFromMnemonic(mnemonic);
    if (!success) return false;
    
    // Default password for demo
    const password = 'wdk-demo-password';
    setUnlockPassword(password);
    
    // Save encrypted wallet
    const storedWallet: StoredWallet = {
      encryptedMnemonic: encryptMnemonic(mnemonic, password),
      addresses: {},
      lastChain: defaultChain,
    };
    
    state.accounts.forEach(acc => {
      storedWallet.addresses[acc.chainKey] = acc.address;
    });
    
    saveWallet(storedWallet);
    
    return true;
  }, [initializeFromMnemonic, defaultChain, state.accounts]);
  
  // Lock wallet (clear from memory)
  const lockWallet = useCallback(() => {
    setWalletManager(null);
    setUnlockPassword(null);
    
    const stored = loadWallet();
    setState({
      ...initialState,
      isLoading: false,
      chainKey: stored?.lastChain ?? null,
      chainId: stored?.lastChain ? WDK_CHAINS[stored.lastChain]?.chainId ?? null : null,
    });
  }, []);
  
  // Unlock wallet with password
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    const stored = loadWallet();
    if (!stored) {
      setState(prev => ({ ...prev, error: 'No wallet found' }));
      return false;
    }
    
    const mnemonic = decryptMnemonic(stored.encryptedMnemonic, password);
    if (!mnemonic) {
      setState(prev => ({ ...prev, error: 'Invalid password' }));
      return false;
    }
    
    setUnlockPassword(password);
    return await initializeFromMnemonic(mnemonic, stored.lastChain);
  }, [initializeFromMnemonic]);
  
  // Disconnect wallet (clear storage)
  const disconnect = useCallback(() => {
    setWalletManager(null);
    setUnlockPassword(null);
    clearWallet();
    setState(initialState);
  }, []);
  
  // Switch chain
  const switchChain = useCallback(async (chainKey: string): Promise<boolean> => {
    if (!walletManager) return false;
    
    const chainConfig = WDK_CHAINS[chainKey];
    if (!chainConfig) {
      setState(prev => ({ ...prev, error: `Unknown chain: ${chainKey}` }));
      return false;
    }
    
    try {
      const account = await walletManager.getAccount(chainKey, 0);
      const address = await account.getAddress();
      
      setState(prev => ({
        ...prev,
        address,
        chainId: chainConfig.chainId,
        chainKey,
      }));
      
      // Update saved wallet
      const stored = loadWallet();
      if (stored) {
        stored.lastChain = chainKey;
        saveWallet(stored);
      }
      
      return true;
    } catch (err) {
      console.error('[WDK] Chain switch failed:', err);
      setState(prev => ({ ...prev, error: 'Failed to switch chain' }));
      return false;
    }
  }, [walletManager]);
  
  // Get native balance
  const getBalance = useCallback(async (chainKey?: string): Promise<string> => {
    if (!walletManager) return '0';
    
    const chain = chainKey ?? state.chainKey;
    if (!chain) return '0';
    
    try {
      const account = await walletManager.getAccount(chain, 0);
      const balance = await account.getBalance();
      return balance.toString();
    } catch (err) {
      console.error('[WDK] Balance fetch failed:', err);
      return '0';
    }
  }, [walletManager, state.chainKey]);
  
  // Get USDT balance
  const getUsdtBalance = useCallback(async (chainKey?: string): Promise<string> => {
    if (!walletManager) return '0';
    
    const chain = chainKey ?? state.chainKey;
    if (!chain) return '0';
    
    try {
      const account = await walletManager.getAccount(chain, 0);
      // WDK has built-in token balance support
      const balance = await account.getTokenBalance?.() ?? await account.getBalance();
      return balance.toString();
    } catch (err) {
      console.error('[WDK] USDT balance fetch failed:', err);
      return '0';
    }
  }, [walletManager, state.chainKey]);
  
  // Send transaction
  const sendTransaction = useCallback(async (tx: WdkTransactionRequest): Promise<string | null> => {
    if (!walletManager || !state.chainKey) return null;
    
    try {
      const account = await walletManager.getAccount(state.chainKey, 0);
      const result = await account.sendTransaction({
        to: tx.to,
        value: tx.value ?? 0n,
        data: tx.data,
      });
      
      return result.hash;
    } catch (err) {
      console.error('[WDK] Transaction failed:', err);
      setState(prev => ({ ...prev, error: 'Transaction failed' }));
      return null;
    }
  }, [walletManager, state.chainKey]);
  
  // Send USDT
  const sendUsdt = useCallback(async (to: string, amount: string): Promise<string | null> => {
    if (!walletManager || !state.chainKey) return null;
    
    const chainConfig = WDK_CHAINS[state.chainKey];
    const usdtAddress = chainConfig?.usdtAddress;
    
    if (!usdtAddress) {
      setState(prev => ({ ...prev, error: 'USDT not supported on this chain' }));
      return null;
    }
    
    try {
      const account = await walletManager.getAccount(state.chainKey, 0);
      // Convert amount to smallest unit (6 decimals for USDT)
      const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e6));
      
      const result = await account.sendToken?.({
        to,
        amount: amountWei,
        tokenAddress: usdtAddress,
      });
      
      return result?.hash ?? null;
    } catch (err) {
      console.error('[WDK] USDT transfer failed:', err);
      setState(prev => ({ ...prev, error: 'USDT transfer failed' }));
      return null;
    }
  }, [walletManager, state.chainKey]);
  
  // Sign message
  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    if (!walletManager || !state.chainKey) return null;
    
    try {
      const account = await walletManager.getAccount(state.chainKey, 0);
      const signature = await account.signMessage?.(message);
      return signature ?? null;
    } catch (err) {
      console.error('[WDK] Sign message failed:', err);
      return null;
    }
  }, [walletManager, state.chainKey]);
  
  // Get supported chains
  const getSupportedChains = useCallback((): string[] => {
    return Object.keys(WDK_CHAINS);
  }, []);
  
  // Check if chain is supported
  const isChainSupported = useCallback((chainKey: string): boolean => {
    return chainKey in WDK_CHAINS;
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
// HOOKS
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
