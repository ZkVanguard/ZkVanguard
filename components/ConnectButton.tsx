'use client';

import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/utils/logger';
import { Wallet, ChevronDown, ExternalLink, Copy, Check, LogOut, AlertTriangle } from 'lucide-react';
import { 
  useWallets, 
  useCurrentAccount, 
  useConnectWallet, 
  useDisconnectWallet, 
  useCurrentWallet,
} from '@mysten/dapp-kit';
import type { WalletAccount, WalletWithRequiredFeatures } from '@mysten/wallet-standard';
import { useSuiSafe } from '@/app/sui-providers';
import { useWdk, useWdkAccount } from '@/lib/wdk/wdk-context';
import { WDK_CHAINS } from '@/lib/config/wdk';
import { useWdkModal } from '@/contexts/WdkModalContext';
import {
  SUI_MOBILE_WALLETS,
  isMobileBrowser,
  openMobileWallet,
  type MobileWalletOption,
} from '@/lib/utils/mobile-wallet';

// Safe hook wrapper for Sui wallet functionality
function useSuiWalletSafe() {
  let wallets: WalletWithRequiredFeatures[] = [];
  let suiAccount: WalletAccount | null = null;
  let currentWallet: WalletWithRequiredFeatures | null = null;
  let connectionStatus = 'disconnected';
  let connectSui: (args: { wallet: WalletWithRequiredFeatures }) => void = () => {};
  let disconnectSui: () => void = () => {};
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
    logger.warn('Sui wallet hooks unavailable', { component: 'ConnectButton', error: String(e) });
  }

  return {
    wallets,
    suiAccount,
    currentWallet,
    connectionStatus,
    connectSui,
    disconnectSui,
    isConnectingSui,
  };
}

