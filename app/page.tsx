'use client';

import { Hero } from '@/components/Hero';
import { Features } from '@/components/Features';
import { AgentShowcase } from '@/components/AgentShowcase';
import { Stats } from '@/components/Stats';
import { LiveMetrics } from '@/components/LiveMetrics';
import { HowItWorks } from '@/components/HowItWorks';
import { MarketOpportunity } from '@/components/MarketOpportunity';
import { Roadmap } from '@/components/Roadmap';
import { CTASection } from '@/components/CTASection';

export default function Home() {
  return (
    <div className="relative">
      <Hero />
      <Stats />
      <LiveMetrics />
      <Features />
      <AgentShowcase />
      <HowItWorks />
      <MarketOpportunity />
      <Roadmap />
      <CTASection />
    </div>
  );
}
