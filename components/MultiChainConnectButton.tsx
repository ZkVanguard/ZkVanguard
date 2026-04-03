'use client';

import { useState, useEffect, useMemo, createContext, useContext, ReactNode } from 'react';
import { logger } from '@/lib/utils/logger';
import { useAccount, useDisconnect } from '@/lib/wdk/wdk-hooks';
import { useWdk } from '@/lib/wdk/wdk-context';
import { Wallet, ChevronDown, Copy, Check, LogOut, Plus, Key, Loader2 } from 'lucide-react';

// ============================================
// MULTI-CHAIN WALLET CONTEXT
// ============================================

type ChainType = 'evm' | 'sui' | 'oasis-emerald' | 'oasis-sapphire' | 'oasis-consensus' | 'oasis-cipher';

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

  // Get EVM connection status from WDK
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkSuiWallet = async () => {
      try {
        const suiWallet = (window as unknown as { suiWallet?: { getAccounts?: () => Promise<string[]> } }).suiWallet;
        if (suiWallet?.getAccounts) {
          const accounts = await suiWallet.getAccounts();
          if (accounts && accounts.length > 0) {
            setSuiAddress(accounts[0]);
            setIsSuiConnected(true);
          }
        }
      } catch {
        // Sui wallet not available
      }
    };

    checkSuiWallet();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => { if (!interval) interval = setInterval(checkSuiWallet, 10000); };
    const stopPolling = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVisibility = () => document.hidden ? stopPolling() : startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    startPolling();
    return () => { stopPolling(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const evmAddr = evmAddress || null;
  const isAnyConnected = isEvmConnected || isSuiConnected;
  const value = useMemo<MultiWalletContextType>(() => ({
    activeChain,
    setActiveChain,
    evmAddress: evmAddr,
    suiAddress,
    isEvmConnected,
    isSuiConnected,
    isAnyConnected,
  }), [activeChain, evmAddr, suiAddress, isEvmConnected, isSuiConnected, isAnyConnected]);

  return (
    <MultiWalletContext.Provider value={value}>
      {children}
    </MultiWalletContext.Provider>
  );
}

async function connectSuiWallet() {
  if (typeof window === 'undefined') return;
  try {
    const suiWallet = (window as unknown as { 
      suiWallet?: { requestPermissions?: () => Promise<boolean>; connect?: () => Promise<void>; } 
    }).suiWallet;
    if (suiWallet?.requestPermissions) {
      await suiWallet.requestPermissions();
    } else if (suiWallet?.connect) {
      await suiWallet.connect();
    } else {
      window.open('https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil', '_blank');
    }
  } catch (error) {
    logger.error('Failed to connect Sui wallet', error instanceof Error ? error : undefined);
  }
}

// ============================================
// WDK CONNECT MODAL
// ============================================

interface WdkConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  chainType: ChainType;
}

