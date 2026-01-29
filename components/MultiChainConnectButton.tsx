'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount as useWagmiAccount, useDisconnect as useWagmiDisconnect } from 'wagmi';
import { Wallet, ChevronDown, ExternalLink, Copy, Check, LogOut } from 'lucide-react';

// ============================================
// MULTI-CHAIN WALLET CONTEXT
// ============================================

type ChainType = 'evm' | 'sui';

interface MultiWalletContextType {
  activeChain: ChainType;
  setActiveChain: (chain: ChainType) => void;
  evmAddress: string | null;
  suiAddress: string | null;
  isEvmConnected: boolean;
  isSuiConnected: boolean;
  isAnyConnected: boolean;
}

const MultiWalletContext = createContext<MultiWalletContextType | null>(null);

export function useMultiWallet() {
  const context = useContext(MultiWalletContext);
  if (!context) {
    // Return defaults if not in provider
    return {
      activeChain: 'evm' as ChainType,
      setActiveChain: () => {},
      evmAddress: null,
      suiAddress: null,
      isEvmConnected: false,
      isSuiConnected: false,
      isAnyConnected: false,
    };
  }
  return context;
}

// ============================================
// MULTI-WALLET PROVIDER
// ============================================

interface MultiWalletProviderProps {
  children: ReactNode;
  defaultChain?: ChainType;
}

export function MultiWalletProvider({ children, defaultChain = 'evm' }: MultiWalletProviderProps) {
  const [activeChain, setActiveChain] = useState<ChainType>(defaultChain);
  const [suiAddress, setSuiAddress] = useState<string | null>(null);
  const [isSuiConnected, setIsSuiConnected] = useState(false);

  // Get EVM connection status from wagmi
  const { address: evmAddress, isConnected: isEvmConnected } = useWagmiAccount();

  // Check for Sui wallet connection (client-side only)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkSuiWallet = async () => {
      try {
        // Check if Sui wallet is available
        const suiWallet = (window as unknown as { suiWallet?: { getAccounts?: () => Promise<string[]> } }).suiWallet;
        if (suiWallet?.getAccounts) {
          const accounts = await suiWallet.getAccounts();
          if (accounts && accounts.length > 0) {
            setSuiAddress(accounts[0]);
            setIsSuiConnected(true);
          }
        }
      } catch {
        // Sui wallet not available or not connected
      }
    };

    checkSuiWallet();
    
    // Listen for account changes
    const interval = setInterval(checkSuiWallet, 5000);
    return () => clearInterval(interval);
  }, []);

  const value: MultiWalletContextType = {
    activeChain,
    setActiveChain,
    evmAddress: evmAddress || null,
    suiAddress,
    isEvmConnected,
    isSuiConnected,
    isAnyConnected: isEvmConnected || isSuiConnected,
  };

  return (
    <MultiWalletContext.Provider value={value}>
      {children}
    </MultiWalletContext.Provider>
  );
}

// ============================================
// UNIFIED CONNECT BUTTON COMPONENT
// ============================================

interface UnifiedConnectButtonProps {
  className?: string;
}

