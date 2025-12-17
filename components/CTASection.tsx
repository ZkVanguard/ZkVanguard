'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useAccount } from 'wagmi';

export function CTASection() {
  useAccount();

  return (
    <section className="py-8 sm:py-10 lg:py-12 bg-gradient-to-br from-primary-500 via-accent-500 to-secondary-500 relative overflow-hidden">
      <div className="absolute inset-0 bg-black/10" />
      
      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2 sm:mb-2.5 lg:mb-3 text-white">
            Ready to Start?
          </h2>
          <p className="text-sm sm:text-base lg:text-lg text-white/90 mb-3 sm:mb-4 lg:mb-5 font-normal">
            Try AI-powered risk management today
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 lg:py-4 bg-blue-600 text-white hover:bg-blue-700 rounded-2xl font-semibold text-sm sm:text-base lg:text-lg transition-all flex items-center justify-center space-x-2 group shadow-ios-lg"
            >
              <span>Try Dashboard</span>
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/docs"
              className="w-full sm:w-auto px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 lg:py-4 bg-white/20 backdrop-blur-xl border-2 border-white/30 text-white hover:bg-white/30 rounded-2xl font-semibold text-sm sm:text-base lg:text-lg transition-all shadow-ios"
            >
              View Docs
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
