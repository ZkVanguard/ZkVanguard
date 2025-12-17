'use client';

import { ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected, coinbaseWallet } from 'wagmi/connectors';
import { CronosTestnet, CronosMainnet } from '@/lib/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { ThemeProvider as CustomThemeProvider } from '@/contexts/ThemeContext';
import '@rainbow-me/rainbowkit/styles.css';

// Production-ready configuration for Cronos x402 Paytech Hackathon
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// Validate Project ID exists
if (!projectId) {
  throw new Error(
    'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. Get one at https://cloud.walletconnect.com/'
  );
}

// Manual Wagmi configuration without WalletConnect to avoid AppKit API calls
const config = createConfig({
  chains: [CronosTestnet, CronosMainnet],
  transports: {
    [CronosTestnet.id]: http('https://evm-t3.cronos.org'),
    [CronosMainnet.id]: http('https://evm.cronos.org'),
  },
  connectors: [
    injected({
      shimDisconnect: true,
      target: 'metaMask',
    }),
    injected({
      shimDisconnect: true,
      target: 'coinbaseWallet',
    }),
    injected({
      shimDisconnect: true,
      target: 'braveWallet',
    }),
    injected({
      shimDisconnect: true,
      target: 'trust',
    }),
    coinbaseWallet({
      appName: 'ZkVanguard',
      darkMode: false,
    }),
  ],
  ssr: true,
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

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CustomThemeProvider>
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
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </CustomThemeProvider>
  );
}

// Export config for use in contract interactions
export { config };