function WdkConnectModal({ isOpen, onClose, chainType }: WdkConnectModalProps) {
  const { createWallet, importWallet } = useWdk();
  const [mode, setMode] = useState<'select' | 'create' | 'import'>('select');
  const [mnemonic, setMnemonic] = useState('');
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCreate = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const newMnemonic = await createWallet();
      if (newMnemonic) {
        setGeneratedMnemonic(newMnemonic);
        setMode('create');
      } else {
        setError('Failed to create wallet');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!mnemonic.trim()) {
      setError('Please enter your recovery phrase');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const success = await importWallet(mnemonic.trim());
      if (success) {
        onClose();
      } else {
        setError('Invalid recovery phrase');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import wallet');
    } finally {
      setIsLoading(false);
    }
  };

  const copyMnemonic = () => {
    if (generatedMnemonic) {
      navigator.clipboard.writeText(generatedMnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getChainInfo = () => {
    switch (chainType) {
      case 'evm':
        return { name: 'Cronos & Hedera', color: 'from-[#002D74] to-[#8259EF]' };
      case 'oasis-emerald':
        return { name: 'Oasis Emerald', color: 'from-[#00C853] to-[#009624]' };
      case 'oasis-sapphire':
        return { name: 'Oasis Sapphire', color: 'from-[#0092F6] to-[#0500E1]' };
      default:
        return { name: 'EVM Chain', color: 'from-[#007AFF] to-[#0052CC]' };
    }
  };

  const chainInfo = getChainInfo();

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl z-50 overflow-hidden">
        <div className={`p-6 bg-gradient-to-r ${chainInfo.color} text-white`}>
          <h2 className="text-xl font-bold">Connect to {chainInfo.name}</h2>
          <p className="text-white/80 text-sm mt-1">Powered by Tether WDK</p>
        </div>

        <div className="p-6">
          {mode === 'select' && (
            <div className="space-y-4">
              <button
                onClick={handleCreate}
                disabled={isLoading}
                className="w-full p-4 rounded-xl border border-[#E5E5EA] hover:border-[#007AFF] hover:bg-[#F5F5F7] transition-all flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-[#007AFF]/10 flex items-center justify-center">
                  <Plus className="w-6 h-6 text-[#007AFF]" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-[#1D1D1F]">Create New Wallet</div>
                  <div className="text-sm text-[#86868B]">Generate a new self-custodial wallet</div>
                </div>
                {isLoading && <Loader2 className="w-5 h-5 animate-spin text-[#007AFF]" />}
              </button>

              <button
                onClick={() => setMode('import')}
                className="w-full p-4 rounded-xl border border-[#E5E5EA] hover:border-[#007AFF] hover:bg-[#F5F5F7] transition-all flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-[#34C759]/10 flex items-center justify-center">
                  <Key className="w-6 h-6 text-[#34C759]" />
                </div>
                <div className="text-left">
                  <div className="font-semibold text-[#1D1D1F]">Import Existing Wallet</div>
                  <div className="text-sm text-[#86868B]">Use your recovery phrase</div>
                </div>
              </button>

              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            </div>
          )}

          {mode === 'create' && generatedMnemonic && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-amber-800 text-sm font-medium mb-2">⚠️ Save your recovery phrase!</p>
                <p className="text-amber-700 text-xs">Write these words down safely. You'll need them to recover your wallet.</p>
              </div>

              <div className="p-4 bg-[#F5F5F7] rounded-xl font-mono text-sm break-words">
                {generatedMnemonic}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={copyMnemonic}
                  className="flex-1 py-3 border border-[#E5E5EA] rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-[#F5F5F7] transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 bg-[#007AFF] text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
                >
                  I've Saved It
                </button>
              </div>
            </div>
          )}

          {mode === 'import' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#1D1D1F] mb-2">Recovery Phrase</label>
                <textarea
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  placeholder="Enter your 12 or 24 word recovery phrase..."
                  className="w-full p-4 border border-[#E5E5EA] rounded-xl resize-none h-32 focus:outline-none focus:border-[#007AFF]"
                />
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => setMode('select')}
                  className="flex-1 py-3 border border-[#E5E5EA] rounded-xl font-medium hover:bg-[#F5F5F7] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={isLoading}
                  className="flex-1 py-3 bg-[#007AFF] text-white rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Import Wallet
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
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
  const [showWdkModal, setShowWdkModal] = useState(false);
  const [selectedChainType, setSelectedChainType] = useState<ChainType>('evm');
  const [copiedAddress, setCopiedAddress] = useState(false);
  const { activeChain, setActiveChain, evmAddress, suiAddress, isEvmConnected, isSuiConnected } = useMultiWallet();
  const { disconnect } = useDisconnect();

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const openWdkConnect = (chainType: ChainType) => {
    setSelectedChainType(chainType);
    setActiveChain(chainType);
    setShowWdkModal(true);
    setShowWalletSelector(false);
  };

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
                <p className="text-sm text-[#86868B] mt-1">Self-custodial wallet powered by Tether WDK</p>
              </div>

              <div className="p-3 space-y-2">
                <div className="p-3 rounded-xl border border-[#E5E5EA] hover:border-[#007AFF] transition-colors">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#002D74] to-[#0052CC] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">EVM</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1D1D1F]">Cronos & Hedera</div>
                      <div className="text-xs text-[#86868B]">WDK Self-Custodial Wallet</div>
                    </div>
                  </div>
                  <button
                    onClick={() => openWdkConnect('evm')}
                    className="w-full py-2.5 bg-[#007AFF] hover:opacity-90 text-white rounded-lg font-medium text-sm transition-opacity"
                  >
                    Connect EVM Wallet
                  </button>
                </div>

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
                    onClick={() => { setActiveChain('sui'); connectSuiWallet(); setShowWalletSelector(false); }}
                    className="w-full py-2.5 bg-[#4DA2FF] hover:opacity-90 text-white rounded-lg font-medium text-sm transition-opacity"
                  >
                    Connect SUI Wallet
                  </button>
                </div>
              </div>

              <div className="p-3 border-t border-[#E5E5EA] bg-[#F5F5F7]">
                <p className="text-xs text-[#86868B] text-center">🔒 Your keys, your crypto. Fully self-custodial.</p>
              </div>
            </div>
          </>
        )}

        <WdkConnectModal isOpen={showWdkModal} onClose={() => setShowWdkModal(false)} chainType={selectedChainType} />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setShowWalletSelector(!showWalletSelector)}
        className="px-4 h-11 bg-[#f5f5f7] hover:bg-[#e5e5ea] border border-black/10 rounded-[12px] transition-colors flex items-center gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
      >
        <div className="flex items-center -space-x-1">
          {isEvmConnected && (
            <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#002D74] to-[#0052CC] flex items-center justify-center border-2 border-white">
              <span className="text-white font-bold text-[8px]">EVM</span>
            </div>
          )}
          {isSuiConnected && (
            <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#4DA2FF] to-[#6FBCFF] flex items-center justify-center border-2 border-white">
              <span className="text-white font-bold text-[8px]">SUI</span>
            </div>
          )}
        </div>
        <span className="text-[#1D1D1F] font-medium text-sm">
          {activeChain === 'sui' && suiAddress ? truncateAddress(suiAddress) : evmAddress ? truncateAddress(evmAddress) : 'Connected'}
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
              {isEvmConnected && evmAddress && (
                <div className={`p-3 rounded-xl border ${activeChain !== 'sui' ? 'border-[#007AFF] bg-[#007AFF]/5' : 'border-[#E5E5EA]'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#002D74] to-[#0052CC] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">EVM</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1D1D1F]">EVM Wallet</div>
                      <div className="text-xs text-[#86868B] font-mono">{truncateAddress(evmAddress)}</div>
                    </div>
                    <button onClick={() => copyAddress(evmAddress)} className="p-2 hover:bg-[#F5F5F7] rounded-lg transition-colors">
                      {copiedAddress ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-[#86868B]" />}
                    </button>
                  </div>
                  {activeChain !== 'sui' && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => disconnect()}
                        className="flex-1 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1"
                      >
                        <LogOut className="w-3 h-3" />
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isSuiConnected && suiAddress && (
                <div className={`p-3 rounded-xl border ${activeChain === 'sui' ? 'border-[#4DA2FF] bg-[#4DA2FF]/5' : 'border-[#E5E5EA]'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#4DA2FF] to-[#6FBCFF] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">SUI</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-[#1D1D1F]">SUI Wallet</div>
                      <div className="text-xs text-[#86868B] font-mono">{truncateAddress(suiAddress)}</div>
                    </div>
                    <button onClick={() => copyAddress(suiAddress)} className="p-2 hover:bg-[#F5F5F7] rounded-lg transition-colors">
                      {copiedAddress ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-[#86868B]" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {isEvmConnected && (
                  <button
                    onClick={() => setActiveChain('evm')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${activeChain !== 'sui' ? 'bg-[#007AFF] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F]'}`}
                  >
                    Use EVM
                  </button>
                )}
                {isSuiConnected && (
                  <button
                    onClick={() => setActiveChain('sui')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${activeChain === 'sui' ? 'bg-[#4DA2FF] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F]'}`}
                  >
                    Use SUI
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { UnifiedConnectButton as MultiChainConnectButton };
