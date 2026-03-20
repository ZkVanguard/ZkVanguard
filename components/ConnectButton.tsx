'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

// Safe hook wrapper for Sui wallet functionality
function useSuiWalletSafe() {
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);
  
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
    isClient,
  };
}

export function ConnectButton() {
  const [showSelector, setShowSelector] = useState(false);
  const [showWdkModal, setShowWdkModal] = useState<'none' | 'connect' | 'create' | 'import' | 'backup'>('none');
  const [copied, setCopied] = useState(false);
  const [showNetworkHelp, setShowNetworkHelp] = useState(false);
  const [seedPhrase, setSeedPhrase] = useState('');
  const [seedCopied, setSeedCopied] = useState(false);
  const [seedConfirmed, setSeedConfirmed] = useState(false);
  const [importPhrase, setImportPhrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // WDK wallet hooks (replaces RainbowKit)
  const { state: wdkState, createWallet, importWallet, disconnect: wdkDisconnect } = useWdk();
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
  const suiExpectedNetwork = suiContext?.network ?? 'testnet';
  
  const suiAddress = suiAccount?.address ?? null;
  const isSuiConnected = connectionStatus === 'connected' && !!suiAddress;
  const walletName = currentWallet?.name ?? 'SUI';
  
  const suiWallets = wallets.filter((w) => 
    w.chains?.some?.((c: string) => c.includes('sui'))
  );

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  
  const handleConnectSui = () => {
    if (suiWallets.length > 0) {
      connectSui({ wallet: suiWallets[0] });
    } else {
      if (window.confirm('No SUI wallet detected.\n\nWould you like to install Slush wallet?')) {
        window.open('https://slush.app/', '_blank');
      }
    }
    setShowSelector(false);
  };

  // WDK wallet handlers
  const handleWdkCreate = async () => {
    setLoading(true);
    setError(null);
    const mnemonic = await createWallet();
    if (mnemonic) {
      setSeedPhrase(mnemonic);
      setShowWdkModal('backup');
    } else {
      setError('Failed to create wallet');
    }
    setLoading(false);
  };

  const handleWdkImport = async () => {
    if (!importPhrase.trim()) {
      setError('Please enter your seed phrase');
      return;
    }
    setLoading(true);
    setError(null);
    const success = await importWallet(importPhrase.trim());
    if (success) {
      setImportPhrase('');
      setShowWdkModal('none');
      setShowSelector(false);
    } else {
      setError(wdkState.error || 'Failed to import wallet');
    }
    setLoading(false);
  };

  const handleCopySeed = () => {
    navigator.clipboard.writeText(seedPhrase);
    setSeedCopied(true);
    setTimeout(() => setSeedCopied(false), 2000);
  };

  const handleSeedConfirmed = () => {
    if (!seedConfirmed) {
      setError('Please confirm you have saved your seed phrase');
      return;
    }
    setSeedPhrase('');
    setSeedConfirmed(false);
    setShowWdkModal('none');
    setShowSelector(false);
  };

  // Determine connection state
  const showWdk = wdkIsConnected && wdkAddress;
  const showSui = !showWdk && isSuiConnected;
  const showConnect = !showWdk && !isSuiConnected;

  return (
    <>
      <div className="relative">
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
                <div className="absolute top-full mt-2 right-0 w-64 bg-white dark:bg-[#1c1c1e] border border-[#E5E5EA] dark:border-[#38383a] rounded-xl shadow-lg overflow-hidden z-50">
                  <div className="p-2">
                    {/* WDK - Native Tether Wallet */}
                    <button
                      onClick={() => { setShowWdkModal('connect'); setShowSelector(false); }}
                      className="w-full p-2.5 rounded-lg hover:bg-[#F5F5F7] dark:hover:bg-[#2c2c2e] transition-colors text-left flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#26A17B] flex items-center justify-center">
                        <span className="text-white font-bold text-[8px]">USDT</span>
                      </div>
                      <div>
                        <div className="font-medium text-[#1D1D1F] dark:text-white text-[14px]">Tether WDK</div>
                        <div className="text-[11px] text-[#86868B]">Self-custodial multi-chain</div>
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
                        href={`${currentChain?.explorerUrl || 'https://sepolia.etherscan.io'}/address/${wdkAddress}`}
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
                        wdkDisconnect();
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
                          onClick={() => {
                            disconnectSui();
                            setShowNetworkHelp(false);
                          }}
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
                            href={`https://suiscan.xyz/testnet/address/${suiAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 py-1.5 bg-[#F5F5F7] dark:bg-[#2c2c2e] rounded-lg text-[12px] font-medium flex items-center justify-center gap-1"
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

      {/* WDK Modal - rendered via portal to escape Navbar stacking context */}
      {showWdkModal !== 'none' && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4" onClick={() => setShowWdkModal('none')}>
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-800" onClick={e => e.stopPropagation()}>
            {showWdkModal === 'connect' && (
              <>
                <h2 className="text-xl font-bold text-white mb-2">Connect Wallet</h2>
                <p className="text-gray-400 text-sm mb-4">Powered by Tether WDK - Self-custodial multi-chain wallet</p>
                
                {error && (
                  <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">{error}</div>
                )}
                
                <div className="space-y-3">
                  <button
                    onClick={handleWdkCreate}
                    disabled={loading}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                  >
                    {loading ? 'Creating...' : 'Create New Wallet'}
                  </button>
                  
                  <button
                    onClick={() => setShowWdkModal('import')}
                    className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium"
                  >
                    Import Existing Wallet
                  </button>
                  
                  <button
                    onClick={() => setShowWdkModal('none')}
                    className="w-full px-4 py-3 border border-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {showWdkModal === 'import' && (
              <>
                <h2 className="text-xl font-bold text-white mb-2">Import Wallet</h2>
                <p className="text-gray-400 text-sm mb-4">Enter your 12 or 24 word seed phrase</p>
                
                {error && (
                  <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">{error}</div>
                )}
                
                <textarea
                  value={importPhrase}
                  onChange={(e) => setImportPhrase(e.target.value)}
                  placeholder="word1 word2 word3 ... word12"
                  rows={4}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 mb-4 resize-none"
                />
                
                <div className="space-y-3">
                  <button
                    onClick={handleWdkImport}
                    disabled={loading || !importPhrase.trim()}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
                  >
                    {loading ? 'Importing...' : 'Import Wallet'}
                  </button>
                  
                  <button
                    onClick={() => setShowWdkModal('connect')}
                    className="w-full px-4 py-3 border border-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium"
                  >
                    Back
                  </button>
                </div>
              </>
            )}

            {showWdkModal === 'backup' && (
              <>
                <h2 className="text-xl font-bold text-white mb-2">🔐 Backup Seed Phrase</h2>
                <p className="text-gray-400 text-sm mb-4">Write down these words. This is the ONLY way to recover your wallet.</p>
                
                <div className="p-4 bg-yellow-900/30 border border-yellow-600 rounded-lg mb-4">
                  <p className="text-yellow-300 text-sm font-medium">⚠️ Never share your seed phrase!</p>
                </div>
                
                <div className="p-4 bg-gray-800 rounded-lg mb-4 font-mono text-sm text-white">
                  {seedPhrase.split(' ').map((word, i) => (
                    <span key={i} className="inline-block mr-2 mb-2">
                      <span className="text-gray-500">{i + 1}.</span> {word}
                    </span>
                  ))}
                </div>
                
                <button
                  onClick={handleCopySeed}
                  className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium mb-4"
                >
                  {seedCopied ? '✓ Copied!' : 'Copy to Clipboard'}
                </button>
                
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-4">
                  <input
                    type="checkbox"
                    checked={seedConfirmed}
                    onChange={(e) => setSeedConfirmed(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  I have securely saved my seed phrase
                </label>
                
                {error && (
                  <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">{error}</div>
                )}
                
                <button
                  onClick={handleSeedConfirmed}
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                >
                  Continue
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
