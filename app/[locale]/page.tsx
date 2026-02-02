import { Hero } from '../../components/Hero';
import { Features } from '../../components/Features';
import { Stats } from '../../components/Stats';
import { AgentShowcase } from '../../components/AgentShowcase';
import { HowItWorks } from '../../components/HowItWorks';
import { MarketOpportunity } from '../../components/MarketOpportunity';
import { Roadmap } from '../../components/Roadmap';
import { CTASection } from '../../components/CTASection';
import { LiveMetrics } from '../../components/LiveMetrics';

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
