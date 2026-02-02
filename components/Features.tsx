'use client';

import { ShieldCheckIcon, BoltIcon, ChartBarIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

export function Features() {
  const t = useTranslations('features');
  
  const features = [
    {
      icon: ShieldCheckIcon,
      title: t('zkProofs.title'),
      description: t('zkProofs.description'),
      iconColor: 'text-[#007AFF]',
      iconBg: 'bg-[#007AFF]/10',
      bgColor: 'bg-white',
    },
    {
      icon: BoltIcon,
      title: t('aiAgents.title'),
      description: t('aiAgents.description'),
      iconColor: 'text-[#34C759]',
      iconBg: 'bg-[#34C759]/10',
      bgColor: 'bg-[#f5f5f7]',
    },
    {
      icon: ChartBarIcon,
      title: t('liveAnalytics.title'),
      description: t('liveAnalytics.description'),
      iconColor: 'text-[#FF9500]',
      iconBg: 'bg-[#FF9500]/10',
      bgColor: 'bg-[#f5f5f7]',
    },
    {
      icon: LockClosedIcon,
      title: t('quantumProof.title'),
      description: t('quantumProof.description'),
      iconColor: 'text-[#AF52DE]',
      iconBg: 'bg-[#AF52DE]/10',
      bgColor: 'bg-white',
    },
  ];

  return (
    <div>
      {/* Section Header */}
      <div className="text-center mb-12 lg:mb-16">
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-4">
          {t('title')}
        </h2>
        <p className="text-[19px] lg:text-[21px] text-[#86868b] leading-[1.47] max-w-[600px] mx-auto">
          {t('subtitle')}
        </p>
      </div>

      {/* Mobile - vertical stack */}
      <div className="lg:hidden space-y-3">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div key={index} className={`${feature.bgColor} rounded-[20px] p-8 border border-black/5`}>
              <div className={`w-12 h-12 rounded-[12px] ${feature.iconBg} flex items-center justify-center mb-4`}>
                <Icon className={`w-6 h-6 ${feature.iconColor}`} strokeWidth={1.5} />
              </div>
              <h3 className="text-[28px] font-semibold text-[#1d1d1f] tracking-[-0.02em] leading-[1.1] mb-2">
                {feature.title}
              </h3>
              <p className="text-[17px] text-[#86868b] leading-[1.47]">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Desktop - 2x2 grid */}
      <div className="hidden lg:grid lg:grid-cols-2 gap-4">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div 
              key={index} 
              className={`${feature.bgColor} rounded-[24px] p-12 border border-black/5 hover:shadow-lg transition-shadow duration-300`}
            >
              <div className={`w-14 h-14 rounded-[14px] ${feature.iconBg} flex items-center justify-center mb-6`}>
                <Icon className={`w-7 h-7 ${feature.iconColor}`} strokeWidth={1.5} />
              </div>
              <h3 className="text-[40px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-3">
                {feature.title}
              </h3>
              <p className="text-[19px] text-[#86868b] leading-[1.47] max-w-[400px]">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
