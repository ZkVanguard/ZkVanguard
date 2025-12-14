'use client';

import Link from 'next/link';
import { ArrowRight, Shield, Zap, TrendingUp, Sparkles, ChevronDown, BarChart3, Lock } from 'lucide-react';
import { useAccount } from 'wagmi';

export function Hero() {
  const { isConnected } = useAccount();

  return (
    <div className="relative min-h-screen bg-white dark:bg-slate-900 transition-colors duration-300">
      {/* Grid background */}
      <div className="absolute inset-0 grid-pattern opacity-30" />
      
      <div className="relative container mx-auto px-6 py-32">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Column - Content */}
            <div className="space-y-8">
              {/* Badge */}
              <div className="inline-flex items-center gap-3 px-5 py-2.5 glass rounded-full border border-emerald-500/30">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-400">
                  AI-Powered • ZK-STARK Verified
                </span>
              </div>

              {/* Heading */}
              <div className="space-y-6">
                <h1 className="text-5xl md:text-6xl lg:text-7xl font-black leading-tight">
                  <span className="gradient-text">Intelligent</span>
                  <br />
                  <span className="text-gray-900 dark:text-white">Risk Management</span>
                  <br />
                  <span className="text-gray-600 dark:text-gray-400 text-4xl md:text-5xl">for Real-World Assets</span>
                </h1>
                
                <p className="text-xl text-gray-700 dark:text-gray-300 leading-relaxed max-w-2xl">
                  Multi-agent AI system orchestrating automated hedging, settlements, and reporting 
                  for your RWA portfolio on Cronos zkEVM.
                </p>
              </div>

              {/* Demo Badge */}
              <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500/10 rounded-full border border-amber-500/30">
                <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-amber-400">DEMO MODE</span>
                <span className="text-sm text-gray-400">• Simulated Data</span>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/dashboard"
                  className="group px-8 py-4 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 rounded-xl font-bold text-lg transition-all duration-300 flex items-center gap-3 shadow-lg shadow-emerald-500/25"
                >
                  <span>Launch Dashboard</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                
                <a
                  href="#features"
                  className="px-8 py-4 glass hover:bg-white/5 rounded-xl font-bold text-lg transition-all duration-300 border border-white/10"
                >
                  Explore Features
                </a>
              </div>

              {/* Feature Pills */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                {[
                  { icon: Shield, text: 'ZK Verified', color: 'emerald' },
                  { icon: Zap, text: 'Autonomous', color: 'cyan' },
                  { icon: TrendingUp, text: 'Real-time', color: 'amber' },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-3 glass rounded-xl border border-white/10 hover:border-white/20 transition-all"
                  >
                    <div className={`p-2 bg-gradient-to-br from-${item.color}-500 to-${item.color}-600 rounded-lg`}>
                      <item.icon className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-semibold text-white">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column - Feature Grid */}
            <div className="grid grid-cols-2 gap-6">
              {[
                { icon: BarChart3, title: 'Portfolio Analytics', desc: 'Real-time insights', color: 'emerald' },
                { icon: Shield, title: 'ZK Privacy', desc: 'Cryptographic proofs', color: 'cyan' },
                { icon: Zap, title: 'AI Agents', desc: 'Automated execution', color: 'amber' },
                { icon: Lock, title: 'Secure', desc: 'Post-quantum ready', color: 'blue' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="p-6 glass rounded-2xl border border-white/10 hover:border-white/20 transition-all card-hover space-y-4"
                >
                  <div className={`w-12 h-12 bg-gradient-to-br from-${item.color}-500 to-${item.color}-600 rounded-xl flex items-center justify-center`}>
                    <item.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">{item.title}</h3>
                    <p className="text-sm text-gray-400">{item.desc}</p>
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
