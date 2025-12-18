'use client';

import Link from 'next/link';
import { Github, Twitter, MessageCircle } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-800" style={{background: '#0f0f1a'}}>
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center mb-4">
              <img src="/assets/branding/logo-navbar.svg" alt="ZkVanguard" className="h-10 w-auto" />
            </div>
            <p className="text-gray-400 mb-4 max-w-md leading-relaxed">
              Autonomous AI agents for real-world asset risk management on Cronos zkEVM. Quantum-proof ZK-STARK verification meets intelligent automation.
            </p>
            <div className="flex space-x-4">
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass-strong border border-blue-500/20 hover:border-blue-500/50 rounded-lg flex items-center justify-center transition-all">
                <Github className="w-5 h-5 text-gray-400 hover:text-blue-400 transition-colors" />
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass-strong border border-purple-500/20 hover:border-purple-500/50 rounded-lg flex items-center justify-center transition-all">
                <Twitter className="w-5 h-5 text-gray-400 hover:text-purple-400 transition-colors" />
              </a>
              <a href="https://discord.com" target="_blank" rel="noopener noreferrer" className="w-10 h-10 glass-strong border border-cyan-500/20 hover:border-cyan-500/50 rounded-lg flex items-center justify-center transition-all">
                <MessageCircle className="w-5 h-5 text-gray-400 hover:text-cyan-400 transition-colors" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold mb-4 text-white">Product</h3>
            <ul className="space-y-2">
              <li><Link href="/dashboard" className="text-gray-400 hover:text-blue-400 transition-colors">Dashboard</Link></li>
              <li><Link href="/agents" className="text-gray-400 hover:text-blue-400 transition-colors">Agents</Link></li>
              <li><Link href="/docs" className="text-gray-400 hover:text-blue-400 transition-colors">Documentation</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4 text-white">Resources</h3>
            <ul className="space-y-2">
              <li><a href="#" className="text-gray-400 hover:text-purple-400 transition-colors">Whitepaper</a></li>
              <li><a href="#" className="text-gray-400 hover:text-purple-400 transition-colors">API Docs</a></li>
              <li><a href="#" className="text-gray-400 hover:text-purple-400 transition-colors">Support</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-400 text-sm mb-4 md:mb-0">
            © {currentYear} ZkVanguard. All rights reserved.
          </p>
          <div className="flex space-x-6 text-sm">
            <Link href="/privacy" className="text-gray-400 hover:text-blue-400 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-gray-400 hover:text-purple-400 transition-colors">Terms of Service</Link>
            <span className="text-gray-500">Pre-Seed Stage</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
