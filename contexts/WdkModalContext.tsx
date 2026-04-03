'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useWdk } from '@/lib/wdk/wdk-context';

type ModalMode = 'none' | 'connect' | 'import' | 'backup' | 'unlock' | 'setup-passkey';

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
  const { state: wdkState } = useWdk();

  const openWdkModal = useCallback(() => {
    // If a wallet exists and not unlocked, default to unlock screen
    if (wdkState.hasWallet && !wdkState.isUnlocked) {
      setMode('unlock');
    } else {
      setMode('connect');
    }
  }, [wdkState.hasWallet, wdkState.isUnlocked]);

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
  mode: 'connect' | 'import' | 'backup' | 'unlock' | 'setup-passkey';
  onClose: () => void;
  onModeChange: (mode: ModalMode) => void;
}) {
  const { state: wdkState, createWallet, importWallet, loginWithPasskey, registerPasskey, lockWallet, unlockWallet } = useWdk();
  const [seedPhrase, setSeedPhrase] = useState('');
  const [seedCopied, setSeedCopied] = useState(false);
  const [seedConfirmed, setSeedConfirmed] = useState(false);
  const [importPhrase, setImportPhrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPasswordFallback, setShowPasswordFallback] = useState(false);
  const [password, setPassword] = useState('');

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
      // Transition to setup-passkey
      onModeChange('setup-passkey');
    } else {
      setError(wdkState.error || 'Failed to import wallet');
    }
    setLoading(false);
  };

  const handleUnlock = async () => {
    setLoading(true);
    setError(null);
    try {
      const success = await loginWithPasskey();
      if (success) {
        onClose();
      } else {
        console.error('[WdkModal]   ❌ loginWithPasskey returned false');
        setError('Passkey verification failed. Try password fallback below.');
        setShowPasswordFallback(true);
      }
    } catch (e: any) {
      console.error('[WdkModal]   ❌ handleUnlock exception:', e?.message, e);
      setError(e?.message || 'Passkey failed. Try password fallback below.');
      setShowPasswordFallback(true);
    }
    setLoading(false);
  };

  const handlePasswordUnlock = async () => {
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const success = await unlockWallet(password);
      if (success) {
        setPassword('');
        setShowPasswordFallback(false);
        onClose();
      } else {
        setError(wdkState.error || 'Unlock failed — check your password');
      }
    } catch (e: any) {
      setError(e?.message || 'Unlock failed');
    }
    setLoading(false);
  };

  const handleCopySeed = () => {
    navigator.clipboard.writeText(seedPhrase);
    setSeedCopied(true);
    setTimeout(() => setSeedCopied(false), 2000);
  };

  const handleSeedConfirmed = async () => {
    if (!seedConfirmed) {
      setError('Please confirm you have saved your seed phrase');
      return;
    }
    // Offer passkey registration
    onModeChange('setup-passkey');
  };

  const handleEnablePasskey = async () => {
    setLoading(true);
    setError(null);
    try {
      const success = await registerPasskey();
      if (success) {
        onClose();
      } else {
        // Fallback error if registration returned false (cancelled/failed)
        setError('Passkey setup cancelled or failed');
      }
    } catch (e) {
      setError('An unexpected error occurred');
    }
    setLoading(false);
  };

  // Reset local state when mode changes
  // useEffect(() => { setError(null); setLoading(false); }, [mode]);

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
              {(wdkState.hasPasskey || localStorage.getItem('wdk-wallet-storage') || true) && !wdkState.isUnlocked && (
                <button
                  onClick={() => onModeChange('unlock')}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                >
                  <span className="text-lg">🔐</span> 
                  {(wdkState.hasPasskey || (typeof window !== 'undefined' && localStorage.getItem('wdk-wallet-storage'))) ? 'Sign In with Passkey' : 'Recover with Passkey'}
                </button>
              )}
              
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

        {mode === 'unlock' && (
            <>
              <h2 className="text-xl font-bold text-white mb-2">Welcome Back!</h2>
              <p className="text-gray-400 text-sm mb-4">
                Unlock your WDK wallet using your secured passkey (FaceID / TouchID).
              </p>
  
              {error && (
                <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}
  
              <div className="space-y-3">
                <button
                  onClick={handleUnlock}
                  disabled={loading}
                  className="w-full px-4 py-6 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex flex-col items-center justify-center gap-2"
                >
                  <span className="text-2xl">🔐</span>
                  <span>{loading && !showPasswordFallback ? 'Verifying...' : 'Authenticate with Passkey'}</span>
                </button>

                {/* Password fallback — shown when passkey fails */}
                {showPasswordFallback && (
                  <div className="p-3 bg-gray-800 rounded-lg space-y-2">
                    <p className="text-gray-400 text-xs">Or unlock with password:</p>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handlePasswordUnlock()}
                      placeholder="Enter password"
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handlePasswordUnlock}
                      disabled={loading || !password.trim()}
                      className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                    >
                      {loading ? 'Unlocking...' : 'Unlock with Password'}
                    </button>
                  </div>
                )}
                
                <div className="text-center">
                    <button
                    onClick={() => onModeChange('import')}
                    className="text-gray-400 text-sm hover:text-white underline mt-2"
                    >
                    Reset / Import different wallet
                    </button>
                </div>

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
        {mode === 'setup-passkey' && (
          <>
            <h2 className="text-xl font-bold text-white mb-2">Enable Passkey</h2>
            <p className="text-gray-400 text-sm mb-4">
              Secure your wallet with biometric authentication (TouchID, FaceID, or YubiKey) for instant login next time.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={handleEnablePasskey}
                disabled={loading}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                {loading ? 'Activating Browser Prompt...' : 'Add Passkey'}
              </button>
              
              <button
                onClick={onClose}
                className="w-full px-4 py-3 text-gray-400 hover:text-white rounded-lg font-medium"
              >
                Skip for now
              </button>
            </div>
          </>
        )}      </div>
    </div>
  );
}
