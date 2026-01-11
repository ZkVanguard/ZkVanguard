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
    // Defer wallet loading until after initial render
    const timer = setTimeout(() => {
      setShouldLoadWallet(true);
    }, 100); // Load after 100ms to allow critical content to render first
    
    return () => clearTimeout(timer);
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
