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
import { PasskeyService } from './passkey-service';
import { generateKey, exportKey, importKey, encryptData, decryptData } from './encryption';

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
  isUnlocked: boolean; // Tracks if wallet is locally unlocked (vs just connected)
  hasPasskey: boolean; // Tracks if a passkey is registered
  hasWallet: boolean; // Tracks if a wallet exists in local storage
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
  registerPasskey: () => Promise<boolean>;
  loginWithPasskey: () => Promise<boolean>;
  resetWallet: () => void;
  // Chain Operations
  switchChain: (chainKey: string) => Promise<boolean>;
  getBalance: (chainKey?: string) => Promise<string>;
  getUsdtBalance: (chainKey?: string) => Promise<string>;
  
  // Transaction Operations
  sendTransaction: (tx: WdkTransactionRequest) => Promise<string | null>;
  sendUsdt: (to: string, amount: string) => Promise<string | null>;
  signMessage: (message: string | Uint8Array) => Promise<string | null>;
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
  isUnlocked: false,
  hasPasskey: false,
  hasWallet: false,
};

// ============================================
// LOCAL STORAGE HELPERS
// ============================================

const STORAGE_KEY = 'wdk_wallet_v2';

interface StoredWallet {
  encryptedData: string;
  iv: string;
  keyJwk: string;
  addresses: Record<string, string>;
  lastChain: string;
  passkeyId?: string;
}

// Helper to persist wallet structure
function saveWallet(wallet: StoredWallet): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  }
}

