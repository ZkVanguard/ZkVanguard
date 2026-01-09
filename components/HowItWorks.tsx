'use client';

const steps = [
  {
    number: '01',
    title: 'Connect',
    description: 'Link your wallet & set preferences',
    detail: 'Web3 wallet integration',
  },
  {
    number: '02',
    title: 'Monitor',
    description: 'AI agents analyze portfolio risk 24/7',
    detail: 'Real-time risk analysis',
  },
  {
    number: '03',
    title: 'Execute',
    description: 'Auto-hedge & settle transactions',
    detail: 'Automated protection',
  },
];

export function HowItWorks() {
  return (
    <div>
      <h2 className="text-[40px] lg:text-[56px] font-semibold text-[#1d1d1f] tracking-[-0.03em] leading-[1.05] mb-4 text-center">How It Works</h2>
      <p className="text-[19px] lg:text-[24px] text-[#86868b] leading-[1.45] text-center mb-20 lg:mb-28">Get started in three simple steps</p>
      
      {/* Mobile - vertical stack */}
      <div className="lg:hidden space-y-20">
        {steps.map((step, index) => {
          return (
            <div key={index} className="text-center">
              <div className="text-[96px] font-semibold text-[#007AFF]/10 tracking-[-0.05em] leading-[1] mb-6">
                {step.number}
              </div>
              <h3 className="text-[36px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-4">
                {step.title}
              </h3>
              <p className="text-[21px] text-[#1d1d1f] leading-[1.47] mb-3 font-normal">
                {step.description}
              </p>
              <p className="text-[17px] text-[#86868b] leading-[1.47] font-normal">
                {step.detail}
              </p>
            </div>
          );
        })}
      </div>

      {/* Desktop - 3 column grid with more space */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-20">
        {steps.map((step, index) => {
          return (
            <div key={index} className="text-center">
              <div className="text-[140px] font-semibold text-[#007AFF]/10 tracking-[-0.05em] leading-[1] mb-8">
                {step.number}
              </div>
              <h3 className="text-[44px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-5">
                {step.title}
              </h3>
              <p className="text-[24px] text-[#1d1d1f] leading-[1.45] mb-4 font-normal">
                {step.description}
              </p>
              <p className="text-[19px] text-[#86868b] leading-[1.47] font-normal">
                {step.detail}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
