'use client';

import Link from 'next/link';
import { Github, Twitter, MessageCircle, FileText, AlertCircle } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 transition-colors duration-300">
      {/* Demo Disclaimer Banner */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border-y border-amber-200 dark:border-amber-800/50 py-4">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-3 md:space-y-0">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div>
                <div className="font-semibold text-amber-700 dark:text-amber-400">Demo Platform for Investor Preview</div>
                <div className="text-xs text-amber-600 dark:text-amber-400/80">
                  Portfolio amounts simulated with real market data - Real AI agents & infrastructure - Testnet deployment
                </div>
              </div>
            </div>
            <Link 
              href="/docs" 
              className="flex items-center space-x-2 px-4 py-2 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 border border-amber-300 dark:border-amber-700 rounded-lg transition-colors text-sm text-amber-700 dark:text-amber-400"
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
            <div className="flex items-center mb-4">
              <img src="/assets/branding/logo-navbar.svg" alt="ZkVanguard" className="h-10 w-auto" />
            </div>
            <p className="text-slate-600 dark:text-slate-400 mb-4 max-w-md leading-relaxed">
              AI-powered multi-agent system for real-world asset risk management on Cronos zkEVM.
            </p>
            <div className="text-xs text-slate-400 mb-4 p-4 glass border border-slate-700 rounded-xl">
              <strong className="text-slate-900 dark:text-slate-100">Disclaimer:</strong> This is a demonstration platform built for investor presentations. 
              Portfolio amounts are simulated, but powered by real market data. Real agent infrastructure deployed on Cronos testnet.
            </div>
            <div className="flex space-x-4">
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass border border-slate-700 hover:border-primary-500 rounded-lg flex items-center justify-center transition-all">
                <Github className="w-5 h-5 text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors" />
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass border border-slate-700 hover:border-accent-500 rounded-lg flex items-center justify-center transition-all">
                <Twitter className="w-5 h-5 text-slate-600 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors" />
              </a>
              <a href="https://discord.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass border border-slate-200 dark:border-slate-700 hover:border-secondary-500 rounded-lg flex items-center justify-center transition-all">
                <MessageCircle className="w-5 h-5 text-slate-600 dark:text-slate-400 hover:text-secondary-600 dark:hover:text-secondary-400 transition-colors" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold mb-4 text-slate-900 dark:text-slate-100">Product</h3>
            <ul className="space-y-2">
              <li><Link href="/dashboard" className="text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">Dashboard</Link></li>
              <li><Link href="/agents" className="text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">Agents</Link></li>
              <li><Link href="/docs" className="text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">Documentation</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-slate-900 dark:text-slate-100">Resources</h3>
            <ul className="space-y-2">
              <li><a href="#" className="text-slate-600 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors">Whitepaper</a></li>
              <li><a href="#" className="text-slate-600 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors">API Docs</a></li>
              <li><a href="#" className="text-slate-600 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors">Support</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-4 md:mb-0">
            © {currentYear} ZkVanguard. Demo platform for investor preview.
          </p>
          <div className="flex space-x-6 text-sm">
            <Link href="/privacy" className="text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-slate-600 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors">Terms of Service</Link>
            <span className="text-slate-500 dark:text-slate-500">Pre-Seed Stage</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
