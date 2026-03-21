'use client';

// MUST be imported first - sets up BigInt serialization and fetch interceptor
import './api-interceptor';

import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider as CustomThemeProvider } from '../contexts/ThemeContext';
import { PositionsProvider } from '../contexts/PositionsContext';
import { AIDecisionsProvider } from '../contexts/AIDecisionsContext';
// WDK Provider - Native Tether self-custodial wallet
import { WdkProvider } from '../lib/wdk/wdk-context';
// WDK Modal - rendered outside Navbar to avoid backdrop-filter stacking context
import { WdkModalProvider } from '../contexts/WdkModalContext';

// Sui - use the complete provider that includes SuiContext
import { SuiWalletProviders } from './sui-providers';

// Singleton QueryClient instance
let queryClientInstance: QueryClient | null = null;
function getQueryClient() {
  if (!queryClientInstance) {
    queryClientInstance = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 2,
          staleTime: 120_000,
          gcTime: 600_000,
          refetchOnMount: false,
          refetchOnReconnect: false,
        },
      },
    });
  }
  return queryClientInstance;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <CustomThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* Tether WDK Provider - Native self-custodial wallet */}
        <WdkProvider defaultChain="sepolia">
          {/* Sui Provider with full context support */}
          <SuiWalletProviders defaultNetwork="testnet" skipQueryProvider>
            <PositionsProvider>
              <AIDecisionsProvider>
                {/* WdkModalProvider renders the modal as a sibling of Navbar,
                    outside the backdrop-filter stacking context */}
                <WdkModalProvider>
                  {children}
                </WdkModalProvider>
              </AIDecisionsProvider>
            </PositionsProvider>
          </SuiWalletProviders>
        </WdkProvider>
      </QueryClientProvider>
    </CustomThemeProvider>
  );
}
