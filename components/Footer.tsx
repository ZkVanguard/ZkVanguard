"use client";

import Link from 'next/link';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#f5f5f7]">
      <div className="max-w-[980px] mx-auto px-6 lg:px-8">
        {/* Top section - Navigation */}
        <div className="pt-12 lg:pt-16 pb-8 lg:pb-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-20">
            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">PRODUCT</h3>
              <ul className="space-y-3">
                <li><Link href="/dashboard" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Dashboard</Link></li>
                <li><Link href="/agents" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Agents</Link></li>
                <li><Link href="/simulator" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Simulator</Link></li>
                <li><Link href="/docs" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Documentation</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">PLATFORM</h3>
              <ul className="space-y-3">
                <li><Link href="/zk-proof" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">ZK Verification</Link></li>
                <li><Link href="/zk-authenticity" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Authenticity</Link></li>
                <li><a href="#" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Whitepaper</a></li>
                <li><a href="#" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">API</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">RESOURCES</h3>
              <ul className="space-y-3">
                <li><a href="#" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Support</a></li>
                <li><a href="#" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Community</a></li>
                <li><a href="https://github.com" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">GitHub</a></li>
                <li><a href="https://twitter.com" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Twitter</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">LEGAL</h3>
              <ul className="space-y-3">
                <li><Link href="/privacy" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Privacy Policy</Link></li>
                <li><Link href="/terms" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom section - Copyright */}
        <div className="border-t border-[#d2d2d7] py-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="text-[12px] text-[#86868b] leading-relaxed">
              © {currentYear} ZkVanguard. All rights reserved.
              <span className="hidden md:inline ml-2">·</span>
              <span className="block md:inline md:ml-2 text-[#007AFF]">Cronos zkEVM Testnet</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[12px]">
              <span className="px-3 py-1.5 bg-[#007AFF]/10 text-[#007AFF] rounded-full font-medium">
                Pre-Seed Stage
              </span>
              <span className="text-[#86868b]">Built with ZK-STARK</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
