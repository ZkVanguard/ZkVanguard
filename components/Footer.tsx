'use client';

import Link from 'next/link';
import { Github, Twitter, MessageCircle, Zap, FileText, AlertCircle } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-900 border-t border-gray-800">
      {/* Demo Disclaimer Banner */}
      <div className="bg-yellow-500/10 border-y border-yellow-500/20 py-4">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-3 md:space-y-0">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <div>
                <div className="font-semibold text-yellow-400">Demo Platform for Investor Preview</div>
                <div className="text-xs text-yellow-400/80">
                  All financial data simulated - Real AI agents & infrastructure - Testnet deployment
                </div>
              </div>
            </div>
            <Link 
              href="/docs" 
              className="flex items-center space-x-2 px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 rounded-lg transition-colors text-sm text-yellow-400"
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
              <Zap className="w-8 h-8 text-blue-500" />
              <span className="text-xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                Chronos Vanguard
              </span>
            </div>
            <p className="text-gray-400 mb-4 max-w-md">
              AI-powered multi-agent system for real-world asset risk management on Cronos zkEVM.
            </p>
            <div className="text-xs text-gray-500 mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
              <strong className="text-gray-400">Disclaimer:</strong> This is a demonstration platform built for investor presentations. 
              All portfolio data, positions, and transactions are simulated. Real agent infrastructure deployed on Cronos testnet.
            </div>
            <div className="flex space-x-4">
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Github className="w-6 h-6" />
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Twitter className="w-6 h-6" />
              </a>
              <a href="https://discord.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <MessageCircle className="w-6 h-6" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold mb-4 text-white">Product</h3>
            <ul className="space-y-2">
              <li><Link href="/dashboard" className="text-gray-400 hover:text-white transition-colors">Dashboard</Link></li>
              <li><Link href="/agents" className="text-gray-400 hover:text-white transition-colors">Agents</Link></li>
              <li><Link href="/docs" className="text-gray-400 hover:text-white transition-colors">Documentation</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-white">Resources</h3>
            <ul className="space-y-2">
              <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Whitepaper</a></li>
              <li><a href="#" className="text-gray-400 hover:text-white transition-colors">API Docs</a></li>
              <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Support</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-400 text-sm mb-4 md:mb-0">
            © {currentYear} Chronos Vanguard. Demo platform for investor preview.
          </p>
          <div className="flex space-x-6 text-sm">
            <Link href="/privacy" className="text-gray-400 hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-gray-400 hover:text-white transition-colors">Terms of Service</Link>
            <span className="text-gray-600">Pre-Seed Stage</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
