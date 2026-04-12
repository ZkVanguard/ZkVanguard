'use client';

import { ReactNode, createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/utils/logger';
import { 
  createNetworkConfig, 
  SuiClientProvider, 
  WalletProvider,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSignTransaction,
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
  isWrongNetwork: boolean;
  walletNetwork: string | null;
  
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
  executeTransaction: (tx: unknown) => Promise<{ digest: string; success: boolean }>;
  signTransaction: (txBytes: Uint8Array) => Promise<{ signature: string }>;
  sponsoredExecute: (tx: unknown) => Promise<{ digest: string; success: boolean }>;
  
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
 * @throws Error if used outside SuiWalletProviders
 */
export function useSui(): SuiContextType {
  const context = useContext(SuiContext);
  if (!context) {
    throw new Error('useSui must be used within SuiWalletProviders');
  }
  return context;
}

/**
 * Safe hook to use Sui context - returns null if not in provider
 * Use this for components that may be rendered outside SuiWalletProviders
 */
export function useSuiSafe(): SuiContextType | null {
  return useContext(SuiContext);
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
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);

  // Mounted guard: @mysten/dapp-kit uses Zustand persist middleware that
  // synchronously restores wallet state from localStorage during store init.
  // Server has empty in-memory store → disconnected; client has persisted
  // state → possibly connected.  Without this guard the initial client render
  // differs from the server-rendered HTML → React #301.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  
  // Always call hooks (rules of hooks), but gate their return values
  const rawAccount = useCurrentAccount();
  const rawWalletState = useCurrentWallet();
  const { mutate: connect, isPending: isConnecting } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();
  const wallets = useWallets();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { mutateAsync: walletSignTx } = useSignTransaction();

  // Until mounted, present the same "disconnected" state the server rendered
  const account = mounted ? rawAccount : null;
  const connectionStatus = mounted ? rawWalletState.connectionStatus : 'disconnected';
  const _currentWallet = mounted ? rawWalletState.currentWallet : null;

  const address = account?.address ?? null;
  const isConnected = connectionStatus === 'connected' && !!address;

  // Detect wallet network and check for mismatches
  useEffect(() => {
    async function detectWalletNetwork() {
      if (!account || !isConnected) {
        setWalletNetwork(null);
        setIsWrongNetwork(false);
        return;
      }

      try {
        // Check the account's chains to detect wallet network
        // SUI wallet accounts report their chain as 'sui:mainnet', 'sui:testnet', etc.
        const accountChains = account.chains || [];
        let detectedNetwork: string | null = null;

        for (const chain of accountChains) {
          if (chain.includes('mainnet')) {
            detectedNetwork = 'mainnet';
            break;
          } else if (chain.includes('testnet')) {
            detectedNetwork = 'testnet';
            break;
          } else if (chain.includes('devnet')) {
            detectedNetwork = 'devnet';
            break;
          }
        }

        // If no chains reported, try to detect via RPC by checking chain identifier
        if (!detectedNetwork && address) {
          try {
            const chainId = await suiClient.getChainIdentifier();
            // Chain identifiers: mainnet = specific hash, testnet & devnet have their own
            // Use a simple heuristic based on common patterns
            if (chainId) {
              // Known chain identifiers (these may change, but pattern remains)
              // mainnet: "35834a8a", testnet: "4c78adac", devnet changes frequently
              const mainnetId = '35834a8a';
              const testnetId = '4c78adac';
              
              if (chainId === mainnetId) {
                detectedNetwork = 'mainnet';
              } else if (chainId === testnetId) {
                detectedNetwork = 'testnet';
              } else {
                detectedNetwork = 'devnet'; // Assume devnet for unknown
              }
            }
          } catch {
            // RPC detection failed, fallback to assuming correct network
            logger.debug('Could not detect SUI chain via RPC', { component: 'SuiProvider' });
          }
        }

        setWalletNetwork(detectedNetwork);
        
        // Check if wallet network matches app's expected network
        if (detectedNetwork && detectedNetwork !== network) {
          logger.warn('SUI wallet network mismatch', { 
            component: 'SuiProvider', 
            data: { walletNetwork: detectedNetwork, appNetwork: network } 
          });
          setIsWrongNetwork(true);
        } else {
          setIsWrongNetwork(false);
        }
      } catch (error) {
        logger.error('Failed to detect wallet network', error instanceof Error ? error : undefined, { component: 'SuiProvider' });
        setIsWrongNetwork(false);
      }
    }

    detectWalletNetwork();
  }, [account, isConnected, network, address, suiClient]);

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
        logger.error('Failed to fetch balance', error instanceof Error ? error : undefined, { component: 'SuiProvider' });
        setBalance('0');
        setBalanceRaw(BigInt(0));
      }
    }

    fetchBalance();
    
    // Refresh balance every 30 seconds — only when tab is visible
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!interval) interval = setInterval(fetchBalance, 30000); };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVis = () => document.hidden ? stop() : start();
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [address, suiClient]);

  const connectWallet = useCallback(() => {
    // Try to connect to the first available wallet
    const availableWallet = wallets[0];
    if (availableWallet) {
      connect({ wallet: availableWallet });
    } else {
      logger.error('No wallets available', undefined, { component: 'SuiProvider' });
    }
  }, [connect, wallets]);

  const disconnectWallet = useCallback(() => {
    // Clear stale balance/state before disconnect
    setBalance('0');
    setBalanceRaw(BigInt(0));
    disconnect();
  }, [disconnect]);

  const executeTransaction = useCallback(async (tx: unknown): Promise<{ digest: string; success: boolean }> => {
    if (!isConnected) {
      throw new Error('Wallet not connected');
    }

    // SECURITY: Block transactions when wallet is on wrong network
    if (isWrongNetwork) {
      const msg = `Transaction blocked: wallet is on ${walletNetwork || 'unknown'} but app expects ${network}. Please switch your wallet network.`;
      logger.error(msg, undefined, { component: 'SuiProvider' });
      throw new Error(msg);
    }

    try {
      const result = await signAndExecute({
        transaction: tx as Parameters<typeof signAndExecute>[0]['transaction'],
      });

      return {
        digest: result.digest,
        success: true,
      };
    } catch (error: unknown) {
      logger.error('Transaction failed', error instanceof Error ? error : undefined, { component: 'SuiProvider' });
      // Distinguish user rejection from other errors
      const message = error instanceof Error ? error.message : String(error);
      const isUserRejection = message.includes('Rejected') || message.includes('User rejected') || message.includes('cancelled');
      return {
        digest: '',
        success: false,
        ...(isUserRejection ? {} : { error: message }),
      } as { digest: string; success: boolean };
    }
  }, [isConnected, isWrongNetwork, walletNetwork, network, signAndExecute]);

  // Sign-only: user signs pre-built transaction bytes (for sponsored txs)
  const signTransaction = useCallback(async (txBytes: Uint8Array): Promise<{ signature: string }> => {
    if (!isConnected) throw new Error('Wallet not connected');
    if (isWrongNetwork) throw new Error(`Wrong network: wallet is on ${walletNetwork || 'unknown'}, app expects ${network}`);

    const result = await walletSignTx({ transaction: txBytes });
    return { signature: result.signature };
  }, [isConnected, isWrongNetwork, walletNetwork, network, walletSignTx]);

  // Sponsored execute: builds tx → sends to admin sponsor → user signs → submit with both sigs
  const sponsoredExecute = useCallback(async (tx: unknown): Promise<{ digest: string; success: boolean }> => {
    if (!isConnected || !address) throw new Error('Wallet not connected');
    if (isWrongNetwork) throw new Error(`Wrong network: wallet is on ${walletNetwork || 'unknown'}, app expects ${network}`);

    try {
      const { Transaction } = await import('@mysten/sui/transactions');
      const txObj = tx as InstanceType<typeof Transaction>;

      // Serialize the transaction (unbuilt — sponsor endpoint will build it)
      const txBytes = await txObj.build({ client: suiClient });
      const txBase64 = Buffer.from(txBytes).toString('base64');

      // Ask admin to sponsor gas
      const sponsorRes = await fetch('/api/sui/sponsor-gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txBytes: txBase64, sender: address }),
      });
      const sponsorData = await sponsorRes.json();
      if (!sponsorRes.ok || !sponsorData.success) {
        throw new Error(sponsorData.error || 'Gas sponsoring failed');
      }

      // Decode the sponsored tx bytes
      const sponsoredTxBytes = new Uint8Array(Buffer.from(sponsorData.txBytes, 'base64'));

      // User signs the sponsored transaction
      const userSig = await walletSignTx({ transaction: sponsoredTxBytes });

      // Execute with both signatures (user + sponsor)
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: sponsoredTxBytes,
        signature: [userSig.signature, sponsorData.sponsorSignature],
        options: { showEffects: true },
      });

      const success = result.effects?.status?.status === 'success';
      return { digest: result.digest, success };
    } catch (error: unknown) {
      logger.error('Sponsored transaction failed', error instanceof Error ? error : undefined, { component: 'SuiProvider' });
      const message = error instanceof Error ? error.message : String(error);
      const isUserRejection = message.includes('Rejected') || message.includes('User rejected') || message.includes('cancelled');
      return {
        digest: '',
        success: false,
        ...(isUserRejection ? {} : { error: message }),
      } as { digest: string; success: boolean };
    }
  }, [isConnected, isWrongNetwork, walletNetwork, network, address, suiClient, walletSignTx]);

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
    } catch (error: unknown) {
      return { success: false, message: `Faucet request failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }, [address, network]);

  const contractAddresses = useMemo(() => getSuiContractAddresses(network), [network]);

  const contextValue: SuiContextType = useMemo(() => ({
    network,
    setNetwork,
    isWrongNetwork,
    walletNetwork,
    address,
    isConnected,
    isConnecting,
    balance,
    balanceRaw,
    contractAddresses,
    connectWallet,
    disconnectWallet,
    executeTransaction,
    signTransaction,
    sponsoredExecute,
    getExplorerUrl,
    requestFaucetTokens,
  }), [
    network,
    setNetwork,
    isWrongNetwork,
    walletNetwork,
    address,
    isConnected,
    isConnecting,
    balance,
    balanceRaw,
    contractAddresses,
    connectWallet,
    disconnectWallet,
    executeTransaction,
    signTransaction,
    sponsoredExecute,
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
  /** Set to true when already inside a QueryClientProvider */
  skipQueryProvider?: boolean;
}

// Get default network from environment variable
const getDefaultSuiNetwork = (): NetworkType => {
  const envNetwork = process.env.NEXT_PUBLIC_SUI_NETWORK || process.env.SUI_NETWORK || 'mainnet';
  if (envNetwork === 'mainnet' || envNetwork === 'testnet' || envNetwork === 'devnet') {
    return envNetwork as NetworkType;
  }
  return 'mainnet';
};

export function SuiWalletProviders({ 
  children,
  defaultNetwork = getDefaultSuiNetwork(),
  skipQueryProvider = false,
}: SuiWalletProvidersProps) {
  const [network, setNetwork] = useState<NetworkType>(defaultNetwork);

  const suiNetwork = network === 'mainnet' ? 'mainnet' : network === 'devnet' ? 'devnet' : 'testnet';

  const content = (
    <SuiClientProvider networks={networkConfig} defaultNetwork={suiNetwork}>
      <WalletProvider autoConnect>
        <SuiContextProvider network={network} setNetwork={setNetwork}>
          {children}
        </SuiContextProvider>
      </WalletProvider>
    </SuiClientProvider>
  );

  if (skipQueryProvider) {
    return content;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {content}
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
