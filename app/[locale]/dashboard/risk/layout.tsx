import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Platform Risk | ZkVanguard',
  description:
    'Live institutional risk overview — TVL, drawdown, hedge coverage, cron health, ZK attestation feed. The Aladdin-equivalent for autonomous DeFi on Sui.',
  openGraph: {
    title: 'Platform Risk | ZkVanguard',
    description:
      'Real-time aggregate risk metrics for the ZkVanguard autonomous asset-management platform on Sui mainnet.',
    type: 'website',
  },
};

export default function RiskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
