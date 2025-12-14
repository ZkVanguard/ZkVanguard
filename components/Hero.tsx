'use client';

import Link from 'next/link';
import { ArrowRight, Shield, Zap, TrendingUp } from 'lucide-react';
import { useAccount } from 'wagmi';

export function Hero() {
  const { isConnected } = useAccount();

  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-10" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />

      <div className="relative container mx-auto px-4 py-24 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full mb-8">
            <Zap className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-blue-400">Powered by AI Agents & ZK-STARK</span>
          </div>

          {/* Main Heading */}
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            <span className="bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              Intelligent Risk Management
            </span>
            <br />
            <span className="text-white">for Real-World Assets</span>
          </h1>

          {/* Subheading */}
          <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-3xl mx-auto">
            Multi-agent AI system orchestrating automated hedging, settlements, and reporting 
            for your RWA portfolio on Cronos zkEVM.
          </p>
          
          {/* Demo Badge */}
          <div className="inline-flex items-center space-x-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-8">
            <span className="text-sm text-yellow-400">DEMO: All data simulated for investor preview</span>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-lg font-semibold text-lg transition-all flex items-center justify-center space-x-2 group"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="#features"
              className="w-full sm:w-auto px-8 py-4 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold text-lg transition-colors"
            >
              Learn More
            </a>
          </div>

          {/* Feature Pills */}
          <div className="flex flex-wrap items-center justify-center gap-6">
            <div className="flex items-center space-x-2 px-4 py-2 bg-gray-800/50 rounded-full border border-gray-700">
              <Shield className="w-5 h-5 text-green-500" />
              <span className="text-gray-300">ZK-STARK Verified</span>
            </div>
            <div className="flex items-center space-x-2 px-4 py-2 bg-gray-800/50 rounded-full border border-gray-700">
              <Zap className="w-5 h-5 text-yellow-500" />
              <span className="text-gray-300">Autonomous Agents</span>
            </div>
            <div className="flex items-center space-x-2 px-4 py-2 bg-gray-800/50 rounded-full border border-gray-700">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              <span className="text-gray-300">Real-time Risk Analysis</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
