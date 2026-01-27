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
    <>
      <Hero />
      <Stats />
      <Features />
      <AgentShowcase />
      <HowItWorks />
      <LiveMetrics />
      <MarketOpportunity />
      <Roadmap />
      <CTASection />
    </>
  );
}
