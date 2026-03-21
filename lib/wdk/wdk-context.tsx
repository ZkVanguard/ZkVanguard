/**
 * WDK Wallet Context (Browser-Safe via ethers.js)
 * 
 * Full self-custodial wallet for Tether WDK USDT — no native Node.js
 * bindings required. Uses ethers.js HDNodeWallet for BIP-39 mnemonic
 * generation, key derivation, signing, and on-chain transactions.
 * 
 * Replaces the sodium-native-dependent @tetherto/wdk-wallet-evm with
 * a pure-JS implementation that works on Vercel and in all browsers.
 * 
 * @see https://docs.wdk.tether.io/
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { WDK_CHAINS } from '@/lib/config/wdk';

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
  signTypedData: (domain: any, types: any, value: any) => Promise<string | null>;
  
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
// LOCAL STORAGE HELPERS
// ============================================

const STORAGE_KEY = 'wdk_wallet_v2';

interface StoredWallet {
  encryptedMnemonic: string;
  addresses: Record<string, string>;
  lastChain: string;
}

// Encrypt mnemonic with a password using XOR (demo-grade).
// In production, use Web Crypto API (AES-GCM).
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
// ETHERS.JS HELPERS (lazy-loaded, browser-safe)
// ============================================

async function getEthers() {
  // Dynamic import so ethers.js tree-shakes on server and loads only in browser
  const ethers = await import('ethers');
  return ethers;
}

function getProvider(chainKey: string) {
  const config = WDK_CHAINS[chainKey];
  if (!config) return null;
  // Lazy-import avoids top-level ethers reference during SSR
  const { ethers } = require('ethers');
  return new ethers.JsonRpcProvider(config.rpcUrl, undefined, { batchMaxCount: 1 });
}

// ============================================
// CONTEXT
// ============================================

const WdkContext = createContext<WdkContextValue | null>(null);

interface WdkProviderProps {
  children: ReactNode;
  defaultChain?: string;
}

const SUPPORTED_CHAINS = ['sepolia', 'cronos-mainnet', 'arbitrum-mainnet'];
const DEMO_PASSWORD = 'wdk-demo-password';

/**
 * WDK Provider — browser-safe, ethers.js-backed wallet management.
 */
