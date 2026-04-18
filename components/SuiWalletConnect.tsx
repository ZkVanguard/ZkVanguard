'use client';

import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/utils/logger';
import { Wallet, ChevronDown, ExternalLink, Copy, Check, LogOut, AlertTriangle, Smartphone } from 'lucide-react';
import { 
  useWallets, 
  useCurrentAccount, 
  useConnectWallet, 
  useDisconnectWallet, 
  useCurrentWallet,
} from '@mysten/dapp-kit';
import type { WalletAccount, WalletWithRequiredFeatures } from '@mysten/wallet-standard';
import { useSuiSafe } from '@/app/sui-providers';

interface SuiWalletConnectProps {
  showSelector: boolean;
  onToggleSelector: () => void;
  onClose: () => void;
}

/**
 * Sui Wallet Connection Component
 * Dynamically imported to avoid loading @mysten/dapp-kit for EVM-only users
 */
export function SuiWalletConnect({ 
  showSelector, 
  onToggleSelector, 
  onClose 
}: SuiWalletConnectProps) {
  const [copied, setCopied] = useState(false);
  const [showNetworkHelp, setShowNetworkHelp] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
  }, []);
  
  // Sui wallet hooks
  const wallets = useWallets() || [];
  const suiAccount = useCurrentAccount();
  const { currentWallet, connectionStatus } = useCurrentWallet() || {};
  const { mutate: connectSui, isPending: isConnectingSui } = useConnectWallet();
  const { mutate: disconnectSui } = useDisconnectWallet();
  
  // Get SUI network status from context
  const suiContext = useSuiSafe();
  const suiIsWrongNetwork = suiContext?.isWrongNetwork ?? false;
  const suiWalletNetwork = suiContext?.walletNetwork ?? null;
  const suiExpectedNetwork = suiContext?.network ?? 'mainnet';
  
  const suiAddress = suiAccount?.address ?? null;
  const isSuiConnected = connectionStatus === 'connected' && !!suiAddress;
  const walletName = currentWallet?.name ?? 'SUI';
  
  // Filter to only Sui-compatible wallets
  const suiWallets = wallets.filter((w) => 
    w.chains?.some?.((c: string) => c.includes('sui'))
  );

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const handleConnectSui = useCallback((wallet: WalletWithRequiredFeatures) => {
    try {
      connectSui({ wallet });
    } catch (e) {
      logger.error('Failed to connect Sui wallet', e instanceof Error ? e : undefined, { component: 'SuiWalletConnect' });
    }
  }, [connectSui]);

  const handleDisconnectSui = useCallback(() => {
    try {
      disconnectSui();
    } catch (e) {
      logger.warn('Failed to disconnect Sui wallet', { component: 'SuiWalletConnect', error: String(e) });
    }
    onClose();
  }, [disconnectSui, onClose]);

  if (isSuiConnected) {
    return (
      <div className="relative">
        <button
          onClick={onToggleSelector}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border border-blue-400/30 hover:border-blue-400/50 transition-all duration-200"
        >
          {suiIsWrongNetwork && (
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
          )}
          <span className="text-sm font-medium text-white">{walletName}</span>
          <span className="text-xs text-blue-400 font-mono">{truncate(suiAddress!)}</span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>
        
        {showSelector && (
          <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div className="absolute right-0 top-full mt-2 w-72 bg-gray-900 rounded-xl border border-gray-700/50 shadow-xl z-50 overflow-hidden">
              <div className="p-4 border-b border-gray-700/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">Connected SUI Wallet</span>
                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">{walletName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-white">{truncate(suiAddress!)}</span>
                  <button 
                    onClick={() => copyAddress(suiAddress!)}
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                  <a 
                    href={`https://suiscan.xyz/${suiExpectedNetwork}/account/${suiAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-gray-400" />
                  </a>
                </div>
              </div>
              
              {/* Network Warning */}
              {suiIsWrongNetwork && (
                <div className="p-4 bg-yellow-900/20 border-b border-yellow-700/30">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-yellow-400 font-medium">⚠️ Network Mismatch</p>
                      <p className="text-gray-400 text-xs mt-1">
                        Your wallet: <span className="text-red-400 font-medium">{suiWalletNetwork || 'unknown'}</span><br />
                        App requires: <span className="text-green-400 font-medium">{suiExpectedNetwork}</span>
                      </p>
                      <div className="mt-3 p-2 bg-gray-800/50 rounded text-xs text-gray-300">
                        <p className="font-medium text-yellow-400 mb-1">How to fix:</p>
                        <ol className="list-decimal list-inside space-y-1 text-gray-400">
                          <li>Open your SUI wallet extension</li>
                          <li>Go to Settings → Network</li>
                          <li>Switch to <span className="text-green-400">{suiExpectedNetwork}</span></li>
                          <li>Reconnect to this app</li>
                        </ol>
                      </div>
                      <p className="text-gray-500 text-xs mt-2 italic">
                        Note: SUI wallets don&apos;t support automatic network switching
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="p-2">
                <button
                  onClick={handleDisconnectSui}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800 text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-sm">Disconnect</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Not connected - show wallet picker
  return (
    <div className="relative">
      <button
        onClick={onToggleSelector}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-400/20 hover:border-blue-400/40 transition-all duration-200"
      >
        <Wallet className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-blue-400">Connect SUI</span>
      </button>
      
      {showSelector && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute right-0 top-full mt-2 w-72 bg-gray-900 rounded-xl border border-gray-700/50 shadow-xl z-50">
            <div className="p-4 border-b border-gray-700/30">
              <span className="text-sm font-medium text-white">Connect SUI Wallet</span>
            </div>
            
            <div className="p-2 max-h-64 overflow-y-auto">
              {suiWallets.length > 0 ? (
                suiWallets.map((wallet) => (
                  <button
                    key={wallet.name}
                    onClick={() => handleConnectSui(wallet)}
                    disabled={isConnectingSui}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    {wallet.icon && (
                      <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 rounded-lg" />
                    )}
                    <span className="text-sm text-white">{wallet.name}</span>
                  </button>
                ))
              ) : isMobile ? (
                <div className="p-4 text-center">
                  <Smartphone className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-300 mb-3">
                    Tap below to open this page in the Slush wallet app where you can connect.
                  </p>
                  <a
                    href={`https://my.slush.app/browse/${encodeURIComponent(window.location.origin)}`}
                    className="inline-block w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors mb-2"
                  >
                    Open in Slush
                  </a>
                  <a 
                    href="https://slush.app/download" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline text-xs"
                  >
                    Don&apos;t have Slush? Download it →
                  </a>
                </div>
              ) : (
                <div className="p-4 text-center text-gray-400 text-sm">
                  <p>No SUI wallets detected.</p>
                  <a 
                    href="https://slush.app/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline block mt-2"
                  >
                    Get Slush Wallet →
                  </a>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Placeholder for when Sui provider is not loaded
export function SuiWalletPlaceholder({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-400/20 hover:border-blue-400/40 transition-all duration-200 opacity-75"
    >
      <Wallet className="w-4 h-4 text-blue-400" />
      <span className="text-sm font-medium text-blue-400">SUI</span>
    </button>
  );
}
