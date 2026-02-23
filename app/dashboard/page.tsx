import { permanentRedirect } from 'next/navigation';

export default function DashboardRedirect() {
  permanentRedirect('/en/dashboard');
}

// Ensure the redirect works for RSC prefetch
export const dynamic = 'force-dynamic';