export function WdkProvider({ children, defaultChain = 'sepolia' }: WdkProviderProps) {
  const [state, setState] = useState<WdkWalletState>({
    ...initialState,
    chainKey: defaultChain,
    chainId: WDK_CHAINS[defaultChain]?.chainId ?? null,
  });

  // Keep a ref to the ethers Wallet so signing/sending survives re-renders
  const walletRef = useRef<any>(null); // ethers.HDNodeWallet
  const mnemonicRef = useRef<string | null>(null);

  // --------------------------------------------------
  // Boot: check localStorage for a saved wallet
  // --------------------------------------------------
  useEffect(() => {
    const stored = loadWallet();
    if (stored) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isConnected: false, // locked until unlocked
        chainKey: stored.lastChain,
        chainId: WDK_CHAINS[stored.lastChain]?.chainId ?? null,
      }));
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // --------------------------------------------------
  // Internal: derive accounts from mnemonic
  // --------------------------------------------------
  const initializeFromMnemonic = useCallback(async (
    mnemonic: string,
    chainKey: string = defaultChain,
  ): Promise<boolean> => {
    try {
      const { ethers } = await getEthers();
      const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);

      const accounts: WdkAccount[] = [];
      for (const chain of SUPPORTED_CHAINS) {
        const config = WDK_CHAINS[chain];
        if (config) {
          accounts.push({
            address: hdNode.address,
            chainKey: chain,
            chainId: config.chainId,
          });
        }
      }

      walletRef.current = hdNode;
      mnemonicRef.current = mnemonic;

      const selected = accounts.find(a => a.chainKey === chainKey) ?? accounts[0];
      setState(prev => ({
        ...prev,
        isConnected: true,
        isLoading: false,
        address: selected?.address ?? null,
        chainId: WDK_CHAINS[chainKey]?.chainId ?? null,
        chainKey,
        accounts,
        error: null,
      }));
      return true;
    } catch (err: any) {
      console.error('[WDK] Wallet init failed:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err?.message ?? 'Failed to initialize wallet',
      }));
      return false;
    }
  }, [defaultChain]);

  // --------------------------------------------------
  // createWallet — BIP-39 via ethers.js
  // --------------------------------------------------
  const createWallet = useCallback(async (): Promise<string | null> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const { ethers } = await getEthers();
      const wallet = ethers.HDNodeWallet.createRandom();
      const mnemonic = wallet.mnemonic?.phrase;
      if (!mnemonic) {
        setState(prev => ({ ...prev, isLoading: false, error: 'Mnemonic generation failed' }));
        return null;
      }

      const ok = await initializeFromMnemonic(mnemonic);
      if (!ok) return null;

      // Persist encrypted
      const stored: StoredWallet = {
        encryptedMnemonic: encryptMnemonic(mnemonic, DEMO_PASSWORD),
        addresses: {},
        lastChain: defaultChain,
      };
      SUPPORTED_CHAINS.forEach(chain => {
        stored.addresses[chain] = wallet.address;
      });
      saveWallet(stored);

      return mnemonic;
    } catch (err: any) {
      console.error('[WDK] createWallet error:', err);
      setState(prev => ({ ...prev, isLoading: false, error: err?.message ?? 'Create wallet failed' }));
      return null;
    }
  }, [initializeFromMnemonic, defaultChain]);

  // --------------------------------------------------
  // importWallet — validate + derive from mnemonic
  // --------------------------------------------------
  const importWallet = useCallback(async (mnemonic: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Invalid seed phrase. Must be 12 or 24 words.',
      }));
      return false;
    }

    const ok = await initializeFromMnemonic(mnemonic.trim());
    if (!ok) return false;

    // Persist encrypted
    const address = walletRef.current?.address ?? '';
    const stored: StoredWallet = {
      encryptedMnemonic: encryptMnemonic(mnemonic.trim(), DEMO_PASSWORD),
      addresses: {},
      lastChain: defaultChain,
    };
    SUPPORTED_CHAINS.forEach(chain => { stored.addresses[chain] = address; });
    saveWallet(stored);

    return true;
  }, [initializeFromMnemonic, defaultChain]);

  // --------------------------------------------------
  // lockWallet
  // --------------------------------------------------
  const lockWallet = useCallback(() => {
    walletRef.current = null;
    mnemonicRef.current = null;
    const stored = loadWallet();
    setState({
      ...initialState,
      isLoading: false,
      chainKey: stored?.lastChain ?? defaultChain,
      chainId: WDK_CHAINS[stored?.lastChain ?? defaultChain]?.chainId ?? null,
    });
  }, [defaultChain]);

  // --------------------------------------------------
  // unlockWallet
  // --------------------------------------------------
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
    return initializeFromMnemonic(mnemonic, stored.lastChain);
  }, [initializeFromMnemonic]);

  // --------------------------------------------------
  // disconnect — wipe storage
  // --------------------------------------------------
  const disconnect = useCallback(() => {
    walletRef.current = null;
    mnemonicRef.current = null;
    clearWallet();
    setState({ ...initialState, isLoading: false, chainKey: defaultChain, chainId: WDK_CHAINS[defaultChain]?.chainId ?? null });
  }, [defaultChain]);

  // --------------------------------------------------
  // switchChain
  // --------------------------------------------------
  const switchChain = useCallback(async (chainKey: string): Promise<boolean> => {
    if (!(chainKey in WDK_CHAINS)) return false;

    setState(prev => ({
      ...prev,
      chainKey,
      chainId: WDK_CHAINS[chainKey]?.chainId ?? null,
    }));

    // Update stored preference
    const stored = loadWallet();
    if (stored) {
      stored.lastChain = chainKey;
      saveWallet(stored);
    }
    return true;
  }, []);

  // --------------------------------------------------
  // getBalance (native)
  // --------------------------------------------------
  const getBalance = useCallback(async (chainKey?: string): Promise<string> => {
    const chain = chainKey ?? state.chainKey;
    if (!chain || !walletRef.current) return '0';
    try {
      const provider = getProvider(chain);
      if (!provider) return '0';
      const bal = await provider.getBalance(walletRef.current.address);
      const { ethers } = await getEthers();
      return ethers.formatEther(bal);
    } catch { return '0'; }
  }, [state.chainKey]);

  // --------------------------------------------------
  // getUsdtBalance
  // --------------------------------------------------
  const getUsdtBalance = useCallback(async (chainKey?: string): Promise<string> => {
    const chain = chainKey ?? state.chainKey;
    if (!chain || !walletRef.current) return '0';
    const config = WDK_CHAINS[chain];
    if (!config?.usdtAddress) return '0';
    try {
      const { ethers } = await getEthers();
      const provider = getProvider(chain);
      if (!provider) return '0';
      const usdt = new ethers.Contract(config.usdtAddress, [
        'function balanceOf(address) view returns (uint256)',
      ], provider);
      const bal = await usdt.balanceOf(walletRef.current.address);
      return ethers.formatUnits(bal, 6);
    } catch { return '0'; }
  }, [state.chainKey]);

  // --------------------------------------------------
  // sendTransaction
  // --------------------------------------------------
  const sendTransaction = useCallback(async (tx: WdkTransactionRequest): Promise<string | null> => {
    if (!walletRef.current || !state.chainKey) return null;
    const provider = getProvider(state.chainKey);
    if (!provider) return null;
    const signer = walletRef.current.connect(provider);
    const resp = await signer.sendTransaction({
      to: tx.to,
      value: tx.value ?? 0n,
      data: tx.data,
    });
    return resp.hash;
  }, [state.chainKey]);

  // --------------------------------------------------
  // sendUsdt
  // --------------------------------------------------
  const sendUsdt = useCallback(async (to: string, amount: string): Promise<string | null> => {
    if (!walletRef.current || !state.chainKey) return null;
    const config = WDK_CHAINS[state.chainKey];
    if (!config?.usdtAddress) return null;
    try {
      const { ethers } = await getEthers();
      const provider = getProvider(state.chainKey);
      if (!provider) return null;
      const signer = walletRef.current.connect(provider);
      const usdt = new ethers.Contract(config.usdtAddress, [
        'function transfer(address,uint256) returns (bool)',
      ], signer);
      const tx = await usdt.transfer(to, ethers.parseUnits(amount, 6));
      return tx.hash;
    } catch (err: any) {
      console.error('[WDK] sendUsdt failed:', err);
      setState(prev => ({ ...prev, error: err?.message ?? 'USDT transfer failed' }));
      return null;
    }
  }, [state.chainKey]);

  // --------------------------------------------------
  // signMessage
  // --------------------------------------------------
  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    if (!walletRef.current) return null;
    try {
      return await walletRef.current.signMessage(message);
    } catch (err: any) {
      console.error('[WDK] signMessage failed:', err);
      return null;
    }
  }, []);

  // --------------------------------------------------
  // signTypedData (EIP-712)
  // --------------------------------------------------
  const signTypedData = useCallback(async (domain: any, types: any, value: any): Promise<string | null> => {
    if (!walletRef.current) return null;
    try {
      return await walletRef.current.signTypedData(domain, types, value);
    } catch (err: any) {
      console.error('[WDK] signTypedData failed:', err);
      return null;
    }
  }, []);

  // --------------------------------------------------
  // Utility
  // --------------------------------------------------
  const getSupportedChains = useCallback(() => Object.keys(WDK_CHAINS), []);
  const isChainSupported = useCallback((chainKey: string) => chainKey in WDK_CHAINS, []);

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
    signTypedData,
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