export function UnifiedConnectButton({ className = '' }: UnifiedConnectButtonProps) {
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const { activeChain, setActiveChain, evmAddress, suiAddress, isEvmConnected, isSuiConnected } = useMultiWallet();
  const { disconnect: disconnectEvm } = useWagmiDisconnect();

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // If neither wallet is connected, show connection options
  if (!isEvmConnected && !isSuiConnected) {
    return (
      <div className={`relative ${className}`}>
        <button
          onClick={() => setShowWalletSelector(!showWalletSelector)}
          className="px-5 h-11 bg-[#007AFF] hover:opacity-90 active:opacity-80 text-white rounded-[12px] font-semibold text-[16px] transition-opacity flex items-center gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
        >
          <Wallet className="w-4 h-4" />
          <span>Connect Wallet</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showWalletSelector ? 'rotate-180' : ''}`} />
        </button>

        {showWalletSelector && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowWalletSelector(false)} />
            <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-[#E5E5EA] rounded-2xl shadow-2xl overflow-hidden z-50">
              <div className="p-4 border-b border-[#E5E5EA]">
                <h3 className="text-lg font-semibold text-[#1D1D1F]">Connect Wallet</h3>
                <p className="text-sm text-[#86868B] mt-1">Choose your preferred blockchain</p>
              </div>

              <div className="p-3 space-y-2">
                {/* EVM Option */}
                <div className="p-3 rounded-xl border border-[#E5E5EA] hover:border-[#007AFF] transition-colors">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#002D74] to-[#0052CC] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">CRO</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1D1D1F]">Cronos (EVM)</div>
                      <div className="text-xs text-[#86868B]">MetaMask, WalletConnect, etc.</div>
                    </div>
                  </div>
                  <RainbowConnectButton.Custom>
                    {({ openConnectModal }) => (
                      <button
                        onClick={() => {
                          setActiveChain('evm');
                          openConnectModal();
                          setShowWalletSelector(false);
                        }}
                        className="w-full py-2.5 bg-[#007AFF] hover:opacity-90 text-white rounded-lg font-medium text-sm transition-opacity"
                      >
                        Connect EVM Wallet
                      </button>
                    )}
                  </RainbowConnectButton.Custom>
                </div>

                {/* SUI Option */}
                <div className="p-3 rounded-xl border border-[#E5E5EA] hover:border-[#4DA2FF] transition-colors">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#4DA2FF] to-[#6FBCFF] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">SUI</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1D1D1F]">SUI (Move)</div>
                      <div className="text-xs text-[#86868B]">Sui Wallet, Ethos, Martian</div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setActiveChain('sui');
                      // Open Sui wallet connection
                      connectSuiWallet();
                      setShowWalletSelector(false);
                    }}
                    className="w-full py-2.5 bg-[#4DA2FF] hover:opacity-90 text-white rounded-lg font-medium text-sm transition-opacity"
                  >
                    Connect SUI Wallet
                  </button>
                </div>
              </div>

              <div className="p-3 border-t border-[#E5E5EA] bg-[#F5F5F7]">
                <p className="text-xs text-[#86868B] text-center">
                  Connect to both chains for full multi-chain support
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Show connected wallet(s)
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setShowWalletSelector(!showWalletSelector)}
        className="px-4 h-11 bg-[#f5f5f7] hover:bg-[#e5e5ea] border border-black/10 rounded-[12px] transition-colors flex items-center gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
      >
        {/* Show connected chain indicators */}
        <div className="flex items-center -space-x-1">
          {isEvmConnected && (
            <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#002D74] to-[#0052CC] flex items-center justify-center border-2 border-white">
              <span className="text-white font-bold text-[8px]">CRO</span>
            </div>
          )}
          {isSuiConnected && (
            <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#4DA2FF] to-[#6FBCFF] flex items-center justify-center border-2 border-white">
              <span className="text-white font-bold text-[8px]">SUI</span>
            </div>
          )}
        </div>
        
        <span className="text-[#1d1d1f] font-medium text-[14px]">
          {activeChain === 'evm' && evmAddress && truncateAddress(evmAddress)}
          {activeChain === 'sui' && suiAddress && truncateAddress(suiAddress)}
          {!evmAddress && !suiAddress && 'Connected'}
        </span>
        
        <ChevronDown className={`w-4 h-4 text-[#86868B] transition-transform ${showWalletSelector ? 'rotate-180' : ''}`} />
      </button>

      {showWalletSelector && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowWalletSelector(false)} />
          <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-[#E5E5EA] rounded-2xl shadow-2xl overflow-hidden z-50">
            <div className="p-4 border-b border-[#E5E5EA]">
              <h3 className="text-lg font-semibold text-[#1D1D1F]">Connected Wallets</h3>
            </div>

            <div className="p-3 space-y-2">
              {/* EVM Wallet */}
              {isEvmConnected && evmAddress && (
                <div 
                  className={`p-3 rounded-xl border transition-colors cursor-pointer ${
                    activeChain === 'evm' 
                      ? 'border-[#007AFF] bg-[#007AFF]/5' 
                      : 'border-[#E5E5EA] hover:border-[#007AFF]/50'
                  }`}
                  onClick={() => setActiveChain('evm')}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#002D74] to-[#0052CC] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">CRO</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#1D1D1F]">Cronos</span>
                        {activeChain === 'evm' && (
                          <span className="text-xs px-1.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] rounded-full">Active</span>
                        )}
                      </div>
                      <div className="text-sm text-[#86868B] font-mono truncate">{truncateAddress(evmAddress)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); copyAddress(evmAddress); }}
                        className="p-1.5 hover:bg-[#F5F5F7] rounded-lg transition-colors"
                        title="Copy address"
                      >
                        {copiedAddress ? <Check className="w-4 h-4 text-[#34C759]" /> : <Copy className="w-4 h-4 text-[#86868B]" />}
                      </button>
                      <a
                        href={`https://explorer.cronos.org/testnet/address/${evmAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 hover:bg-[#F5F5F7] rounded-lg transition-colors"
                        title="View on explorer"
                      >
                        <ExternalLink className="w-4 h-4 text-[#86868B]" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* SUI Wallet */}
              {isSuiConnected && suiAddress && (
                <div 
                  className={`p-3 rounded-xl border transition-colors cursor-pointer ${
                    activeChain === 'sui' 
                      ? 'border-[#4DA2FF] bg-[#4DA2FF]/5' 
                      : 'border-[#E5E5EA] hover:border-[#4DA2FF]/50'
                  }`}
                  onClick={() => setActiveChain('sui')}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#4DA2FF] to-[#6FBCFF] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">SUI</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#1D1D1F]">SUI</span>
                        {activeChain === 'sui' && (
                          <span className="text-xs px-1.5 py-0.5 bg-[#4DA2FF]/10 text-[#4DA2FF] rounded-full">Active</span>
                        )}
                      </div>
                      <div className="text-sm text-[#86868B] font-mono truncate">{truncateAddress(suiAddress)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); copyAddress(suiAddress); }}
                        className="p-1.5 hover:bg-[#F5F5F7] rounded-lg transition-colors"
                        title="Copy address"
                      >
                        {copiedAddress ? <Check className="w-4 h-4 text-[#34C759]" /> : <Copy className="w-4 h-4 text-[#86868B]" />}
                      </button>
                      <a
                        href={`https://suiscan.xyz/testnet/address/${suiAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 hover:bg-[#F5F5F7] rounded-lg transition-colors"
                        title="View on explorer"
                      >
                        <ExternalLink className="w-4 h-4 text-[#86868B]" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Connect additional wallet */}
              {(!isEvmConnected || !isSuiConnected) && (
                <div className="pt-2 border-t border-[#E5E5EA]">
                  <p className="text-xs text-[#86868B] mb-2">Connect additional wallet:</p>
                  {!isEvmConnected && (
                    <RainbowConnectButton.Custom>
                      {({ openConnectModal }) => (
                        <button
                          onClick={() => {
                            setActiveChain('evm');
                            openConnectModal();
                          }}
                          className="w-full py-2 text-sm text-[#007AFF] hover:bg-[#007AFF]/5 rounded-lg transition-colors"
                        >
                          + Connect Cronos Wallet
                        </button>
                      )}
                    </RainbowConnectButton.Custom>
                  )}
                  {!isSuiConnected && (
                    <button
                      onClick={() => {
                        setActiveChain('sui');
                        connectSuiWallet();
                      }}
                      className="w-full py-2 text-sm text-[#4DA2FF] hover:bg-[#4DA2FF]/5 rounded-lg transition-colors"
                    >
                      + Connect SUI Wallet
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Disconnect section */}
            <div className="p-3 border-t border-[#E5E5EA] bg-[#F5F5F7]">
              <button
                onClick={() => {
                  if (isEvmConnected) disconnectEvm();
                  if (isSuiConnected) disconnectSuiWallet();
                  setShowWalletSelector(false);
                }}
                className="w-full py-2 text-sm text-[#FF3B30] hover:bg-[#FF3B30]/5 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Disconnect All Wallets
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// SUI WALLET HELPERS
// ============================================

async function connectSuiWallet() {
  if (typeof window === 'undefined') return;

  try {
    // Check for Sui Wallet
    const suiWallet = (window as unknown as { 
      suiWallet?: { 
        requestPermissions?: () => Promise<boolean>;
        connect?: () => Promise<{ accounts: string[] }>;
      } 
    }).suiWallet;

    if (suiWallet) {
      if (suiWallet.requestPermissions) {
        await suiWallet.requestPermissions();
      } else if (suiWallet.connect) {
        await suiWallet.connect();
      }
      return;
    }

    // Check for Ethos wallet
    const ethosWallet = (window as unknown as { 
      ethosWallet?: { 
        connect?: () => Promise<void>;
      } 
    }).ethosWallet;

    if (ethosWallet?.connect) {
      await ethosWallet.connect();
      return;
    }

    // No Sui wallet found, open installation page
    window.open('https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil', '_blank');
  } catch (error) {
    console.error('Failed to connect Sui wallet:', error);
  }
}

function disconnectSuiWallet() {
  if (typeof window === 'undefined') return;

  try {
    const suiWallet = (window as unknown as { 
      suiWallet?: { 
        disconnect?: () => Promise<void>;
      } 
    }).suiWallet;

    if (suiWallet?.disconnect) {
      suiWallet.disconnect();
    }
  } catch (error) {
    console.error('Failed to disconnect Sui wallet:', error);
  }
}

// Export the original ConnectButton for backward compatibility
export { UnifiedConnectButton as MultiChainConnectButton };
