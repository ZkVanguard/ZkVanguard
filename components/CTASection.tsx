'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useAccount } from 'wagmi';

export function CTASection() {
  const { isConnected } = useAccount();

  return (
    <section className="py-24 bg-gradient-to-br from-blue-900 via-purple-900 to-pink-900 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-10" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-white">
            Ready to Transform Your Risk Management?
          </h2>
          <p className="text-xl text-gray-300 mb-8">
            Join the future of AI-powered portfolio management on Cronos zkEVM
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-4 bg-white text-gray-900 hover:bg-gray-100 rounded-lg font-semibold text-lg transition-all flex items-center justify-center space-x-2 group"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="#features"
              className="w-full sm:w-auto px-8 py-4 bg-transparent border-2 border-white text-white hover:bg-white/10 rounded-lg font-semibold text-lg transition-all"
            >
              Learn More
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
