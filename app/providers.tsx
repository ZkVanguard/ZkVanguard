'use client';

import { ReactNode } from 'react';
import { WagmiConfig, createConfig, configureChains } from 'wagmi';
import { CronoszkEVMTestnet } from '@/lib/chains';
import { publicProvider } from 'wagmi/providers/public';
import { MetaMaskConnector } from 'wagmi/connectors/metaMask';
import { WalletConnectConnector } from 'wagmi/connectors/walletConnect';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider as CustomThemeProvider } from '@/contexts/ThemeContext';

const { chains, publicClient, webSocketPublicClient } = configureChains(
  [CronoszkEVMTestnet],
  [publicProvider()]
);

const config = createConfig({
  autoConnect: true,
  connectors: [
    new MetaMaskConnector({ chains }),
  ],
  publicClient,
  webSocketPublicClient,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CustomThemeProvider>
      <WagmiConfig config={config}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </WagmiConfig>
    </CustomThemeProvider>
  );
}
