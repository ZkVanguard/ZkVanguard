'use client';

import { useState, useEffect } from 'react';
import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit';
import { Wallet, ChevronDown, ExternalLink, Copy, Check, LogOut } from 'lucide-react';
import { 
  useWallets, 
  useCurrentAccount, 
  useConnectWallet, 
  useDisconnectWallet, 
  useCurrentWallet,
} from '@mysten/dapp-kit';

// Safe hook wrapper for Sui wallet functionality
function useSuiWalletSafe() {
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  // Call hooks unconditionally (required by React rules)
  let wallets: any[] = [];
  let suiAccount: any = null;
  let currentWallet: any = null;
  let connectionStatus = 'disconnected';
  let connectSui: any = () => {};
  let disconnectSui: any = () => {};
  let isConnectingSui = false;

  try {
    wallets = useWallets() || [];
    suiAccount = useCurrentAccount();
    const walletState = useCurrentWallet();
    currentWallet = walletState?.currentWallet || null;
    connectionStatus = walletState?.connectionStatus || 'disconnected';
    const connectState = useConnectWallet();
    connectSui = connectState?.mutate || (() => {});
    isConnectingSui = connectState?.isPending || false;
    const disconnectState = useDisconnectWallet();
    disconnectSui = disconnectState?.mutate || (() => {});
  } catch (e) {
    // Hooks failed - use defaults
    console.warn('Sui wallet hooks unavailable:', e);
  }

  return {
    wallets,
    suiAccount,
    currentWallet,
    connectionStatus,
    connectSui,
    disconnectSui,
    isConnectingSui,
    isClient,
  };
}

