"use client";

import Link from 'next/link';
import { ArrowRight, Shield, Zap, TrendingUp } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative w-full px-5 lg:px-8 pt-28 pb-20 sm:pt-32 sm:pb-24 lg:pt-40 lg:pb-32">
        <div className="max-w-[1280px] mx-auto">
          
          {/* Asymmetric layout - content left, visual right */}
          <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-12 lg:gap-16 items-center">
            
            {/* Left: Main content */}
            <div className="max-w-[640px]">
              {/* Eyebrow - clean badge with emphasis */}
              <div className="inline-flex items-center gap-3 mb-6">
                <span className="text-subheadline text-label-secondary font-medium">
                  Cronos zkEVM
                </span>
                <div className="w-px h-3 bg-separator-opaque" />
                <span className="text-subheadline font-semibold text-transparent bg-gradient-to-r from-ios-blue to-[#0066FF] bg-clip-text">
                  Quantum-Proof
                </span>
              </div>

              {/* Hero headline - responsive sizing */}
              <h1 className="text-[36px] leading-[1.1] sm:text-[48px] sm:leading-[1.08] lg:text-[64px] xl:text-[80px] lg:leading-[1.05] font-bold text-label-primary tracking-[-0.02em] mb-4 sm:mb-6">
                Your portfolio.
                <br />
                <span className="relative inline-block">
                  <span className="bg-gradient-to-r from-ios-blue via-[#0066FF] to-[#0052CC] bg-clip-text text-transparent">
                    Protected.
                  </span>
                  {/* Subtle glow under gradient text */}
                  <div className="absolute inset-0 bg-gradient-to-r from-ios-blue/20 to-transparent blur-2xl -z-10" />
                </span>
              </h1>
              
              {/* Shorter subheadline - responsive */}
              <p className="text-body sm:text-title-3 lg:text-title-2 text-label-secondary font-normal leading-relaxed mb-8 sm:mb-10">
                AI agents manage risk. Zero-knowledge proofs protect privacy.
              </p>

              {/* CTA - responsive button size */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-4">
                <Link 
                  href="/dashboard" 
                  className="group inline-flex items-center justify-center gap-2.5 px-6 sm:px-8 h-[52px] sm:h-[56px] bg-ios-blue text-white text-callout sm:text-headline font-semibold rounded-[14px] hover:opacity-90 active:scale-[0.98] transition-all shadow-[0_8px_30px_rgba(0,122,255,0.25)] w-full sm:w-auto"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" strokeWidth={2.5} />
                </Link>
                <a 
                  href="#features"
                  className="text-callout sm:text-headline font-medium text-ios-blue hover:text-[#0066FF] transition-colors"
                >
                  See how it works
                </a>
              </div>
            </div>

            {/* Right: Visual representation - Desktop only */}
            <div className="hidden lg:block relative">
              {/* Modern stacked card composition */}
              <div className="relative w-full max-w-[520px] ml-auto space-y-4">
                
                {/* Primary card - Zero-Knowledge Security */}
                <div className="bg-white rounded-[20px] p-7 shadow-[0_4px_20px_rgba(0,0,0,0.08)] border border-black/5">
                  <div className="flex items-start gap-4 mb-5">
                    <div className="w-14 h-14 rounded-[14px] bg-[#007AFF] flex items-center justify-center flex-shrink-0">
                      <Shield className="w-7 h-7 text-white" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[19px] font-semibold text-[#1d1d1f] mb-1.5 tracking-[-0.01em]">
                        Zero-Knowledge Security
                      </h3>
                      <p className="text-[15px] text-[#86868b] leading-[1.4]">
                        ZK-STARK verification. Your strategies remain completely private.
                      </p>
                    </div>
                  </div>
                  {/* Clean minimal chart */}
                  <div className="flex items-end gap-1.5 h-16 px-2">
                    {[60, 82, 68, 95, 72, 88, 78].map((height, i) => (
                      <div 
                        key={i}
                        className="flex-1 bg-[#007AFF]/80 rounded-t-[3px]"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>

                {/* Secondary cards row */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Real-Time Data card */}
                  <div className="bg-white rounded-[18px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.06)] border border-black/5">
                    <div className="w-11 h-11 rounded-[11px] bg-[#FF9500]/10 flex items-center justify-center mb-4">
                      <TrendingUp className="w-5 h-5 text-[#FF9500]" strokeWidth={2} />
                    </div>
                    <h4 className="text-[17px] font-semibold text-[#1d1d1f] mb-1.5 tracking-[-0.01em]">
                      Real-Time Data
                    </h4>
                    <p className="text-[14px] text-[#86868b] leading-[1.35]">
                      Live market analytics and insights
                    </p>
                  </div>

                  {/* AI Automation card */}
                  <div className="bg-white rounded-[18px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.06)] border border-black/5">
                    <div className="w-11 h-11 rounded-[11px] bg-[#34C759]/10 flex items-center justify-center mb-4">
                      <Zap className="w-5 h-5 text-[#34C759]" strokeWidth={2} />
                    </div>
                    <h4 className="text-[17px] font-semibold text-[#1d1d1f] mb-1.5 tracking-[-0.01em]">
                      AI Automation
                    </h4>
                    <p className="text-[14px] text-[#86868b] leading-[1.35]">
                      Autonomous trading and risk mitigation
                    </p>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* Mobile: Better feature showcase */}
          <div className="lg:hidden mt-12 space-y-4">
            {[
              { 
                icon: Shield, 
                color: 'ios-blue', 
                title: 'Zero-Knowledge Security',
                desc: 'Quantum-proof privacy for your portfolio'
              },
              { 
                icon: Zap, 
                color: 'ios-green', 
                title: 'AI Automation',
                desc: 'Autonomous trading and risk mitigation'
              },
              { 
                icon: TrendingUp, 
                color: 'ios-orange', 
                title: 'Real-Time Data',
                desc: 'Live market analytics and insights'
              },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-ios-xl p-5 border border-separator-opaque shadow-ios-1">
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-11 h-11 rounded-ios-lg bg-${item.color}/10 flex items-center justify-center`}>
                    <item.icon className={`w-5 h-5 text-${item.color}`} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-headline font-semibold text-label-primary mb-1">
                      {item.title}
                    </h3>
                    <p className="text-subheadline text-label-secondary leading-snug">
                      {item.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}