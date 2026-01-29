'use client';

import { ReactNode, createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { 
  createNetworkConfig, 
  SuiClientProvider, 
  WalletProvider,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
  useCurrentWallet,
  useConnectWallet,
  useDisconnectWallet,
  useWallets,
} from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getSuiContractAddresses, type NetworkType } from '../lib/contracts/addresses';
import '@mysten/dapp-kit/dist/index.css';

// ============================================
// SUI NETWORK CONFIGURATION
// ============================================

const { networkConfig } = createNetworkConfig({
  localnet: { url: getFullnodeUrl('localnet') },
  devnet: { url: getFullnodeUrl('devnet') },
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 3,
      staleTime: 60_000,
      gcTime: 300_000,
    },
  },
});

// ============================================
// SUI CONTEXT TYPES
// ============================================

interface SuiContextType {
  // Network
  network: NetworkType;
  setNetwork: (network: NetworkType) => void;
  
  // Wallet
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  
  // Balances
  balance: string;
  balanceRaw: bigint;
  
  // Contract addresses
  contractAddresses: ReturnType<typeof getSuiContractAddresses>;
  
  // Actions
  connectWallet: () => void;
  disconnectWallet: () => void;
  
  // Transactions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeTransaction: (tx: any) => Promise<{ digest: string; success: boolean }>;
  
  // Utilities
  getExplorerUrl: (type: 'tx' | 'address' | 'object', value: string) => string;
  requestFaucetTokens: () => Promise<{ success: boolean; message: string }>;
}

const SuiContext = createContext<SuiContextType | null>(null);

// ============================================
// SUI HOOKS
// ============================================

/**
 * Hook to use Sui context
 */
export function useSui(): SuiContextType {
  const context = useContext(SuiContext);
  if (!context) {
    throw new Error('useSui must be used within SuiWalletProviders');
  }
  return context;
}

// ============================================
// INTERNAL CONTEXT PROVIDER
// ============================================

function SuiContextProvider({ 
  children, 
  network, 
  setNetwork 
}: { 
  children: ReactNode; 
  network: NetworkType;
  setNetwork: (n: NetworkType) => void;
}) {
  const [balance, setBalance] = useState('0');
  const [balanceRaw, setBalanceRaw] = useState<bigint>(BigInt(0));
  
  const account = useCurrentAccount();
  const { currentWallet, connectionStatus } = useCurrentWallet();
  const { mutate: connect, isPending: isConnecting } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();
  const wallets = useWallets();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const address = account?.address ?? null;
  const isConnected = connectionStatus === 'connected' && !!address;

  // Fetch balance when address changes
  useEffect(() => {
    async function fetchBalance() {
      if (!address) {
        setBalance('0');
        setBalanceRaw(BigInt(0));
        return;
      }

      try {
        const balanceResult = await suiClient.getBalance({
          owner: address,
          coinType: '0x2::sui::SUI',
        });
        
        const rawBalance = BigInt(balanceResult.totalBalance);
        setBalanceRaw(rawBalance);
        // SUI has 9 decimals
        setBalance((Number(rawBalance) / 1e9).toFixed(4));
      } catch (error) {
        console.error('[SuiProvider] Failed to fetch balance:', error);
        setBalance('0');
        setBalanceRaw(BigInt(0));
      }
    }

    fetchBalance();
    
    // Refresh balance every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [address, suiClient]);

  const connectWallet = useCallback(() => {
    // Try to connect to the first available wallet
    const availableWallet = wallets[0];
    if (availableWallet) {
      connect({ wallet: availableWallet });
    } else {
      console.error('[SuiProvider] No wallets available');
    }
  }, [connect, wallets]);

  const disconnectWallet = useCallback(() => {
    disconnect();
  }, [disconnect]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executeTransaction = useCallback(async (tx: any): Promise<{ digest: string; success: boolean }> => {
    if (!isConnected) {
      throw new Error('Wallet not connected');
    }

    try {
      const result = await signAndExecute({
        transaction: tx,
      });

      return {
        digest: result.digest,
        success: true,
      };
    } catch (error: any) {
      console.error('[SuiProvider] Transaction failed:', error);
      return {
        digest: '',
        success: false,
      };
    }
  }, [isConnected, signAndExecute]);

  const getExplorerUrl = useCallback((type: 'tx' | 'address' | 'object', value: string): string => {
    const baseUrl = network === 'mainnet' 
      ? 'https://suiexplorer.com'
      : `https://suiexplorer.com/?network=${network}`;
    
    switch (type) {
      case 'tx':
        return `${baseUrl}/txblock/${value}`;
      case 'address':
        return `${baseUrl}/address/${value}`;
      case 'object':
        return `${baseUrl}/object/${value}`;
      default:
        return baseUrl;
    }
  }, [network]);

  const requestFaucetTokens = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!address) {
      return { success: false, message: 'Wallet not connected' };
    }

    if (network === 'mainnet') {
      return { success: false, message: 'Faucet not available on mainnet' };
    }

    try {
      const faucetUrl = network === 'devnet' 
        ? 'https://faucet.devnet.sui.io/v1/gas'
        : 'https://faucet.testnet.sui.io/v1/gas';

      const response = await fetch(faucetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FixedAmountRequest: {
            recipient: address,
          },
        }),
      });

      if (response.ok) {
        return { success: true, message: 'Tokens requested successfully! Check your balance in a moment.' };
      } else {
        const error = await response.text();
        return { success: false, message: `Faucet request failed: ${error}` };
      }
    } catch (error: any) {
      return { success: false, message: `Faucet request failed: ${error.message}` };
    }
  }, [address, network]);

  const contractAddresses = useMemo(() => getSuiContractAddresses(network), [network]);

  const contextValue: SuiContextType = useMemo(() => ({
    network,
    setNetwork,
    address,
    isConnected,
    isConnecting,
    balance,
    balanceRaw,
    contractAddresses,
    connectWallet,
    disconnectWallet,
    executeTransaction,
    getExplorerUrl,
    requestFaucetTokens,
  }), [
    network,
    setNetwork,
    address,
    isConnected,
    isConnecting,
    balance,
    balanceRaw,
    contractAddresses,
    connectWallet,
    disconnectWallet,
    executeTransaction,
    getExplorerUrl,
    requestFaucetTokens,
  ]);

  return (
    <SuiContext.Provider value={contextValue}>
      {children}
    </SuiContext.Provider>
  );
}

// ============================================
// MAIN PROVIDER
// ============================================

interface SuiWalletProvidersProps {
  children: ReactNode;
  defaultNetwork?: NetworkType;
}

export function SuiWalletProviders({ 
  children,
  defaultNetwork = 'testnet',
}: SuiWalletProvidersProps) {
  const [network, setNetwork] = useState<NetworkType>(defaultNetwork);

  const suiNetwork = network === 'mainnet' ? 'mainnet' : network === 'devnet' ? 'devnet' : 'testnet';

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={suiNetwork}>
        <WalletProvider autoConnect>
          <SuiContextProvider network={network} setNetwork={setNetwork}>
            {children}
          </SuiContextProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

// ============================================
// EXPORTS
// ============================================

export { 
  useCurrentAccount as useSuiAccount,
  useSuiClient,
  useSignAndExecuteTransaction as useSuiTransaction,
};
