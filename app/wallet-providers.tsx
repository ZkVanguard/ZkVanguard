'use client';

import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WdkProvider } from '@/lib/wdk/wdk-context';
import { PositionsProvider } from '../contexts/PositionsContext';

// Production-ready configuration for Tether WDK Hackathon
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
    <QueryClientProvider client={queryClient}>
      <WdkProvider>
        <PositionsProvider>
          {children}
        </PositionsProvider>
      </WdkProvider>
    </QueryClientProvider>
  );
}
