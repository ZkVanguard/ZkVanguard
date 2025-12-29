"use client";

import Link from 'next/link';
import { ArrowRight, BarChart3, Shield, Zap, Lock, ChevronDown } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative bg-[#0f0f1a] overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-900/10 via-purple-900/6 to-transparent pointer-events-none" />

      <div className="container mx-auto px-4 py-8 sm:py-12 lg:py-16">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-xs font-semibold text-cyan-300 whitespace-nowrap">QUANTUM-PROOF ZK-STARK • CRONOS TESTNET</span>
              </div>

              <h1 className="mt-4 text-3xl sm:text-4xl md:text-5xl font-extrabold leading-tight text-white">
                <span className="block bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400">Autonomous AI Risk Management</span>
                <span className="block text-white">for Real-World Assets</span>
              </h1>

              <p className="mt-3 text-gray-300 max-w-xl">
                Multi-agent system with <span className="text-cyan-400 font-semibold">quantum-proof ZK-STARK</span> verification. Automated hedging, settlements, and compliance — gasless and auditable.
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Link href="/dashboard" className="inline-flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-2xl shadow-lg hover:scale-[1.02] transition-transform w-full sm:w-auto">
                  <span>Launch App</span>
                  <ArrowRight className="w-5 h-5" />
                </Link>

                <a href="#features" className="w-full sm:w-auto px-6 py-3 border border-blue-700/30 rounded-2xl text-gray-200 text-center">
                  Learn More
                </a>
              </div>
            </div>

            <div className="min-w-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: BarChart3, title: 'Analytics', desc: 'Live insights' },
                  { icon: Shield, title: 'ZK Privacy', desc: 'Crypto proofs' },
                  { icon: Zap, title: 'AI Agents', desc: 'Auto execution' },
                  { icon: Lock, title: 'ZK-STARK', desc: 'Quantum-proof' },
                ].map((it, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-gradient-to-br from-gray-900/50 to-gray-900/40 border border-gray-700">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                      <it.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white">{it.title}</div>
                      <div className="text-xs text-gray-400">{it.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <ChevronDown className="mx-auto w-6 h-6 text-gray-400 animate-bounce" />
        </div>
      </div>
    </section>
  );
}