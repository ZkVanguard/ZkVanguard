'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useWdk } from '@/lib/wdk/wdk-context';

type ModalMode = 'none' | 'connect' | 'import' | 'backup';

interface WdkModalContextType {
  showWdkModal: ModalMode;
  openWdkModal: () => void;
  closeWdkModal: () => void;
}

const WdkModalContext = createContext<WdkModalContextType>({
  showWdkModal: 'none',
  openWdkModal: () => {},
  closeWdkModal: () => {},
});

export function useWdkModal() {
  return useContext(WdkModalContext);
}

export function WdkModalProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ModalMode>('none');

  const openWdkModal = useCallback(() => setMode('connect'), []);
  const closeWdkModal = useCallback(() => setMode('none'), []);

  return (
    <WdkModalContext.Provider value={{ showWdkModal: mode, openWdkModal, closeWdkModal }}>
      {children}
      {mode !== 'none' && (
        <WdkModalOverlay mode={mode} onModeChange={setMode} onClose={closeWdkModal} />
      )}
    </WdkModalContext.Provider>
  );
}

// Modal rendered at the provider level — completely outside Navbar's DOM tree
function WdkModalOverlay({
  mode,
  onClose,
  onModeChange,
}: {
  mode: 'connect' | 'import' | 'backup';
  onClose: () => void;
  onModeChange: (mode: ModalMode) => void;
}) {
  const { state: wdkState, createWallet, importWallet } = useWdk();
  const [seedPhrase, setSeedPhrase] = useState('');
  const [seedCopied, setSeedCopied] = useState(false);
  const [seedConfirmed, setSeedConfirmed] = useState(false);
  const [importPhrase, setImportPhrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    const mnemonic = await createWallet();
    if (mnemonic) {
      setSeedPhrase(mnemonic);
      onModeChange('backup');
    } else {
      setError('Failed to create wallet');
    }
    setLoading(false);
  };

  const handleImport = async () => {
    if (!importPhrase.trim()) {
      setError('Please enter your seed phrase');
      return;
    }
    setLoading(true);
    setError(null);
    const success = await importWallet(importPhrase.trim());
    if (success) {
      onClose();
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
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === 'connect' && (
          <>
            <h2 className="text-xl font-bold text-white mb-2">Connect Wallet</h2>
            <p className="text-gray-400 text-sm mb-4">
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
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
              >
                {loading ? 'Creating...' : 'Create New Wallet'}
              </button>
              <button
                onClick={() => onModeChange('import')}
                className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium"
              >
                Import Existing Wallet
              </button>
              <button
                onClick={onClose}
                className="w-full px-4 py-3 border border-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {mode === 'import' && (
          <>
            <h2 className="text-xl font-bold text-white mb-2">Import Wallet</h2>
            <p className="text-gray-400 text-sm mb-4">Enter your 12 or 24 word seed phrase</p>

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
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 mb-4 resize-none"
            />

            <div className="space-y-3">
              <button
                onClick={handleImport}
                disabled={loading || !importPhrase.trim()}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {loading ? 'Importing...' : 'Import Wallet'}
              </button>
              <button
                onClick={() => onModeChange('connect')}
                className="w-full px-4 py-3 border border-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium"
              >
                Back
              </button>
            </div>
          </>
        )}

        {mode === 'backup' && (
          <>
            <h2 className="text-xl font-bold text-white mb-2">
              🔐 Backup Seed Phrase
            </h2>
            <p className="text-gray-400 text-sm mb-4">
              Write down these words. This is the ONLY way to recover your wallet.
            </p>

            <div className="p-4 bg-yellow-900/30 border border-yellow-600 rounded-lg mb-4">
              <p className="text-yellow-300 text-sm font-medium">
                ⚠️ Never share your seed phrase!
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
              <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">
                {error}
              </div>
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
    </div>
  );
}
