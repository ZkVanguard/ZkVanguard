'use client';

import { ReactNode, useState, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';

// Lazy load the heavy wallet providers
const WalletProviders = dynamic(() => import('./wallet-providers').then(mod => ({ default: mod.WalletProviders })), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .loading-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}} />
      <div className="fixed top-4 right-4 bg-white shadow-lg rounded-lg p-3 loading-pulse">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm text-gray-600">Loading wallet...</span>
        </div>
      </div>
    </div>
  ),
});

export function LazyProviders({ children }: { children: ReactNode }) {
  const [shouldLoadWallet, setShouldLoadWallet] = useState(false);
  
  useEffect(() => {
    // Use requestIdleCallback to load wallet providers during browser idle time
    // Falls back to 150ms timeout if requestIdleCallback is not available
    if ('requestIdleCallback' in window) {
      const id = (window as typeof window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(
        () => setShouldLoadWallet(true),
        { timeout: 2000 } // Max 2s delay
      );
      return () => (window as typeof window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
    } else {
      const timer = setTimeout(() => setShouldLoadWallet(true), 150);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!shouldLoadWallet) {
    // Render content without wallet providers for ultra-fast initial load
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <Suspense fallback={children}>
      <WalletProviders>{children}</WalletProviders>
    </Suspense>
  );
}
