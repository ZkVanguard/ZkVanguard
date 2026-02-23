import { redirect, permanentRedirect } from 'next/navigation';

// Handle RSC prefetch properly by using permanentRedirect
export default function DocsRedirect() {
  // Use permanentRedirect for better caching and RSC compatibility
  permanentRedirect('/en/docs');
}

// Ensure the redirect works for all HTTP methods
export const dynamic = 'force-dynamic';
