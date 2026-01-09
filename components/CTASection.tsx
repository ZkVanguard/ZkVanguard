'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';

export function CTASection() {
  useAccount();

  return (
    <section className="py-32 lg:py-40">
      <div className="container mx-auto px-5">
        <div className="max-w-[980px] mx-auto text-center">
          <h2 className="text-[56px] lg:text-[80px] font-semibold text-[#1d1d1f] tracking-[-0.035em] leading-[1.05] mb-6 lg:mb-8">
            Ready to Start?
          </h2>
          <p className="text-[21px] lg:text-[28px] text-[#86868b] leading-[1.42] tracking-[-0.003em] mb-12 lg:mb-16 max-w-[720px] mx-auto">
            Quantum-proof ZK-STARK verification meets autonomous AI agents
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-10 py-4 bg-[#007AFF] hover:bg-[#0051D5] rounded-full font-semibold text-[19px] text-white transition-colors duration-200 min-w-[200px]"
          >
            Launch Dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
