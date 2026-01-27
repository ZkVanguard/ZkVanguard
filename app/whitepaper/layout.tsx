import { ReactNode } from 'react';

// Force dynamic rendering - prevents prerender errors
export const dynamic = 'force-dynamic';

export default function WhitepaperLayout({ children }: { children: ReactNode }) {
  return children;
}
