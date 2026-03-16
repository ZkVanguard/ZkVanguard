import dynamic from 'next/dynamic';
import { Hero } from '../../components/Hero';

// Below-fold components: lazy-loaded for faster initial page load
const Stats = dynamic(() => import('../../components/Stats').then(m => ({ default: m.Stats })), { ssr: true });
const Features = dynamic(() => import('../../components/Features').then(m => ({ default: m.Features })), { ssr: true });
const AgentShowcase = dynamic(() => import('../../components/AgentShowcase').then(m => ({ default: m.AgentShowcase })));
const HowItWorks = dynamic(() => import('../../components/HowItWorks').then(m => ({ default: m.HowItWorks })));
const MarketOpportunity = dynamic(() => import('../../components/MarketOpportunity').then(m => ({ default: m.MarketOpportunity })));
const Roadmap = dynamic(() => import('../../components/Roadmap').then(m => ({ default: m.Roadmap })));
const CTASection = dynamic(() => import('../../components/CTASection').then(m => ({ default: m.CTASection })));
const LiveMetrics = dynamic(() => import('../../components/LiveMetrics').then(m => ({ default: m.LiveMetrics })), { ssr: false });

export default function HomePage() {
  return (
    <div className="overflow-x-hidden">
      {/* Hero Section */}
      <Hero />
      
      {/* Stats Section */}
      <section className="py-20 lg:py-32 px-5 lg:px-8 bg-[#fbfbfd]">
        <div className="max-w-[1280px] mx-auto">
          <Stats />
        </div>
      </section>
      
      {/* Features Section */}
      <section id="features" className="py-20 lg:py-32 px-5 lg:px-8 bg-[#fbfbfd]">
        <div className="max-w-[1280px] mx-auto">
          <Features />
        </div>
      </section>
      
      {/* AI Agents Section */}
      <section className="py-20 lg:py-32 px-5 lg:px-8 bg-white">
        <div className="max-w-[1280px] mx-auto">
          <AgentShowcase />
        </div>
      </section>
      
      {/* How It Works Section */}
      <section className="py-20 lg:py-32 px-5 lg:px-8 bg-[#fbfbfd]">
        <div className="max-w-[1280px] mx-auto">
          <HowItWorks />
        </div>
      </section>
      
      {/* Live Metrics Section */}
      <section className="py-20 lg:py-32 px-5 lg:px-8 bg-white">
        <div className="max-w-[1280px] mx-auto">
          <LiveMetrics />
        </div>
      </section>
      
      {/* Market Opportunity Section - has own wrapper */}
      <MarketOpportunity />
      
      {/* Roadmap Section - has own wrapper */}
      <Roadmap />
      
      {/* CTA Section */}
      <CTASection />
    </div>
  );
}
