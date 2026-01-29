'use client';

import { useState } from 'react';
import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { Wallet, ChevronDown, ExternalLink, Copy, Check, LogOut } from 'lucide-react';

// Simple multi-chain detection
const useSuiWallet = () => {
  const [suiAddress, setSuiAddress] = useState<string | null>(null);
  
  // Check for Sui wallet on mount (client-side only)
  if (typeof window !== 'undefined') {
    const suiWallet = (window as unknown as { suiWallet?: { getAccounts?: () => Promise<string[]> } }).suiWallet;
    if (suiWallet?.getAccounts) {
      suiWallet.getAccounts().then(accounts => {
        if (accounts?.[0]) setSuiAddress(accounts[0]);
      }).catch(() => {});
    }
  }
  
  return { suiAddress, isSuiConnected: !!suiAddress };
};

export function ConnectButton() {
  const [showMultiChain, setShowMultiChain] = useState(false);
  const [copied, setCopied] = useState(false);
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { suiAddress, isSuiConnected } = useSuiWallet();

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
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
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus ||
            authenticationStatus === 'authenticated');

        return (
          <div
            {...(!ready && {
              'aria-hidden': true,
              'style': {
                opacity: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              },
            })}
            className="relative"
          >
            {(() => {
              if (!connected && !isSuiConnected) {
                return (
                  <div className="relative">
                    <button
                      onClick={() => setShowMultiChain(!showMultiChain)}
                      type="button"
                      className="px-5 h-11 bg-[#007AFF] hover:opacity-90 active:opacity-80 text-white rounded-[12px] font-semibold text-[16px] transition-opacity flex items-center gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                    >
                      <Wallet className="w-4 h-4" />
                      <span>Connect</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showMultiChain ? 'rotate-180' : ''}`} />
                    </button>

                    {showMultiChain && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowMultiChain(false)} />
                        <div className="absolute top-full mt-2 right-0 w-72 bg-white border border-[#E5E5EA] rounded-2xl shadow-2xl overflow-hidden z-50">
                          <div className="p-3 border-b border-[#E5E5EA]">
                            <h4 className="font-semibold text-[#1D1D1F]">Select Network</h4>
                            <p className="text-xs text-[#86868B] mt-0.5">Choose your blockchain</p>
                          </div>
                          
                          <div className="p-2 space-y-2">
                            {/* Cronos EVM */}
                            <button
                              onClick={() => {
                                openConnectModal();
                                setShowMultiChain(false);
                              }}
                              className="w-full p-3 rounded-xl border border-[#E5E5EA] hover:border-[#007AFF] hover:bg-[#007AFF]/5 transition-all text-left"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#002D74] to-[#0052CC] flex items-center justify-center">
                                  <span className="text-white font-bold text-xs">CRO</span>
                                </div>
                                <div className="flex-1">
                                  <div className="font-semibold text-[#1D1D1F]">Cronos (EVM)</div>
                                  <div className="text-xs text-[#86868B]">MetaMask, WalletConnect</div>
                                </div>
                                <div className="px-2 py-1 bg-[#34C759]/10 text-[#34C759] rounded-full text-xs font-medium">
                                  Live
                                </div>
                              </div>
                            </button>

                            {/* SUI */}
                            <button
                              onClick={() => {
                                connectSuiWallet();
                                setShowMultiChain(false);
                              }}
                              className="w-full p-3 rounded-xl border border-[#E5E5EA] hover:border-[#4DA2FF] hover:bg-[#4DA2FF]/5 transition-all text-left"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4DA2FF] to-[#6FBCFF] flex items-center justify-center">
                                  <span className="text-white font-bold text-xs">SUI</span>
                                </div>
                                <div className="flex-1">
                                  <div className="font-semibold text-[#1D1D1F]">SUI (Move)</div>
                                  <div className="text-xs text-[#86868B]">Sui Wallet, Ethos</div>
                                </div>
                                <div className="px-2 py-1 bg-[#4DA2FF]/10 text-[#4DA2FF] rounded-full text-xs font-medium">
                                  Live
                                </div>
                              </div>
                            </button>
                          </div>

                          <div className="p-2 border-t border-[#E5E5EA] bg-[#F5F5F7]">
                            <p className="text-xs text-[#86868B] text-center">
                              Multi-chain portfolio aggregation
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              }

              if (chain?.unsupported) {
                return (
                  <button
                    onClick={openChainModal}
                    type="button"
                    className="px-4 h-11 bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-[12px] text-[#FF3B30] font-medium hover:bg-[#FF3B30]/20 transition-all"
                  >
                    Wrong network
                  </button>
                );
              }

              // Connected state - show wallet info with multi-chain support
              return (
                <div className="flex items-center gap-2">
                  {/* Chain selector */}
                  <button
                    onClick={openChainModal}
                    type="button"
                    className="px-3 h-11 bg-[#f5f5f7] hover:bg-[#e5e5ea] border border-black/10 rounded-[12px] transition-colors shadow-[0_1px_3px_rgba(0,0,0,0.04)] hidden sm:flex items-center gap-2"
                  >
                    <div className="flex items-center -space-x-1">
                      {chain?.hasIcon && (
                        <div
                          style={{
                            background: chain.iconBackground,
                            width: 20,
                            height: 20,
                            borderRadius: 999,
                            overflow: 'hidden',
                          }}
                        >
                          {chain.iconUrl && (
                            <img
                              alt={chain.name ?? 'Chain icon'}
                              src={chain.iconUrl}
                              style={{ width: 20, height: 20 }}
                            />
                          )}
                        </div>
                      )}
                      {isSuiConnected && (
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#4DA2FF] to-[#6FBCFF] flex items-center justify-center border border-white">
                          <span className="text-white font-bold text-[6px]">SUI</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[14px] font-medium text-[#1d1d1f]">
                      {isSuiConnected ? 'Multi' : chain?.name}
                    </span>
                  </button>

                  {/* Account button */}
                  <button
                    onClick={openAccountModal}
                    type="button"
                    className="px-4 h-11 bg-[#f5f5f7] hover:bg-[#e5e5ea] border border-black/10 rounded-[12px] transition-colors flex items-center gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                  >
                    <Wallet className="w-4 h-4 text-[#007AFF]" />
                    <span className="text-[#1d1d1f] font-medium text-[16px]">
                      {account?.displayName}
                    </span>
                  </button>
                </div>
              );
            })()}
          </div>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}

// Helper to connect Sui wallet
async function connectSuiWallet() {
  if (typeof window === 'undefined') return;

  try {
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
      window.location.reload(); // Refresh to update state
      return;
    }

    // No Sui wallet - prompt to install
    const installSui = window.confirm(
      'SUI Wallet not detected. Would you like to install it?'
    );
    if (installSui) {
      window.open('https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil', '_blank');
    }
  } catch (error) {
    console.error('Failed to connect Sui wallet:', error);
  }
}

