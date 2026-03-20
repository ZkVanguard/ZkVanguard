/**
 * WDK Connect Button
 * 
 * Self-custodial wallet connect component powered by Tether WDK.
 * Replaces RainbowKit ConnectButton.
 * 
 * Features:
 * - Create new wallet (shows seed phrase for backup)
 * - Import existing wallet
 * - Chain switching
 * - Account display
 */

'use client';

import React, { useState, useCallback, Fragment } from 'react';
import { useWdk, useWdkAccount, useWdkChain } from '@/lib/wdk/wdk-context';
import { WDK_CHAINS } from '@/lib/config/wdk';

// ============================================
// TYPES
// ============================================

interface WdkConnectButtonProps {
  className?: string;
  showBalance?: boolean;
}

type ModalView = 'none' | 'connect' | 'create' | 'import' | 'backup' | 'account' | 'chains';

// ============================================
// STYLES
// ============================================

const buttonStyles = {
  primary: 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors',
  secondary: 'px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors',
  danger: 'px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors',
  outline: 'px-4 py-2 border border-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors',
};

const modalStyles = {
  overlay: 'fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4',
  container: 'bg-gray-900 rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl border border-gray-800',
  title: 'text-xl font-bold text-white mb-4',
  subtitle: 'text-gray-400 text-sm mb-4',
  input: 'w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500',
  textarea: 'w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none',
};

// ============================================
// COMPONENT
// ============================================

