'use client';

import { Hero } from '../components/Hero';
import { Features } from '../components/Features';
import { AgentShowcase } from '../components/AgentShowcase';
import { Stats } from '../components/Stats';
import { LiveMetrics } from '../components/LiveMetrics';
import { HowItWorks } from '../components/HowItWorks';
import { CTASection } from '../components/CTASection';

export default function Home() {
  return (
    <div className="relative" style={{background: '#0f0f1a'}}>
      <Hero />
      
      {/* Compact iOS-style sections */}
      <div className="container mx-auto px-2 sm:px-4 md:px-6 py-6 sm:py-8 space-y-8 relative">
        {/* Artistic glow orbs */}
        <div className="absolute top-20 left-1/4 w-[32rem] h-[32rem] bg-blue-500/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-20 right-1/4 w-[32rem] h-[32rem] bg-purple-500/8 rounded-full blur-3xl pointer-events-none" />
        {/* Stats + Features Combined */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
          <div className="space-y-6">
            <Stats />
          </div>
          <div className="space-y-6">
            <Features />
          </div>
        </div>

        {/* Live Metrics (Full Width) */}
        <div className="relative z-10">
          <LiveMetrics />
        </div>

        {/* Agent Showcase + How It Works Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
          <AgentShowcase />
          <HowItWorks />
        </div>
      </div>

      <CTASection />
    </div>
  );
}
