'use client';

import { ReactNode } from 'react';
import { PositionsProvider } from '@/contexts/PositionsContext';
import { AIDecisionsProvider } from '@/contexts/AIDecisionsContext';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <PositionsProvider>
      <AIDecisionsProvider>
        {children}
      </AIDecisionsProvider>
    </PositionsProvider>
  );
}
