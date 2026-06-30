import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Unified Portfolio | ZkVanguard',
  description:
    'Aggregated view of your positions across the SUI USDC pool, private hedges, and custom portfolios — one wallet, one NAV, one consolidated P&L.',
  openGraph: {
    title: 'Unified Portfolio | ZkVanguard',
    description:
      'Aggregated exposure across every ZkVanguard product, mirroring BlackRock\'s consolidated-statement model.',
    type: 'website',
  },
};

export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
