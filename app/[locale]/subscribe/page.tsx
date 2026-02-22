'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Subscribe Page
 * 
 * Handles subscription tier selection and redirects to dashboard.
 * In production, this would integrate with Stripe or another payment provider.
 */
export default function SubscribePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [processing, setProcessing] = useState(true);
  const [tier, setTier] = useState<string>('');
  const [billing, setBilling] = useState<string>('');

  useEffect(() => {
    const tierParam = searchParams.get('tier') || 'free';
    const billingParam = searchParams.get('billing') || 'monthly';
    setTier(tierParam);
    setBilling(billingParam);
    
    // Simulate processing delay
    const timer = setTimeout(() => {
      setProcessing(false);
      // Free tier goes directly to dashboard
      if (tierParam === 'free') {
        router.push('/dashboard');
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [searchParams, router]);

  const tierNames: Record<string, string> = {
    free: 'Free',
    retail: 'Retail',
    pro: 'Pro',
    institutional: 'Institutional',
    enterprise: 'Enterprise',
  };

  const tierPrices: Record<string, { monthly: number; annual: number }> = {
    free: { monthly: 0, annual: 0 },
    retail: { monthly: 99, annual: 79 },
    pro: { monthly: 499, annual: 399 },
    institutional: { monthly: 2499, annual: 1999 },
    enterprise: { monthly: 0, annual: 0 },
  };

  if (processing) {
    return (
      <div className="min-h-screen bg-[#fbfbfd] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#007AFF] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[17px] text-[#1d1d1f]">Setting up your account...</p>
        </div>
      </div>
    );
  }

  const price = billing === 'annual' ? tierPrices[tier]?.annual : tierPrices[tier]?.monthly;

  return (
    <div className="min-h-screen bg-[#fbfbfd]">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/5">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="text-[20px] font-semibold text-[#1d1d1f]">
            ZkVanguard
          </Link>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 pt-32 pb-16">
        <div className="bg-white rounded-[20px] p-8 border border-black/5 shadow-lg">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[#34C759]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#34C759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-[28px] font-semibold text-[#1d1d1f] mb-2">
              Subscribe to {tierNames[tier] || 'Pro'}
            </h1>
            <p className="text-[15px] text-[#86868b]">
              {billing === 'annual' ? 'Annual billing' : 'Monthly billing'}
            </p>
          </div>

          {/* Price Summary */}
          <div className="bg-[#f5f5f7] rounded-[12px] p-4 mb-6">
            <div className="flex justify-between items-center">
              <span className="text-[15px] text-[#86868b]">{tierNames[tier]} Plan</span>
              <span className="text-[20px] font-semibold text-[#1d1d1f]">
                ${price}/mo
              </span>
            </div>
            {billing === 'annual' && (
              <p className="text-[13px] text-[#34C759] mt-1">
                Billed annually (${(price || 0) * 12}/year)
              </p>
            )}
          </div>

          {/* Features teaser */}
          <div className="mb-8">
            <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">Includes:</h3>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-[14px] text-[#86868b]">
                <svg className="w-4 h-4 text-[#34C759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                AI-powered hedging agents
              </li>
              <li className="flex items-center gap-2 text-[14px] text-[#86868b]">
                <svg className="w-4 h-4 text-[#34C759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                ZK proof generation
              </li>
              <li className="flex items-center gap-2 text-[14px] text-[#86868b]">
                <svg className="w-4 h-4 text-[#34C759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Real-time portfolio monitoring
              </li>
              <li className="flex items-center gap-2 text-[14px] text-[#86868b]">
                <svg className="w-4 h-4 text-[#34C759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Gasless transactions
              </li>
            </ul>
          </div>

          {/* Coming Soon Notice */}
          <div className="bg-[#FF9500]/10 border border-[#FF9500]/20 rounded-[12px] p-4 mb-6">
            <p className="text-[14px] text-[#1d1d1f]">
              <span className="font-semibold">Coming Soon:</span> Payment integration is under development. 
              For now, enjoy full access to all features during our beta period.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="space-y-3">
            <Link
              href="/dashboard"
              className="block w-full py-3 px-4 rounded-[12px] text-[15px] font-semibold text-center bg-[#007AFF] text-white hover:bg-[#0066d6] transition-colors"
            >
              Continue to Dashboard
            </Link>
            <Link
              href="/pricing"
              className="block w-full py-3 px-4 rounded-[12px] text-[15px] font-medium text-center text-[#007AFF] hover:bg-[#007AFF]/5 transition-colors"
            >
              View All Plans
            </Link>
          </div>
        </div>

        {/* Security note */}
        <p className="text-center text-[13px] text-[#86868b] mt-6">
          🔒 Secure checkout powered by Stripe (coming soon)
        </p>
      </main>
    </div>
  );
}