export function ConnectButton() {
  const [showSelector, setShowSelector] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Use safe Sui wallet hook
  const {
    wallets,
    suiAccount,
    currentWallet,
    connectionStatus,
    connectSui,
    disconnectSui,
    isConnectingSui,
    isClient,
  } = useSuiWalletSafe();
  
  const suiAddress = suiAccount?.address ?? null;
  const isSuiConnected = connectionStatus === 'connected' && !!suiAddress;
  const walletName = currentWallet?.name ?? 'SUI';
  
  // Filter to only Sui-compatible wallets
  const suiWallets = wallets.filter((w: any) => 
    w.chains?.some?.((c: string) => c.includes('sui'))
  );

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  
  const handleConnectSui = () => {
    console.log('Available Sui wallets:', suiWallets.map(w => w.name));
    if (suiWallets.length > 0) {
      // Connect to first available Sui wallet
      connectSui({ wallet: suiWallets[0] });
    } else {
      // Prompt to install wallet
      if (window.confirm('No SUI wallet detected.\n\nWould you like to install Slush wallet?')) {
        window.open('https://slush.app/', '_blank');
      }
    }
    setShowSelector(false);
  };

  return (
    <>
      <RainbowConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          authenticationStatus,
          mounted,
        }) => {
          const ready = mounted && authenticationStatus !== 'loading';
          const evmConnected = ready && account && chain && 
            (!authenticationStatus || authenticationStatus === 'authenticated');

          // Priority: EVM > SUI (show whichever is connected)
          const showEvm = evmConnected;
          const showSui = !evmConnected && isSuiConnected;
          const showConnect = !evmConnected && !isSuiConnected;

          return (
            <div
              {...(!ready && {
                'aria-hidden': true,
                style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' },
              })}
              className="relative"
            >
              {/* Not connected - show connect options */}
              {showConnect && (
                <div className="relative">
                  <button
                    onClick={() => setShowSelector(!showSelector)}
                    className="px-5 h-11 bg-[#007AFF] hover:bg-[#0066CC] text-white rounded-[12px] font-semibold text-[15px] transition-colors flex items-center gap-2"
                  >
                    <Wallet className="w-4 h-4" />
                    <span>Connect</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showSelector ? 'rotate-180' : ''}`} />
                  </button>

                  {showSelector && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSelector(false)} />
                      <div className="absolute top-full mt-2 right-0 w-56 bg-white dark:bg-[#1c1c1e] border border-[#E5E5EA] dark:border-[#38383a] rounded-xl shadow-lg overflow-hidden z-50">
                        <div className="p-2">
                          {/* Cronos / EVM - RainbowKit */}
                          <button
                            onClick={() => {
                              openConnectModal();
                              setShowSelector(false);
                            }}
                            className="w-full p-2.5 rounded-lg hover:bg-[#F5F5F7] dark:hover:bg-[#2c2c2e] transition-colors text-left flex items-center gap-3"
                          >
                            <div className="w-8 h-8 rounded-full bg-[#002D74] flex items-center justify-center">
                              <span className="text-white font-bold text-[9px]">CRO</span>
                            </div>
                            <div>
                              <div className="font-medium text-[#1D1D1F] dark:text-white text-[14px]">Cronos</div>
                              <div className="text-[11px] text-[#86868B]">OKX, MetaMask, WalletConnect</div>
                            </div>
                          </button>

                          {/* SUI - dapp-kit */}
                          <button
                            onClick={handleConnectSui}
                            disabled={isConnectingSui}
                            className="w-full p-2.5 rounded-lg hover:bg-[#F5F5F7] dark:hover:bg-[#2c2c2e] transition-colors text-left flex items-center gap-3 disabled:opacity-50"
                          >
                            <div className="w-8 h-8 rounded-full bg-[#4DA2FF] flex items-center justify-center">
                              <span className="text-white font-bold text-[9px]">SUI</span>
                            </div>
                            <div>
                              <div className="font-medium text-[#1D1D1F] dark:text-white text-[14px]">
                                {isConnectingSui ? 'Connecting...' : 'SUI'}
                              </div>
                              <div className="text-[11px] text-[#86868B]">
                                {suiWallets.length > 0 
                                  ? suiWallets.map(w => w.name).join(', ')
                                  : 'Slush, Sui Wallet'}
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* EVM Connected (via RainbowKit) */}
              {showEvm && (
                <>
                  {chain?.unsupported ? (
                    <button
                      onClick={openChainModal}
                      className="px-4 h-11 bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-[12px] text-[#FF3B30] text-sm font-medium"
                    >
                      Wrong network
                    </button>
                  ) : (
                    <button
                      onClick={openAccountModal}
                      className="h-11 bg-[#F5F5F7] dark:bg-[#2c2c2e] hover:bg-[#E5E5EA] dark:hover:bg-[#3c3c3e] border border-black/5 dark:border-white/10 rounded-[12px] transition-colors flex items-center gap-2 px-3"
                    >
                      <div className="w-6 h-6 rounded-full bg-[#002D74] flex items-center justify-center">
                        <span className="text-white font-bold text-[8px]">CRO</span>
                      </div>
                      <span className="text-[#1D1D1F] dark:text-white font-medium text-[14px]">
                        {account?.displayName}
                      </span>
                    </button>
                  )}
                </>
              )}

              {/* SUI Connected (via dapp-kit) */}
              {showSui && suiAddress && (
                <div className="relative">
                  <button
                    onClick={() => setShowSelector(!showSelector)}
                    className="h-11 bg-[#F5F5F7] dark:bg-[#2c2c2e] hover:bg-[#E5E5EA] dark:hover:bg-[#3c3c3e] border border-black/5 dark:border-white/10 rounded-[12px] transition-colors flex items-center gap-2 px-3"
                  >
                    <div className="w-6 h-6 rounded-full bg-[#4DA2FF] flex items-center justify-center">
                      <span className="text-white font-bold text-[8px]">SUI</span>
                    </div>
                    <span className="text-[#1D1D1F] dark:text-white font-medium text-[14px]">
                      {truncate(suiAddress)}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#86868B]" />
                  </button>

                  {showSelector && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSelector(false)} />
                      <div className="absolute top-full mt-2 right-0 w-56 bg-white dark:bg-[#1c1c1e] border border-[#E5E5EA] dark:border-[#38383a] rounded-xl shadow-lg overflow-hidden z-50">
                        <div className="p-3">
                          <div className="flex items-center gap-2.5 mb-3">
                            <div className="w-9 h-9 rounded-full bg-[#4DA2FF] flex items-center justify-center">
                              <span className="text-white font-bold text-[10px]">SUI</span>
                            </div>
                            <div>
                              <div className="font-medium text-[#1D1D1F] dark:text-white text-[14px]">{walletName}</div>
                              <div className="text-[12px] text-[#86868B] font-mono">{truncate(suiAddress)}</div>
                            </div>
                          </div>

                          <div className="flex gap-2 mb-2">
                            <button
                              onClick={() => copyAddress(suiAddress)}
                              className="flex-1 py-1.5 bg-[#F5F5F7] dark:bg-[#2c2c2e] hover:bg-[#E5E5EA] dark:hover:bg-[#3c3c3e] rounded-lg text-[12px] font-medium text-[#1D1D1F] dark:text-white flex items-center justify-center gap-1 transition-colors"
                            >
                              {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
                              {copied ? 'Copied' : 'Copy'}
                            </button>
                            <a
                              href={`https://suiscan.xyz/testnet/address/${suiAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 py-1.5 bg-[#F5F5F7] dark:bg-[#2c2c2e] hover:bg-[#E5E5EA] dark:hover:bg-[#3c3c3e] rounded-lg text-[12px] font-medium text-[#1D1D1F] dark:text-white flex items-center justify-center gap-1 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Explorer
                            </a>
                          </div>

                          <button
                            onClick={() => {
                              disconnectSui();
                              setShowSelector(false);
                            }}
                            className="w-full py-2 text-[#FF3B30] hover:bg-[#FF3B30]/5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            Disconnect
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        }}
      </RainbowConnectButton.Custom>
    </>
  );
}
