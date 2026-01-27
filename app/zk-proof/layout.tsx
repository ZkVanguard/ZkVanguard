import { ReactNode } from 'react';

// Force dynamic rendering - this route requires WagmiProvider at runtime
export const dynamic = 'force-dynamic';

export default function ZkProofLayout({ children }: { children: ReactNode }) {
  return children;
}
