import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Custody Attestations | ZkVanguard',
  description:
    'Institutional custodian-signed attestations binding your portfolio to off-chain backing — verifiable by counterparties without revealing the asset list. Powered by rwa_custody_attestor.move.',
  openGraph: {
    title: 'Custody Attestations | ZkVanguard',
    description:
      'Cryptographic proof of off-chain asset backing on Sui — ed25519 signatures, SHA-256 commitments, never the asset list.',
    type: 'website',
  },
};

export default function CustodyProofsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