export function WdkConnectButton({ className, showBalance = false }: WdkConnectButtonProps) {
  const { state, createWallet, importWallet, disconnect, lockWallet, unlockWallet } = useWdk();
  const { address, isConnected, chainKey } = useWdkAccount();
  const { switchChain, supportedChains } = useWdkChain();
  
  const [modalView, setModalView] = useState<ModalView>('none');
  const [seedPhrase, setSeedPhrase] = useState<string>('');
  const [importPhrase, setImportPhrase] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [seedCopied, setSeedCopied] = useState(false);
  const [seedConfirmed, setSeedConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Format address for display
  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };
  
  // Handle create wallet
  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    const mnemonic = await createWallet();
    if (mnemonic) {
      setSeedPhrase(mnemonic);
      setModalView('backup');
    } else {
      setError('Failed to create wallet');
    }
    
    setLoading(false);
  }, [createWallet]);
  
  // Handle import wallet
  const handleImport = useCallback(async () => {
    if (!importPhrase.trim()) {
      setError('Please enter your seed phrase');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const success = await importWallet(importPhrase.trim());
    if (success) {
      setImportPhrase('');
      setModalView('none');
    } else {
      setError(state.error || 'Failed to import wallet');
    }
    
    setLoading(false);
  }, [importWallet, importPhrase, state.error]);
  
  // Handle copy seed phrase
  const handleCopySeed = useCallback(() => {
    navigator.clipboard.writeText(seedPhrase);
    setSeedCopied(true);
    setTimeout(() => setSeedCopied(false), 2000);
  }, [seedPhrase]);
  
  // Handle seed backup confirmation
  const handleSeedConfirmed = useCallback(() => {
    if (!seedConfirmed) {
      setError('Please confirm you have saved your seed phrase');
      return;
    }
    setSeedPhrase('');
    setSeedConfirmed(false);
    setModalView('none');
  }, [seedConfirmed]);
  
  // Handle chain switch
  const handleSwitchChain = useCallback(async (chain: string) => {
    setLoading(true);
    await switchChain(chain);
    setLoading(false);
    setModalView('none');
  }, [switchChain]);
  
  // Handle disconnect
  const handleDisconnect = useCallback(() => {
    disconnect();
    setModalView('none');
  }, [disconnect]);
  
  // Close modal
  const closeModal = useCallback(() => {
    setModalView('none');
    setError(null);
    setImportPhrase('');
    setPassword('');
  }, []);
  
  // Get chain info
  const currentChain = chainKey ? WDK_CHAINS[chainKey] : null;
  
  // Render button
  const renderButton = () => {
    if (state.isLoading) {
      return (
        <button className={`${buttonStyles.secondary} ${className}`} disabled>
          <span className="animate-pulse">Loading...</span>
        </button>
      );
    }
    
    if (isConnected && address) {
      return (
        <div className="flex items-center gap-2">
          {/* Chain Badge */}
          <button
            onClick={() => setModalView('chains')}
            className={`${buttonStyles.outline} !px-3`}
            title="Switch chain"
          >
            {currentChain?.name || 'Unknown'}
          </button>
          
          {/* Account Button */}
          <button
            onClick={() => setModalView('account')}
            className={`${buttonStyles.primary} ${className}`}
          >
            {formatAddress(address)}
          </button>
        </div>
      );
    }
    
    // Has stored wallet - show unlock
    if (state.chainKey) {
      return (
        <button
          onClick={() => setModalView('connect')}
          className={`${buttonStyles.primary} ${className}`}
        >
          Unlock Wallet
        </button>
      );
    }
    
    return (
      <button
        onClick={() => setModalView('connect')}
        className={`${buttonStyles.primary} ${className}`}
      >
        Connect Wallet
      </button>
    );
  };
  
  // Render modal content
  const renderModalContent = () => {
    switch (modalView) {
      case 'connect':
        return (
          <div className={modalStyles.container}>
            <h2 className={modalStyles.title}>Connect Wallet</h2>
            <p className={modalStyles.subtitle}>
              Powered by Tether WDK - Self-custodial multi-chain wallet
            </p>
            
            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}
            
            <div className="space-y-3">
              <button
                onClick={handleCreate}
                disabled={loading}
                className={`${buttonStyles.primary} w-full`}
              >
                {loading ? 'Creating...' : 'Create New Wallet'}
              </button>
              
              <button
                onClick={() => setModalView('import')}
                className={`${buttonStyles.secondary} w-full`}
              >
                Import Existing Wallet
              </button>
              
              <button
                onClick={closeModal}
                className={`${buttonStyles.outline} w-full`}
              >
                Cancel
              </button>
            </div>
            
            <p className="mt-4 text-xs text-gray-500 text-center">
              Your keys, your coins. WDK wallets are fully self-custodial.
            </p>
          </div>
        );
      
      case 'import':
        return (
          <div className={modalStyles.container}>
            <h2 className={modalStyles.title}>Import Wallet</h2>
            <p className={modalStyles.subtitle}>
              Enter your 12 or 24 word seed phrase
            </p>
            
            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}
            
            <textarea
              value={importPhrase}
              onChange={(e) => setImportPhrase(e.target.value)}
              placeholder="word1 word2 word3 ... word12"
              rows={4}
              className={`${modalStyles.textarea} mb-4`}
            />
            
            <div className="space-y-3">
              <button
                onClick={handleImport}
                disabled={loading || !importPhrase.trim()}
                className={`${buttonStyles.primary} w-full`}
              >
                {loading ? 'Importing...' : 'Import Wallet'}
              </button>
              
              <button
                onClick={() => setModalView('connect')}
                className={`${buttonStyles.outline} w-full`}
              >
                Back
              </button>
            </div>
            
            <p className="mt-4 text-xs text-gray-500 text-center">
              Your seed phrase never leaves your device.
            </p>
          </div>
        );
      
      case 'backup':
        return (
          <div className={modalStyles.container}>
            <h2 className={modalStyles.title}>🔐 Backup Seed Phrase</h2>
            <p className={modalStyles.subtitle}>
              Write down these words and store them safely. This is the ONLY way to recover your wallet.
            </p>
            
            <div className="p-4 bg-yellow-900/30 border border-yellow-600 rounded-lg mb-4">
              <p className="text-yellow-300 text-sm font-medium mb-2">⚠️ WARNING</p>
              <p className="text-yellow-200 text-xs">
                Never share your seed phrase. Anyone with these words can access your funds.
              </p>
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
              className={`${buttonStyles.secondary} w-full mb-4`}
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
              <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}
            
            <button
              onClick={handleSeedConfirmed}
              className={`${buttonStyles.primary} w-full`}
            >
              Continue
            </button>
          </div>
        );
      
      case 'account':
        return (
          <div className={modalStyles.container}>
            <h2 className={modalStyles.title}>Account</h2>
            
            <div className="p-4 bg-gray-800 rounded-lg mb-4">
              <p className="text-gray-400 text-xs mb-1">Address</p>
              <p className="text-white font-mono text-sm break-all">{address}</p>
            </div>
            
            <div className="p-4 bg-gray-800 rounded-lg mb-4">
              <p className="text-gray-400 text-xs mb-1">Network</p>
              <p className="text-white">{currentChain?.name}</p>
            </div>
            
            <div className="space-y-3">
              <button
                onClick={() => setModalView('chains')}
                className={`${buttonStyles.secondary} w-full`}
              >
                Switch Chain
              </button>
              
              <button
                onClick={lockWallet}
                className={`${buttonStyles.outline} w-full`}
              >
                Lock Wallet
              </button>
              
              <button
                onClick={handleDisconnect}
                className={`${buttonStyles.danger} w-full`}
              >
                Disconnect
              </button>
              
              <button
                onClick={closeModal}
                className={`${buttonStyles.outline} w-full`}
              >
                Close
              </button>
            </div>
          </div>
        );
      
      case 'chains':
        return (
          <div className={modalStyles.container}>
            <h2 className={modalStyles.title}>Select Network</h2>
            
            <div className="space-y-2 mb-4">
              {supportedChains.map((chain) => {
                const config = WDK_CHAINS[chain];
                if (!config) return null;
                
                const isActive = chainKey === chain;
                
                return (
                  <button
                    key={chain}
                    onClick={() => handleSwitchChain(chain)}
                    disabled={loading}
                    className={`w-full p-4 rounded-lg border transition-colors text-left ${
                      isActive
                        ? 'bg-blue-900/50 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{config.name}</p>
                        <p className="text-xs text-gray-500">
                          Chain ID: {config.chainId} • {config.network}
                        </p>
                      </div>
                      {isActive && (
                        <span className="text-blue-400">✓</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            
            <button
              onClick={closeModal}
              className={`${buttonStyles.outline} w-full`}
            >
              Close
            </button>
          </div>
        );
      
      default:
        return null;
    }
  };
  
  return (
    <>
      {renderButton()}
      
      {/* Modal */}
      {modalView !== 'none' && (
        <div className={modalStyles.overlay} onClick={closeModal}>
          <div onClick={(e) => e.stopPropagation()}>
            {renderModalContent()}
          </div>
        </div>
      )}
    </>
  );
}

export default WdkConnectButton;
