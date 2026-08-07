import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Platform Risk | ZkWard',
  description:
    'Live institutional risk overview — TVL, drawdown, hedge coverage, cron health, ZK attestation feed. The Aladdin-equivalent for autonomous DeFi on Sui.',
  openGraph: {
    title: 'Platform Risk | ZkWard',
    description:
      'Real-time aggregate risk metrics for the ZkWard autonomous asset-management platform on Sui mainnet.',
    type: 'website',
  },
};

export default function RiskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