export function ConnectButton() {
  const [showSelector, setShowSelector] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showNetworkHelp, setShowNetworkHelp] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    setMounted(true);
    setIsMobile(isMobileBrowser());
  }, []);

  // Show the mobile-wallet chooser sheet (Slush / Sui Wallet / Suiet /
  // Ethos) instead of hardcoding a Slush redirect. State lives here
  // because it's paired with the mobile-branch of handleConnectSui.
  const [showMobileWallets, setShowMobileWallets] = useState(false);
  const [pendingMobileWallet, setPendingMobileWallet] = useState<string | null>(null);
  
  // WDK modal context — modal renders outside Navbar's DOM tree
  const { openWdkModal } = useWdkModal();
  
  // WDK wallet hooks
  const { disconnect: wdkDisconnect } = useWdk();
  const { address: wdkAddress, isConnected: wdkIsConnected, chainKey } = useWdkAccount();
  const currentChain = chainKey ? WDK_CHAINS[chainKey] : null;
  
  // Sui wallet hooks
  const {
    wallets,
    suiAccount,
    currentWallet,
    connectionStatus,
    connectSui,
    disconnectSui,
    isConnectingSui,
  } = useSuiWalletSafe();
  
  // SUI network status
  const suiContext = useSuiSafe();
  const suiIsWrongNetwork = suiContext?.isWrongNetwork ?? false;
  const suiWalletNetwork = suiContext?.walletNetwork ?? null;
  const suiExpectedNetwork = suiContext?.network ?? 'mainnet';
  
  const suiAddress = suiAccount?.address ?? null;
  const isSuiConnected = connectionStatus === 'connected' && !!suiAddress;
  const walletName = currentWallet?.name ?? 'SUI';
  
  const suiWallets = wallets.filter((w) => 
    w.chains?.some?.((c: string) => c.includes('sui'))
  );

  const copyAddress = useCallback((addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  
  const handleConnectSui = useCallback(() => {
    if (suiWallets.length > 0) {
      connectSui({ wallet: suiWallets[0] });
      setShowSelector(false);
      return;
    }
    if (isMobile) {
      // Mobile: open the wallet-chooser sheet. Redirect happens when the
      // user picks a specific wallet, so they see which options they have
      // rather than being silently thrown into Slush. Fixes the "connect
      // wallet on mobile doesn't redirect or connect" report.
      setShowSelector(false);
      setShowMobileWallets(true);
      return;
    }
    if (window.confirm('No SUI wallet detected.\n\nWould you like to install Slush wallet?')) {
      window.open('https://slush.app/', '_blank');
    }
    setShowSelector(false);
  }, [suiWallets, connectSui, isMobile]);

  // Fires when the user picks a wallet from the mobile chooser.
  // Records which wallet they picked (so the "opening…" state is
  // meaningful) and issues the deep link. On real hardware the browser
  // navigates away immediately; the pending-state UI covers the ~100 ms
  // before that.
  const pickMobileWallet = useCallback((wallet: MobileWalletOption) => {
    setPendingMobileWallet(wallet.name);
    // Use assign so back-button lands the user back on our dApp.
    openMobileWallet(wallet);
  }, []);

  // Wait for client mount to avoid hydration mismatch
  const showWdk = mounted && wdkIsConnected && wdkAddress;
  const showSui = mounted && !showWdk && isSuiConnected;
  const showConnect = !showWdk && !showSui;

  return (
    <div className="relative">
      {/* Mobile wallet chooser sheet — bottom-sheet on <sm, centered on ≥sm.
          Rendered outside the Connect-dropdown flow so it can cover the
          whole screen while the deep link is opening. */}
      {showMobileWallets && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowMobileWallets(false)}
        >
          <div
            className="w-full sm:max-w-md bg-white dark:bg-[#1c1c1e] rounded-t-[24px] sm:rounded-2xl shadow-2xl pb-safe sm:pb-0 min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sm:hidden flex justify-center pt-2 pb-1">
              <div className="w-9 h-1 rounded-full bg-black/15" />
            </div>
            <div className="p-4 sm:p-5">
              <h3 className="text-base sm:text-lg font-semibold text-[#1D1D1F] dark:text-white mb-1">
                Choose a wallet
              </h3>
              <p className="text-xs sm:text-sm text-[#86868B] mb-4">
                Tap a wallet to open this page inside its in-app browser.
              </p>
              <div className="space-y-2">
                {SUI_MOBILE_WALLETS.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => pickMobileWallet(w)}
                    disabled={pendingMobileWallet !== null}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#E5E5EA] dark:border-[#38383a] hover:bg-[#F5F5F7] dark:hover:bg-[#2c2c2e] active:scale-[0.99] disabled:opacity-50 transition-all min-w-0"
                  >
                    <div className="w-10 h-10 rounded-full bg-[#4DA2FF] flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold text-xs">{w.name.slice(0, 3).toUpperCase()}</span>
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <div className="font-medium text-sm text-[#1D1D1F] dark:text-white truncate">
                        {pendingMobileWallet === w.name ? `Opening ${w.name}…` : w.name}
                      </div>
                      <div className="text-[11px] text-[#86868B] truncate">
                        {pendingMobileWallet === w.name
                          ? 'If nothing happens, install the app first'
                          : 'Open in wallet'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-[#E5E5EA] dark:border-[#38383a] flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => { setShowMobileWallets(false); setPendingMobileWallet(null); }}
                  className="w-full sm:w-auto h-11 sm:h-auto px-4 py-2 text-sm font-medium text-[#1D1D1F] dark:text-white bg-[#F5F5F7] dark:bg-[#2c2c2e] active:scale-[0.98] rounded-xl transition-all"
                >
                  Cancel
                </button>
                <a
                  href={SUI_MOBILE_WALLETS[0].installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:flex-1 h-11 sm:h-auto px-4 py-2 text-sm font-medium text-center text-[#4DA2FF] bg-[#4DA2FF]/10 active:scale-[0.98] rounded-xl transition-all inline-flex items-center justify-center"
                >
                  Don&apos;t have one? Install →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Not connected - show connect options */}
      {showConnect && (
        <div className="relative">
          <button
            onClick={() => setShowSelector(!showSelector)}
            className="px-5 h-11 bg-claude-orange hover:bg-claude-rust text-white rounded-[12px] font-semibold text-[15px] transition-colors flex items-center gap-2"
          >
            <Wallet className="w-4 h-4" />
            <span>Connect</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showSelector ? 'rotate-180' : ''}`} />
          </button>

          {showSelector && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSelector(false)} />
              <div className="absolute top-full mt-2 right-0 w-64 bg-white dark:bg-[#1c1c1e] border border-[#E5E5EA] dark:border-[#38383a] rounded-xl shadow-lg overflow-hidden z-50">
                <div className="p-2">
                  {/* SUI-only mode: Tether WDK (EVM/Cronos/Hedera) wallet option
                      is intentionally disabled. Restore the WDK button below
                      when re-enabling other chains. */}
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
                          : isMobile ? 'Open in Slush app' : 'Slush, Sui Wallet'}
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* WDK Connected */}
      {showWdk && wdkAddress && (
        <div className="relative">
          <button
            onClick={() => setShowSelector(!showSelector)}
            className="h-11 bg-[#F5F5F7] dark:bg-[#2c2c2e] hover:bg-[#E5E5EA] dark:hover:bg-[#3c3c3e] border border-black/5 dark:border-white/10 rounded-[12px] transition-colors flex items-center gap-2 px-3"
          >
            <div className="w-6 h-6 rounded-full bg-[#26A17B] flex items-center justify-center">
              <span className="text-white font-bold text-[7px]">WDK</span>
            </div>
            <span className="text-[#1D1D1F] dark:text-white font-medium text-[14px]">
              {truncate(wdkAddress)}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-[#86868B]" />
          </button>

          {showSelector && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSelector(false)} />
              <div className="absolute top-full mt-2 right-0 w-56 bg-white dark:bg-[#1c1c1e] border border-[#E5E5EA] dark:border-[#38383a] rounded-xl shadow-lg overflow-hidden z-50">
                <div className="p-3">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-9 h-9 rounded-full bg-[#26A17B] flex items-center justify-center">
                      <span className="text-white font-bold text-[9px]">WDK</span>
                    </div>
                    <div>
                      <div className="font-medium text-[#1D1D1F] dark:text-white text-[14px]">
                        {currentChain?.name || 'WDK Wallet'}
                      </div>
                      <div className="text-[12px] text-[#86868B] font-mono">{truncate(wdkAddress)}</div>
                    </div>
                  </div>

                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => copyAddress(wdkAddress)}
                      className="flex-1 py-1.5 bg-[#F5F5F7] dark:bg-[#2c2c2e] hover:bg-[#E5E5EA] dark:hover:bg-[#3c3c3e] rounded-lg text-[12px] font-medium text-[#1D1D1F] dark:text-white flex items-center justify-center gap-1 transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <a
                      href={`${currentChain?.explorerUrl || 'https://explorer.cronos.org'}/address/${wdkAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1.5 bg-[#F5F5F7] dark:bg-[#2c2c2e] hover:bg-[#E5E5EA] dark:hover:bg-[#3c3c3e] rounded-lg text-[12px] font-medium text-[#1D1D1F] dark:text-white flex items-center justify-center gap-1 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Explorer
                    </a>
                  </div>

                  <button
                    onClick={() => { wdkDisconnect(); setShowSelector(false); }}
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

      {/* SUI Connected */}
      {showSui && suiAddress && (
        <>
          {suiIsWrongNetwork ? (
            <div className="relative">
              <button
                onClick={() => setShowNetworkHelp(!showNetworkHelp)}
                className="px-4 h-11 bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-[12px] text-[#FF3B30] text-sm font-medium flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4" />
                Wrong Network
              </button>
              
              {showNetworkHelp && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNetworkHelp(false)} />
                  <div className="absolute top-full mt-2 right-0 w-72 bg-white dark:bg-[#1c1c1e] border border-[#E5E5EA] dark:border-[#38383a] rounded-xl shadow-lg overflow-hidden z-50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-5 h-5 text-[#FF9500]" />
                      <h4 className="font-semibold text-[#1D1D1F] dark:text-white">Switch to {suiExpectedNetwork}</h4>
                    </div>
                    
                    <p className="text-[13px] text-[#86868B] mb-3">
                      Your wallet is on <span className="font-medium text-[#1D1D1F] dark:text-white">{suiWalletNetwork || 'unknown'}</span>, 
                      but this app requires <span className="font-medium text-[#4DA2FF]">{suiExpectedNetwork}</span>.
                    </p>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={() => { disconnectSui(); setShowNetworkHelp(false); }}
                        className="flex-1 py-2 bg-[#F5F5F7] dark:bg-[#2c2c2e] rounded-lg text-[12px] font-medium"
                      >
                        Disconnect
                      </button>
                      <button
                        onClick={() => window.location.reload()}
                        className="flex-1 py-2 bg-[#4DA2FF] text-white rounded-lg text-[12px] font-medium"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
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
                          className="flex-1 py-1.5 bg-[#F5F5F7] dark:bg-[#2c2c2e] rounded-lg text-[12px] font-medium flex items-center justify-center gap-1"
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-[#34C759]" /> : <Copy className="w-3.5 h-3.5" />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                        <a
                          href={`https://suiscan.xyz/${process.env.NEXT_PUBLIC_SUI_NETWORK || 'mainnet'}/address/${suiAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 py-1.5 bg-[#F5F5F7] dark:bg-[#2c2c2e] rounded-lg text-[12px] font-medium flex items-center justify-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Explorer
                        </a>
                      </div>

                      <button
                        onClick={() => { disconnectSui(); setShowSelector(false); }}
                        className="w-full py-2 text-[#FF3B30] hover:bg-[#FF3B30]/5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5"
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
        </>
      )}
    </div>
  );
}
