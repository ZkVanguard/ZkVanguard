'use client';

import Link from 'next/link';
import { Github, Twitter, MessageCircle, Zap, FileText, AlertCircle } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-50 dark:bg-slate-900 border-t border-gray-200 dark:border-white/10 transition-colors duration-300">
      {/* Demo Disclaimer Banner */}
      <div className="bg-amber-500/10 border-y border-amber-500/20 py-4">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-3 md:space-y-0">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <div className="font-semibold text-amber-400">Demo Platform for Investor Preview</div>
                <div className="text-xs text-amber-400/80">
                  All financial data simulated - Real AI agents & infrastructure - Testnet deployment
                </div>
              </div>
            </div>
            <Link 
              href="/docs" 
              className="flex items-center space-x-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg transition-colors text-sm text-amber-400"
            >
              <FileText className="w-4 h-4" />
              <span>View Technical Documentation</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <div className="p-2 bg-gradient-to-br from-emerald-600 to-cyan-600 rounded-xl">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold gradient-text">
                Chronos Vanguard
              </span>
            </div>
            <p className="text-gray-400 mb-4 max-w-md leading-relaxed">
              AI-powered multi-agent system for real-world asset risk management on Cronos zkEVM.
            </p>
            <div className="text-xs text-gray-400 mb-4 p-4 glass border border-white/10 rounded-xl">
              <strong className="text-white">Disclaimer:</strong> This is a demonstration platform built for investor presentations. 
              All portfolio data, positions, and transactions are simulated. Real agent infrastructure deployed on Cronos testnet.
            </div>
            <div className="flex space-x-4">
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass border border-white/10 hover:border-emerald-500 rounded-lg flex items-center justify-center transition-all">
                <Github className="w-5 h-5 text-gray-400 hover:text-emerald-400 transition-colors" />
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass border border-white/10 hover:border-cyan-500 rounded-lg flex items-center justify-center transition-all">
                <Twitter className="w-5 h-5 text-gray-400 hover:text-cyan-400 transition-colors" />
              </a>
              <a href="https://discord.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass border border-white/10 hover:border-amber-500 rounded-lg flex items-center justify-center transition-all">
                <MessageCircle className="w-5 h-5 text-gray-400 hover:text-amber-400 transition-colors" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold mb-4 text-white">Product</h3>
            <ul className="space-y-2">
              <li><Link href="/dashboard" className="text-gray-400 hover:text-emerald-400 transition-colors">Dashboard</Link></li>
              <li><Link href="/agents" className="text-gray-400 hover:text-emerald-400 transition-colors">Agents</Link></li>
              <li><Link href="/docs" className="text-gray-400 hover:text-emerald-400 transition-colors">Documentation</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-white">Resources</h3>
            <ul className="space-y-2">
              <li><a href="#" className="text-gray-400 hover:text-cyan-400 transition-colors">Whitepaper</a></li>
              <li><a href="#" className="text-gray-400 hover:text-cyan-400 transition-colors">API Docs</a></li>
              <li><a href="#" className="text-gray-400 hover:text-cyan-400 transition-colors">Support</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-400 text-sm mb-4 md:mb-0">
            © {currentYear} Chronos Vanguard. Demo platform for investor preview.
          </p>
          <div className="flex space-x-6 text-sm">
            <Link href="/privacy" className="text-gray-400 hover:text-emerald-400 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-gray-400 hover:text-cyan-400 transition-colors">Terms of Service</Link>
            <span className="text-gray-600">Pre-Seed Stage</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
