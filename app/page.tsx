'use client';

import dynamic from 'next/dynamic';
import { Hero } from '../components/Hero';
import { CardSkeleton } from '../components/ui/Skeleton';

// Dynamic imports for below-the-fold components (reduces first load from 140KB → 70KB)
const Features = dynamic(() => import('../components/Features').then(mod => ({ default: mod.Features })), {
  loading: () => <div className="min-h-[400px]"><CardSkeleton /></div>,
});

const AgentShowcase = dynamic(() => import('../components/AgentShowcase').then(mod => ({ default: mod.AgentShowcase })), {
  loading: () => <div className="min-h-[500px]"><CardSkeleton /></div>,
});

const Stats = dynamic(() => import('../components/Stats').then(mod => ({ default: mod.Stats })));

const LiveMetrics = dynamic(() => import('../components/LiveMetrics').then(mod => ({ default: mod.LiveMetrics })), {
  loading: () => <div className="min-h-[400px] bg-black flex items-center justify-center text-white">Loading metrics...</div>,
  ssr: false, // Client-only animations
});

const HowItWorks = dynamic(() => import('../components/HowItWorks').then(mod => ({ default: mod.HowItWorks })), {
  loading: () => <div className="min-h-[400px]"><CardSkeleton /></div>,
});

const CTASection = dynamic(() => import('../components/CTASection').then(mod => ({ default: mod.CTASection })));

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