// Helper to load wallet structure
function loadWallet(): StoredWallet | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  
  try {
    const parsed = JSON.parse(data);
    // Basic validation to ensure migration from old format
    if (!parsed.encryptedData || !parsed.iv || !parsed.keyJwk) {
      console.warn('[WDK] Detected old wallet format, clearing storage.');
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed as StoredWallet;
  } catch (e) {
    return null;
  }
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
      console.log('[WDK] Found stored wallet, passkey:', !!stored.passkeyId);
      setState(prev => ({
        ...prev,
        isLoading: false,
        isConnected: false, // locked until unlocked
        isUnlocked: false,
        hasPasskey: !!stored.passkeyId,
        hasWallet: true,
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
      const stored = loadWallet(); // Check storage for passkey status
      
      setState(prev => ({
        ...prev,
        isConnected: true,
        isUnlocked: true,
        hasPasskey: !!stored?.passkeyId,
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
  // registerPasskey - Add face/touch ID to existing wallet
  // --------------------------------------------------
  const registerPasskey = useCallback(async (): Promise<boolean> => {
    if (!walletRef.current || !state.isUnlocked) {
      setState(prev => ({ ...prev, error: 'Wallet must be unlocked to add passkey' }));
      return false;
    }

    try {
      // Use wallet address as user identifier for passkey
      const username = walletRef.current.address.slice(0, 8);
      const credential = await PasskeyService.register(username);
      
      if (!credential) {
         throw new Error('Passkey registration cancelled');
      }

      // Save passkey ID to local storage (use rawId base64)
      const stored = loadWallet();
      if (stored) {
        stored.passkeyId = credential.rawId;
        saveWallet(stored);
        setState(prev => ({ ...prev, hasPasskey: true }));
        return true;
      }
      return false;
    } catch (err: any) {
      console.error('[WDK] registerPasskey error:', err);
      setState(prev => ({ ...prev, error: err.message || 'Failed to register passkey' }));
      return false;
    }
  }, [state.isUnlocked]);

  // --------------------------------------------------
  // loginWithPasskey - Unlock using Passkey OR Local Key (if no passkey)
  // --------------------------------------------------
  const loginWithPasskey = useCallback(async (): Promise<boolean> => {
    const stored = loadWallet();
    if (!stored || !stored.keyJwk) {
      setState(prev => ({ ...prev, error: 'No wallet found' }));
      return false;
    }
    
    try {
      // 1. Authenticate with Passkey (using stored ID or discoverable)
      // Even if stored.passkeyId is missing, we try to authenticate if the user requested "Sign in with Passkey"
      // But for now, we only enforce it if we KNOW there is a passkey, OR if we want to treat "Unlock" as secure.
      // To support "previous passkey" recovery, we always attempt authentication if passkeyId is present OR 
      // if we are in a mode where we want to enforce security.
      
      const credentialId = stored.passkeyId ? [stored.passkeyId] : undefined;
      
      // If we have a passkey ID, we MUST verify it.
      // If we don't, we can optionally verify it (e.g. system lock), but right now we treat no-passkey-id as "unprotected".
      // However, to support the user's request: "it might have been in previous passkey", we can try to prompt.
      
      if (stored.passkeyId) {
         const verified = await PasskeyService.authenticate(credentialId);
         if (!verified) throw new Error('Passkey verification failed');
      } 
      
      // 2. Unlock wallet using the stored AES key
      const key = await importKey(stored.keyJwk);
      const mnemonic = await decryptData(stored.encryptedData, stored.iv, key);
      
      if (!mnemonic) {
        throw new Error('Failed to decrypt wallet');
      }

      return await initializeFromMnemonic(mnemonic, stored.lastChain);
    } catch (err: any) {
      console.error('[WDK] loginWithPasskey error:', err);
      setState(prev => ({ ...prev, error: err.message || 'Unlock failed' }));
      return false;
    }
  }, [initializeFromMnemonic]);

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

      // Persist encrypted with random key
      const key = await generateKey();
      const keyJwk = await exportKey(key);
      const { data: encryptedData, iv } = await encryptData(mnemonic, key);

      const stored: StoredWallet = {
        encryptedData,
        iv,
        keyJwk,
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

    // Persist encrypted with random key
    const address = walletRef.current?.address ?? '';
    const key = await generateKey();
    const keyJwk = await exportKey(key);
    const { data: encryptedData, iv } = await encryptData(mnemonic.trim(), key);

    const stored: StoredWallet = {
      encryptedData,
      iv,
      keyJwk,
      addresses: {},
      lastChain: defaultChain,
    };
    SUPPORTED_CHAINS.forEach(chain => { stored.addresses[chain] = address; });
    saveWallet(stored);

    return true;
  }, [initializeFromMnemonic, defaultChain]);

  // --------------------------------------------------
  // lockWallet (Disconnect from Session)
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
      hasPasskey: !!stored?.passkeyId,
      hasWallet: !!stored
    });
  }, [defaultChain]);

  // --------------------------------------------------
  // unlockWallet
  // --------------------------------------------------
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    // Legacy password flow is deprecated in favor of Passkeys + Random Keys
    console.warn('[WDK] Password unlock is deprecated. Use Passkey.');
    return false;
  }, []);

  // --------------------------------------------------
  // disconnect — Alias for lockWallet (preserve storage)
  // --------------------------------------------------
  const disconnect = useCallback(() => {
    lockWallet();
  }, [lockWallet]);

  // --------------------------------------------------
  // resetWallet — Wipe storage (Factory Reset)
  // --------------------------------------------------
  const resetWallet = useCallback(() => {
    walletRef.current = null;
    mnemonicRef.current = null;
    clearWallet(); // Writes nothing to local storage
    setState({ 
      ...initialState, 
      isLoading: false, 
      chainKey: defaultChain, 
      chainId: WDK_CHAINS[defaultChain]?.chainId ?? null 
    });
  }, [defaultChain]);

  // --------------------------------------------------
  // verifyAction — Secure action with passkey if available
  // --------------------------------------------------
  const verifyAction = useCallback(async (): Promise<boolean> => {
    const stored = loadWallet();
    // Only prompt if a passkey is explicitly registered
    if (stored?.passkeyId) {
      try {
        const verified = await PasskeyService.authenticate([stored.passkeyId]);
        if (!verified) throw new Error('Action denied');
        return true;
      } catch (e: any) {
        console.error('[WDK] Action verification failed:', e);
        setState(prev => ({ ...prev, error: 'Authorization failed' }));
        return false;
      }
    }
    return true; // No passkey, allow action
  }, []);

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
    
    // Verify user presence if passkey enabled
    const allowed = await verifyAction();
    if (!allowed) return null;

    const provider = getProvider(state.chainKey);
    if (!provider) return null;
    const signer = walletRef.current.connect(provider);
    const resp = await signer.sendTransaction({
      to: tx.to,
      value: tx.value ?? 0n,
      data: tx.data,
    });
    return resp.hash;
  }, [state.chainKey, verifyAction]);

  // --------------------------------------------------
  // sendUsdt
  // --------------------------------------------------
  const sendUsdt = useCallback(async (to: string, amount: string): Promise<string | null> => {
    if (!walletRef.current || !state.chainKey) return null;
    
    // Verify user presence if passkey enabled
    const allowed = await verifyAction();
    if (!allowed) return null;

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
  }, [state.chainKey, verifyAction]);

  // --------------------------------------------------
  // signMessage
  // --------------------------------------------------
  const signMessage = useCallback(async (message: string | Uint8Array): Promise<string | null> => {
    if (!walletRef.current) return null;

    // Verify user presence if passkey enabled
    const allowed = await verifyAction();
    if (!allowed) return null;

    try {
      return await walletRef.current.signMessage(message);
    } catch (err: any) {
      console.error('[WDK] signMessage failed:', err);
      return null;
    }
  }, [verifyAction]);

  // --------------------------------------------------
  // signTypedData (EIP-712)
  // --------------------------------------------------
  const signTypedData = useCallback(async (domain: any, types: any, value: any): Promise<string | null> => {
    if (!walletRef.current) return null;

    // Verify user presence if passkey enabled
    const allowed = await verifyAction();
    if (!allowed) return null;

    try {
      return await walletRef.current.signTypedData(domain, types, value);
    } catch (err: any) {
      console.error('[WDK] signTypedData failed:', err);
      return null;
    }
  }, [verifyAction]);

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
    resetWallet,
    registerPasskey,
    loginWithPasskey,
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
