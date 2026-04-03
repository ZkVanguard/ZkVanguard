'use client';

// MUST be imported first - sets up BigInt serialization and fetch interceptor
import './api-interceptor';

import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider as CustomThemeProvider } from '../contexts/ThemeContext';
// WDK Provider - Native Tether self-custodial wallet
import { WdkProvider } from '../lib/wdk/wdk-context';
// WDK Modal - rendered outside Navbar to avoid backdrop-filter stacking context
import { WdkModalProvider } from '../contexts/WdkModalContext';

// Sui - use the complete provider that includes SuiContext
import { SuiWalletProviders } from './sui-providers';

// Singleton QueryClient instance — optimized for multi-user scale
let queryClientInstance: QueryClient | null = null;
function getQueryClient() {
  if (!queryClientInstance) {
    queryClientInstance = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 1,                      // Reduced from 2: fail fast for faster UX
          staleTime: 120_000,            // 2 minutes
          gcTime: 600_000,               // 10 minutes
          refetchOnMount: false,
          refetchOnReconnect: false,
          networkMode: 'offlineFirst',   // Use cache while offline, reduces refetches
        },
        mutations: {
          retry: 1,
          networkMode: 'offlineFirst',
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
        <WdkProvider defaultChain={process.env.NEXT_PUBLIC_DEFAULT_CHAIN || 'cronos-mainnet'}>
          {/* Sui Provider with full context support */}
          <SuiWalletProviders skipQueryProvider>
            {/* WdkModalProvider renders the modal as a sibling of Navbar,
                outside the backdrop-filter stacking context */}
            <WdkModalProvider>
              {children}
            </WdkModalProvider>
          </SuiWalletProviders>
        </WdkProvider>
      </QueryClientProvider>
    </CustomThemeProvider>
  );
}
