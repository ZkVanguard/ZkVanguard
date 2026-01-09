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
    <div className="min-h-screen">
      {/* Hero - Apple light blue background */}
      <div className="bg-[#d2e9f5]">
        <Hero />
      </div>
      
      {/* Stats section - White, wider container */}
      <section className="bg-white px-5 py-20 lg:py-32">
        <div className="max-w-[1120px] mx-auto">
          <Stats />
        </div>
      </section>

      {/* Features section - Light gray, standard width */}
      <section className="bg-[#f5f5f7] px-5 py-24 lg:py-40">
        <div className="max-w-[1200px] mx-auto">
          <Features />
        </div>
      </section>

      {/* Live Metrics - Black background like MacBook Pro section */}
      <section className="bg-black px-5 py-24 lg:py-40">
        <div className="max-w-[1120px] mx-auto">
          <LiveMetrics />
        </div>
      </section>

      {/* Agent Showcase - White, narrower */}
      <section className="bg-white px-5 py-20 lg:py-32">
        <div className="max-w-[840px] mx-auto">
          <AgentShowcase />
        </div>
      </section>

      {/* How It Works - Light gray */}
      <section className="px-5 py-16 lg:py-24 bg-[#f5f5f7]">
        <div className="max-w-[980px] mx-auto">
          <HowItWorks />
        </div>
      </section>

      <CTASection />
    </div>
  );
}
