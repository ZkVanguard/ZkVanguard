import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developer API | ZkVanguard',
  description:
    'Aladdin-as-a-Service for Sui builders — ~50 API endpoints across risk, signals, agent orchestration, hedge routing, ZK proofs. Free public reads, paid write tier.',
  openGraph: {
    title: 'Developer API | ZkVanguard',
    description:
      'The same risk engine + 7-agent autonomy that runs the live SUI vault is documented and reachable as a B2B SDK.',
    type: 'website',
  },
};

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
