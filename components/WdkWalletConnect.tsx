/**
 * WDK Wallet Connect Component
 * 
 * Allows users to create or import a Tether WDK wallet
 * for native USDT experience without external wallets.
 */

'use client';

import { useState, useCallback } from 'react';
import { useWdkSafe } from '@/lib/wdk/wdk-provider-stub';

interface WdkWalletConnectProps {
  onConnect?: (address: string) => void;
  className?: string;
}

export function WdkWalletConnect({ onConnect, className = '' }: WdkWalletConnectProps) {
  const wdk = useWdkSafe();
  const [showImport, setShowImport] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [showBackup, setShowBackup] = useState(false);
  const [newPhrase, setNewPhrase] = useState<string | null>(null);
  const [phraseWasCopied, setPhraseWasCopied] = useState(false);

  // Handle wallet creation
  const handleCreate = useCallback(async () => {
    if (!wdk) return;
    
    const phrase = await wdk.createWallet();
    if (phrase) {
      setNewPhrase(phrase);
      setShowBackup(true);
      if (wdk.wallet.address && onConnect) {
        // Wait for state update
        setTimeout(() => {
          if (wdk.wallet.address) {
            onConnect(wdk.wallet.address);
          }
        }, 100);
      }
    }
  }, [wdk, onConnect]);

  // Handle wallet import
  const handleImport = useCallback(async () => {
    if (!wdk || !phraseInput.trim()) return;
    
    const success = await wdk.importWallet(phraseInput.trim());
    if (success && wdk.wallet.address && onConnect) {
      onConnect(wdk.wallet.address);
      setShowImport(false);
      setPhraseInput('');
    }
  }, [wdk, phraseInput, onConnect]);

  // Copy phrase to clipboard
  const copyPhrase = useCallback(async () => {
    if (newPhrase) {
      await navigator.clipboard.writeText(newPhrase);
      setPhraseWasCopied(true);
      setTimeout(() => setPhraseWasCopied(false), 2000);
    }
  }, [newPhrase]);

  // Confirm backup complete
  const confirmBackup = useCallback(() => {
    setShowBackup(false);
    setNewPhrase(null);
  }, []);

  if (!wdk) {
    return (
      <div className={`text-sm text-gray-500 ${className}`}>
        WDK not available
      </div>
    );
  }

  // Connected state
  if (wdk.wallet.isInitialized && wdk.wallet.address) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-sm font-mono text-emerald-400">
            {wdk.wallet.address.slice(0, 6)}...{wdk.wallet.address.slice(-4)}
          </span>
          <span className="text-xs px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded">
            WDK
          </span>
        </div>
        <button
          onClick={wdk.disconnectWallet}
          className="text-xs text-gray-400 hover:text-red-400 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  // Backup modal
  if (showBackup && newPhrase) {
    return (
      <div className={`p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg ${className}`}>
        <h4 className="text-yellow-400 font-semibold mb-2 flex items-center gap-2">
          <span>⚠️</span> Save Your Recovery Phrase
        </h4>
        <p className="text-xs text-gray-400 mb-3">
          Write down these 12 words in order. You&apos;ll need them to recover your wallet.
        </p>
        <div className="p-3 bg-black/30 rounded-lg mb-3 font-mono text-sm text-white break-all">
          {newPhrase}
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyPhrase}
            className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
          >
            {phraseWasCopied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onClick={confirmBackup}
            className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg transition-colors"
          >
            I&apos;ve Saved It
          </button>
        </div>
      </div>
    );
  }

  // Import modal
  if (showImport) {
    return (
      <div className={`p-4 bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
        <h4 className="text-white font-semibold mb-2">Import WDK Wallet</h4>
        <textarea
          value={phraseInput}
          onChange={(e) => setPhraseInput(e.target.value)}
          placeholder="Enter your 12-word recovery phrase..."
          className="w-full h-20 p-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm font-mono resize-none focus:outline-none focus:border-cyan-500"
        />
        {wdk.wallet.error && (
          <p className="text-red-400 text-xs mt-1">{wdk.wallet.error}</p>
        )}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setShowImport(false)}
            className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!phraseInput.trim() || wdk.wallet.isCreating}
            className="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
          >
            {wdk.wallet.isCreating ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    );
  }

  // Default connect buttons
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        onClick={handleCreate}
        disabled={wdk.wallet.isCreating}
        className="w-full px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
      >
        {wdk.wallet.isCreating ? (
          <>
            <span className="animate-spin">⟳</span>
            Creating...
          </>
        ) : (
          <>
            <span className="text-lg">₮</span>
            Create USDT Wallet
          </>
        )}
      </button>
      <button
        onClick={() => setShowImport(true)}
        className="w-full px-4 py-2 bg-transparent border border-gray-600 hover:border-gray-500 text-gray-300 text-sm rounded-lg transition-colors"
      >
        Import Existing Wallet
      </button>
      <p className="text-xs text-gray-500 text-center">
        Powered by Tether WDK - No MetaMask required
      </p>
    </div>
  );
}
