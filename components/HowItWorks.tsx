'use client';

import { useTranslations } from 'next-intl';

export function HowItWorks() {
  const t = useTranslations('howItWorks');
  
  const steps = [
    {
      number: '01',
      title: t('step1.title'),
      description: t('step1.description'),
      detail: t('step1.detail'),
    },
    {
      number: '02',
      title: t('step2.title'),
      description: t('step2.description'),
      detail: t('step2.detail'),
    },
    {
      number: '03',
      title: t('step3.title'),
      description: t('step3.description'),
      detail: t('step3.detail'),
    },
  ];

  return (
    <div>
      <h2 className="text-[40px] lg:text-[56px] font-semibold text-[#1d1d1f] tracking-[-0.03em] leading-[1.05] mb-4 text-center">{t('title')}</h2>
      <p className="text-[19px] lg:text-[24px] text-[#86868b] leading-[1.45] text-center mb-20 lg:mb-28">{t('subtitle')}</p>
      
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
