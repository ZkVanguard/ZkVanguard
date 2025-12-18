'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useAccount } from 'wagmi';

export function CTASection() {
  useAccount();

  return (
    <section className="py-16 sm:py-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-purple-600/10 to-cyan-600/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-blue-500/5 to-purple-500/5" />
      
      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-black mb-4 bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
            Ready to Start?
          </h2>
          <p className="text-lg sm:text-xl text-gray-300 mb-8 font-normal">
            Quantum-proof ZK-STARK verification meets autonomous AI agents
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="group px-10 py-5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-2xl font-bold text-xl transition-all duration-300 flex items-center gap-3 shadow-2xl shadow-blue-500/40 hover:shadow-blue-500/60 text-white hover:scale-105"
            >
              <span>Launch Dashboard</span>
              <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/docs"
              className="px-10 py-5 glass-strong hover:bg-gray-800/80 rounded-2xl font-semibold text-xl transition-all duration-300 border border-blue-500/30 text-gray-200 hover:border-blue-500/50"
            >
              View Docs
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
