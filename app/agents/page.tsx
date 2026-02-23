import { permanentRedirect } from 'next/navigation';

export default function AgentsRedirect() {
  permanentRedirect('/en/agents');
}

// Ensure the redirect works for RSC prefetch
export const dynamic = 'force-dynamic';
