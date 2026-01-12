'use client';

import { ReactNode, useMemo } from 'react';
import { WagmiProvider } from 'wagmi';
import { CronosTestnet, CronosMainnet } from '../lib/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { ThemeProvider as CustomThemeProvider } from '../contexts/ThemeContext';
import { PositionsProvider } from '../contexts/PositionsContext';
import '@rainbow-me/rainbowkit/styles.css';

// Production-ready configuration for Cronos x402 Paytech Hackathon
// Trim to remove any accidental whitespace/newlines from env vars
const projectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID').trim();

// Create config and queryClient OUTSIDE component to prevent recreation
// This fixes the "WalletConnect Core is already initialized" warning
const config = getDefaultConfig({
  appName: 'ZkVanguard',
  projectId,
  chains: [CronosTestnet, CronosMainnet],
  ssr: true,
});

// Singleton QueryClient instance
let queryClientInstance: QueryClient | null = null;
function getQueryClient() {
  if (!queryClientInstance) {
    queryClientInstance = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 2, // Reduced from 3 to fail faster
          staleTime: 120_000, // Increased from 60s to 2min
          gcTime: 600_000, // Increased from 5min to 10min
          // Add deduplication
          refetchOnMount: false,
          refetchOnReconnect: false,
        },
      },
    });
  }
  return queryClientInstance;
}

export function Providers({ children }: { children: ReactNode }) {
  // Memoize the theme to prevent recreation
  const rainbowKitTheme = useMemo(() => darkTheme({
    accentColor: '#007aff',
    accentColorForeground: 'white',
    borderRadius: 'large',
    fontStack: 'system',
  }), []);

  const queryClient = getQueryClient();

  return (
    <CustomThemeProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            modalSize="compact"
            theme={rainbowKitTheme}
          >
            <PositionsProvider>
              {children}
            </PositionsProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </CustomThemeProvider>
  );
}

// Export config for use in contract interactions
export { config };
