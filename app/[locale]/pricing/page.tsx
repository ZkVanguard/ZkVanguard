import { Metadata } from 'next';
import { PricingSection } from '@/components/PricingSection';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Pricing | ZkVanguard',
  description: 'Simple, transparent pricing for AI-powered RWA risk management. Choose the plan that fits your portfolio size.',
};

export default async function PricingPage() {
  return (
    <div className="min-h-screen bg-[#fbfbfd]">
      {/* Simple navbar for pricing page */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-black/5">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="text-[20px] font-semibold text-[#1d1d1f]">
            ZkVanguard
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-[14px] text-[#86868b] hover:text-[#1d1d1f]">
              Dashboard
            </Link>
            <Link 
              href="/dashboard" 
              className="bg-[#007AFF] text-white px-4 py-2 rounded-full text-[14px] font-medium hover:bg-[#0066d6]"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto px-4 pt-24 pb-16">
        <PricingSection />
        
        {/* FAQ Section */}
        <section className="mt-16 lg:mt-24">
          <h2 className="text-[32px] font-semibold text-[#1d1d1f] text-center mb-12">
            Frequently Asked Questions
          </h2>
          
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white rounded-[16px] p-6 border border-black/5">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">
                What&apos;s included in the platform fee?
              </h3>
              <p className="text-[15px] text-[#86868b] leading-[1.6]">
                The 0.1% platform fee on hedge operations covers execution, monitoring, 
                and settlement. Gasless transactions are included - you never pay gas fees.
              </p>
            </div>
            
            <div className="bg-white rounded-[16px] p-6 border border-black/5">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">
                What is the performance fee?
              </h3>
              <p className="text-[15px] text-[#86868b] leading-[1.6]">
                We charge a 20% performance fee only on profitable hedges. If your hedge 
                doesn&apos;t profit, you pay nothing extra. This aligns our incentives with yours.
              </p>
            </div>
            
            <div className="bg-white rounded-[16px] p-6 border border-black/5">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">
                Can I upgrade or downgrade my plan?
              </h3>
              <p className="text-[15px] text-[#86868b] leading-[1.6]">
                Yes! You can change your plan at any time. Upgrades take effect immediately, 
                and downgrades apply at the end of your billing period. We&apos;ll prorate any differences.
              </p>
            </div>
            
            <div className="bg-white rounded-[16px] p-6 border border-black/5">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">
                What are ZK proofs and why do I need them?
              </h3>
              <p className="text-[15px] text-[#86868b] leading-[1.6]">
                Zero-knowledge proofs let you verify your portfolio metrics without revealing 
                sensitive data. They&apos;re essential for institutional compliance and privacy-preserving 
                risk management.
              </p>
            </div>
            
            <div className="bg-white rounded-[16px] p-6 border border-black/5">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">
                Is there a free trial?
              </h3>
              <p className="text-[15px] text-[#86868b] leading-[1.6]">
                Yes! Our Free tier includes the Lead AI agent, 2 ZK proofs per month, and 
                basic portfolio monitoring. It&apos;s perfect for evaluating the platform before committing.
              </p>
            </div>
            
            <div className="bg-white rounded-[16px] p-6 border border-black/5">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">
                What chains are supported?
              </h3>
              <p className="text-[15px] text-[#86868b] leading-[1.6]">
                We currently support Cronos EVM and SUI, with more chains coming soon. 
                All hedging operations use Moonlander perpetuals on Cronos.
              </p>
            </div>
          </div>
        </section>
      </main>
      
      {/* Simple footer */}
      <footer className="bg-white border-t border-black/5 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-[14px] text-[#86868b]" suppressHydrationWarning>
            © {new Date().getFullYear()} ZkVanguard. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
