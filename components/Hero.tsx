"use client";

import Link from 'next/link';
import { ArrowRight, Shield, Zap, TrendingUp } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative bg-system-bg-primary overflow-hidden">
      {/* Subtle gradient mesh background */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-ios-blue rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-ios-green rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full px-4 sm:px-6 lg:px-8 pt-16 pb-12 sm:pt-24 sm:pb-20 lg:pt-28 lg:pb-24">
        <div className="max-w-[1400px] mx-auto">
          
          {/* Asymmetric layout - content left, visual right */}
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            
            {/* Left: Main content */}
            <div className="max-w-2xl">
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
              {/* Abstract 3D-ish composition */}
              <div className="relative w-full aspect-square max-w-[500px] mx-auto">
                {/* Large featured card with depth */}
                <div className="absolute top-0 right-0 w-[85%] bg-white rounded-[24px] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.12)] border border-separator-opaque rotate-2 hover:rotate-0 transition-transform duration-500">
                  <div className="w-16 h-16 rounded-[16px] bg-gradient-to-br from-ios-blue to-[#0052CC] flex items-center justify-center mb-6">
                    <Shield className="w-8 h-8 text-white" strokeWidth={2} />
                  </div>
                  <h3 className="text-title-2 font-semibold text-label-primary mb-3">
                    Zero-Knowledge Security
                  </h3>
                  <p className="text-body text-label-secondary leading-relaxed">
                    Quantum-proof ZK-STARK verification. Your strategies remain completely private.
                  </p>
                  {/* Fake data visualization */}
                  <div className="mt-6 flex items-end gap-2 h-20">
                    {[65, 85, 70, 95, 75, 90, 80].map((height, i) => (
                      <div 
                        key={i}
                        className="flex-1 bg-gradient-to-t from-ios-blue/80 to-ios-blue/40 rounded-t"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>

                {/* Smaller supporting cards */}
                <div className="absolute bottom-8 left-0 w-[45%] bg-white rounded-[20px] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.1)] border border-separator-opaque -rotate-3 hover:rotate-0 transition-transform duration-500">
                  <div className="w-12 h-12 rounded-[12px] bg-ios-green/10 flex items-center justify-center mb-4">
                    <Zap className="w-6 h-6 text-ios-green" strokeWidth={2} />
                  </div>
                  <h4 className="text-headline font-semibold text-label-primary mb-2">
                    AI Automation
                  </h4>
                  <p className="text-subheadline text-label-secondary leading-snug">
                    Autonomous trading and risk mitigation
                  </p>
                </div>

                <div className="absolute top-1/3 left-8 w-[42%] bg-white rounded-[20px] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.1)] border border-separator-opaque rotate-6 hover:rotate-3 transition-transform duration-500">
                  <div className="w-12 h-12 rounded-[12px] bg-ios-orange/10 flex items-center justify-center mb-4">
                    <TrendingUp className="w-6 h-6 text-ios-orange" strokeWidth={2} />
                  </div>
                  <h4 className="text-headline font-semibold text-label-primary mb-2">
                    Real-Time Data
                  </h4>
                  <p className="text-subheadline text-label-secondary leading-snug">
                    Live market analytics and insights
                  </p>
                </div>

                {/* Subtle accent circles */}
                <div className="absolute -top-4 left-1/4 w-24 h-24 bg-ios-blue/5 rounded-full blur-xl" />
                <div className="absolute -bottom-4 right-1/4 w-32 h-32 bg-ios-green/5 rounded-full blur-xl" />
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