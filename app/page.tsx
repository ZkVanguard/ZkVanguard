'use client';

import { Hero } from '@/components/Hero';
import { Features } from '@/components/Features';
import { AgentShowcase } from '@/components/AgentShowcase';
import { Stats } from '@/components/Stats';
import { LiveMetrics } from '@/components/LiveMetrics';
import { HowItWorks } from '@/components/HowItWorks';
import { CTASection } from '@/components/CTASection';

export default function Home() {
  return (
    <div className="relative bg-slate-900">
      <Hero />
      
      {/* Compact iOS-style sections */}
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Stats + Features Combined */}
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Stats />
          </div>
          <div className="space-y-6">
            <Features />
          </div>
        </div>

        {/* Live Metrics (Full Width) */}
        <LiveMetrics />

        {/* Agent Showcase + How It Works Side by Side */}
        <div className="grid lg:grid-cols-2 gap-6">
          <AgentShowcase />
          <HowItWorks />
        </div>
      </div>

      <CTASection />
    </div>
  );
}
