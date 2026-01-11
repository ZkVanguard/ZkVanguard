'use client';

import { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { CronosTestnet, CronosMainnet } from '../lib/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { PositionsProvider } from '../contexts/PositionsContext';
import '@rainbow-me/rainbowkit/styles.css';

// Production-ready configuration for Cronos x402 Paytech Hackathon
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

// Use RainbowKit's getDefaultConfig for proper wallet configuration
const config = getDefaultConfig({
  appName: 'ZkVanguard',
  projectId,
  chains: [CronosTestnet, CronosMainnet],
  ssr: false, // Client-only for lazy loading
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 3,
      staleTime: 60_000,
      gcTime: 300_000,
    },
  },
});

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={darkTheme({
            accentColor: '#007aff',
            accentColorForeground: 'white',
            borderRadius: 'large',
            fontStack: 'system',
          })}
        >
          <PositionsProvider>
            {children}
          </PositionsProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// Export config for use in contract interactions
export { config };
