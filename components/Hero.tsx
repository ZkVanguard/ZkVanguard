'use client';

import Link from 'next/link';
import { ArrowRight, Shield, Zap, Sparkles, ChevronDown, BarChart3, Lock } from 'lucide-react';

export function Hero() {

  return (
    <div className="relative overflow-hidden" style={{background: '#0f0f1a'}}>
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-blue-900/15 via-purple-900/10 to-transparent" />
      
      <div className="relative container mx-auto px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-12 items-center">
            {/* Left Column - Content */}
            <div className="space-y-3 sm:space-y-4">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-full border border-cyan-500/30 backdrop-blur-xl">
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                <span className="text-xs sm:text-sm font-bold text-cyan-300">
                  QUANTUM-PROOF ZK-STARK • CRONOS TESTNET
                </span>
              </div>

              {/* Heading */}
              <div className="space-y-4 sm:space-y-5">
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-black leading-[1.1] tracking-tight">
                  <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent animate-gradient">
                    Autonomous AI Risk Management
                  </span>
                  <br />
                  <span className="text-white">for Real-World Assets</span>
                </h1>
                
                <p className="text-base sm:text-lg lg:text-xl text-gray-300 leading-relaxed max-w-2xl">
                  Multi-agent system with <span className="text-cyan-400 font-semibold">quantum-proof ZK-STARK</span> verification. Automated hedging, settlements, and compliance—all gasless.
                </p>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-4 pt-2">
                <Link
                  href="/dashboard"
                  className="group px-10 py-5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-2xl font-bold text-xl transition-all duration-300 flex items-center gap-3 shadow-2xl shadow-blue-500/40 hover:shadow-blue-500/60 text-white hover:scale-105"
                >
                  <span>Launch App</span>
                  <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                </Link>
                
                <a
                  href="#features"
                  className="px-10 py-5 glass-strong hover:bg-gray-800/80 rounded-2xl font-semibold text-xl transition-all duration-300 border border-blue-500/30 text-gray-200 hover:border-blue-500/50"
                >
                  Learn More
                </a>
              </div>
            </div>

            {/* Right Column - Feature Grid */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:gap-6">
              {[
                { icon: BarChart3, title: 'Analytics', desc: 'Live insights', gradient: 'from-primary-500 to-primary-600' },
                { icon: Shield, title: 'ZK Privacy', desc: 'Crypto proofs', gradient: 'from-secondary-500 to-secondary-600' },
                { icon: Zap, title: 'AI Agents', desc: 'Auto execution', gradient: 'from-accent-500 to-accent-600' },
                { icon: Lock, title: 'ZK-STARK', desc: 'Quantum-proof', gradient: 'from-cyan-500 to-cyan-600' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="p-3 sm:p-4 lg:p-6 glass-strong rounded-xl sm:rounded-2xl border border-gray-700 hover:border-primary-500 transition-all card-hover space-y-2 sm:space-y-3 lg:space-y-4 shadow-lg"
                >
                  <div className={`w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-gradient-to-br ${item.gradient} rounded-lg sm:rounded-xl flex items-center justify-center shadow-lg`}>
                    <item.icon className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base lg:text-lg font-bold text-white mb-0.5 sm:mb-1">{item.title}</h3>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce">
        <ChevronDown className="w-6 h-6 text-gray-400" />
      </div>
    </div>
  );
}
