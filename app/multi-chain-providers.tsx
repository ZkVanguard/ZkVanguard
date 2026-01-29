'use client';

import { ReactNode, createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { WalletProviders } from './wallet-providers';
import { SuiWalletProviders, useSui } from './sui-providers';
import { ChainType, getChainInfo, NetworkType } from '../lib/contracts/addresses';
import { useAccount, useChainId } from 'wagmi';

// ============================================
// MULTI-CHAIN CONTEXT TYPES
// ============================================

interface MultiChainContextType {
  // Active chain
  activeChain: ChainType;
  setActiveChain: (chain: ChainType) => void;
  
  // Network
  network: NetworkType;
  setNetwork: (network: NetworkType) => void;
  
  // Wallet state
  isConnected: boolean;
  address: string | null;
  balance: string;
  
  // Chain-specific states
  evmChainId: number | null;
  suiNetwork: NetworkType;
  
  // Utilities
  getExplorerUrl: (type: 'tx' | 'address', value: string) => string;
  switchChain: (chain: ChainType) => void;
}

const MultiChainContext = createContext<MultiChainContextType | null>(null);

// ============================================
// MULTI-CHAIN HOOK
// ============================================

export function useMultiChain(): MultiChainContextType {
  const context = useContext(MultiChainContext);
  if (!context) {
    throw new Error('useMultiChain must be used within MultiChainProviders');
  }
  return context;
}

// ============================================
// INTERNAL MULTI-CHAIN PROVIDER
// ============================================

function MultiChainContextProvider({ children }: { children: ReactNode }) {
  const [activeChain, setActiveChain] = useState<ChainType>('sui'); // Default to SUI for testnet
  const [network, setNetwork] = useState<NetworkType>('testnet');
  
  // EVM (Cronos) wallet state
  const evmChainId = useChainId();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  
  // SUI wallet state
  const sui = useSui();
  
  // Determine active connection based on chain
  const isConnected = activeChain === 'sui' ? sui.isConnected : evmConnected;
  const address = activeChain === 'sui' ? sui.address : evmAddress ?? null;
  const balance = activeChain === 'sui' ? sui.balance : '0'; // EVM balance handled separately

  // Get explorer URL based on active chain
  const getExplorerUrl = useCallback((type: 'tx' | 'address', value: string): string => {
    if (activeChain === 'sui') {
      return sui.getExplorerUrl(type, value);
    }
    
    // EVM (Cronos) explorer
    const baseUrl = network === 'mainnet' 
      ? 'https://explorer.cronos.org'
      : 'https://explorer.cronos.org/testnet';
    
    switch (type) {
      case 'tx':
        return `${baseUrl}/tx/${value}`;
      case 'address':
        return `${baseUrl}/address/${value}`;
      default:
        return baseUrl;
    }
  }, [activeChain, network, sui]);

  // Switch active chain
  const switchChain = useCallback((chain: ChainType) => {
    setActiveChain(chain);
    // If switching to SUI testnet
    if (chain === 'sui') {
      sui.setNetwork(network);
    }
  }, [network, sui]);

  // Sync network when changed
  useEffect(() => {
    if (activeChain === 'sui') {
      sui.setNetwork(network);
    }
  }, [network, activeChain, sui]);

  const contextValue: MultiChainContextType = useMemo(() => ({
    activeChain,
    setActiveChain,
    network,
    setNetwork,
    isConnected,
    address,
    balance,
    evmChainId,
    suiNetwork: sui.network,
    getExplorerUrl,
    switchChain,
  }), [
    activeChain,
    network,
    isConnected,
    address,
    balance,
    evmChainId,
    sui.network,
    getExplorerUrl,
    switchChain,
  ]);

  return (
    <MultiChainContext.Provider value={contextValue}>
      {children}
    </MultiChainContext.Provider>
  );
}

// ============================================
// MAIN MULTI-CHAIN PROVIDER
// ============================================

interface MultiChainProvidersProps {
  children: ReactNode;
  defaultChain?: ChainType;
  defaultNetwork?: NetworkType;
}

/**
 * Multi-chain wallet providers for Cronos (EVM) and SUI
 * Wraps both wallet ecosystems and provides unified context
 */
export function MultiChainProviders({ 
  children,
  defaultChain = 'sui',
  defaultNetwork = 'testnet',
}: MultiChainProvidersProps) {
  return (
    <WalletProviders>
      <SuiWalletProviders defaultNetwork={defaultNetwork}>
        <MultiChainContextProvider>
          {children}
        </MultiChainContextProvider>
      </SuiWalletProviders>
    </WalletProviders>
  );
}

// ============================================
// CHAIN SELECTOR COMPONENT
// ============================================

interface ChainSelectorProps {
  className?: string;
}

export function ChainSelector({ className = '' }: ChainSelectorProps) {
  const { activeChain, setActiveChain, network, setNetwork } = useMultiChain();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Chain Toggle */}
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <button
          onClick={() => setActiveChain('sui')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            activeChain === 'sui'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          SUI
        </button>
        <button
          onClick={() => setActiveChain('evm')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            activeChain === 'evm'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          Cronos
        </button>
      </div>

      {/* Network Selector */}
      <select
        value={network}
        onChange={(e) => setNetwork(e.target.value as NetworkType)}
        className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm border-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
        {activeChain === 'sui' && <option value="devnet">Devnet</option>}
      </select>
    </div>
  );
}

// ============================================
// RE-EXPORTS
// ============================================

export { useSui } from './sui-providers';
export { WalletProviders } from './wallet-providers';
