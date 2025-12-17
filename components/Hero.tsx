'use client';

import Link from 'next/link';
import { ArrowRight, Shield, Zap, Sparkles, ChevronDown, BarChart3, Lock } from 'lucide-react';

export function Hero() {

  return (
    <div className="relative bg-black overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50 via-gray-100/50 to-gray-50 dark:from-black dark:via-gray-950/50 dark:to-black" />
      
      <div className="relative container mx-auto px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-12 items-center">
            {/* Left Column - Content */}
            <div className="space-y-3 sm:space-y-4">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-2.5 bg-gray-800 rounded-full border border-gray-700/50 shadow-ios">
                <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 text-primary-500" />
                <span className="text-xs sm:text-sm font-semibold text-gray-100">
                  AI-Powered • ZK-STARK Verified
                </span>
              </div>

              {/* Heading */}
              <div className="space-y-2 sm:space-y-3">
                <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight tracking-tight">
                  <span className="bg-gradient-to-r from-primary-500 to-accent-500 bg-clip-text text-transparent">AI-Powered</span>
                  <br />
                  <span className="text-white">RWA Risk Protection</span>
                </h1>
                
                <p className="text-sm sm:text-base lg:text-lg text-gray-600 dark:text-gray-300 leading-relaxed max-w-2xl font-normal">
                  Autonomous agents manage hedging, settlements & reporting for your portfolio.
                </p>
              </div>

              {/* Production Badge */}
              <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-green-50 dark:bg-green-900/20 rounded-full border border-green-300 dark:border-green-700/50 shadow-sm">
                <div className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full" />
                <span className="text-xs sm:text-sm font-medium text-green-700 dark:text-green-400">10/10 Tests Passing</span>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/dashboard"
                  className="group px-8 py-4 bg-gradient-to-r from-primary-600 to-secondary-500 hover:from-primary-500 hover:to-secondary-400 rounded-xl font-bold text-lg transition-all duration-300 flex items-center gap-3 shadow-xl shadow-primary-500/30 text-white"
                >
                  <span>Launch Dashboard</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                
                <a
                  href="#features"
                  className="px-8 py-4 glass-strong hover:bg-slate-800 rounded-xl font-bold text-lg transition-all duration-300 border border-slate-700 text-slate-200"
                >
                  Explore Features
                </a>
              </div>
            </div>

            {/* Right Column - Feature Grid */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:gap-6">
              {[
                { icon: BarChart3, title: 'Analytics', desc: 'Live insights', gradient: 'from-primary-500 to-primary-600' },
                { icon: Shield, title: 'ZK Privacy', desc: 'Crypto proofs', gradient: 'from-secondary-500 to-secondary-600' },
                { icon: Zap, title: 'AI Agents', desc: 'Auto execution', gradient: 'from-accent-500 to-accent-600' },
                { icon: Lock, title: 'Secure', desc: 'Quantum-ready', gradient: 'from-amber-500 to-amber-600' },
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
