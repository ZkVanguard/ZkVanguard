'use client';

import { memo } from 'react';
import { ShieldCheckIcon, BoltIcon, ChartBarIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

export const Features = memo(function Features() {
  const t = useTranslations('features');
  
  const features = [
    {
      icon: ShieldCheckIcon,
      title: t('zkProofs.title'),
      description: t('zkProofs.description'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
    {
      icon: BoltIcon,
      title: t('aiAgents.title'),
      description: t('aiAgents.description'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
    {
      icon: ChartBarIcon,
      title: t('liveAnalytics.title'),
      description: t('liveAnalytics.description'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
    {
      icon: LockClosedIcon,
      title: t('quantumProof.title'),
      description: t('quantumProof.description'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
  ];

  return (
    <div>
      {/* Section Header */}
      <div className="text-center mb-12 lg:mb-16">
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-claude-ink tracking-[-0.02em] leading-[1.08] mb-4">
          {t('title')}
        </h2>
        <p className="text-[19px] lg:text-[21px] text-claude-ink2 leading-[1.47] max-w-[600px] mx-auto">
          {t('subtitle')}
        </p>
      </div>

      {/* Mobile - vertical stack */}
      <div className="lg:hidden space-y-3">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div key={index} className="claude-card p-8">
              <div className={`w-12 h-12 rounded-[12px] ${feature.iconBg} flex items-center justify-center mb-4`}>
                <Icon className={`w-6 h-6 ${feature.iconColor}`} strokeWidth={1.5} />
              </div>
              <h3 className="text-[28px] font-semibold text-claude-ink tracking-[-0.02em] leading-[1.1] mb-2">
                {feature.title}
              </h3>
              <p className="text-[17px] text-claude-ink2 leading-[1.47]">
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
              className="claude-card p-12"
            >
              <div className={`w-14 h-14 rounded-[14px] ${feature.iconBg} flex items-center justify-center mb-6`}>
                <Icon className={`w-7 h-7 ${feature.iconColor}`} strokeWidth={1.5} />
              </div>
              <h3 className="text-[40px] font-semibold text-claude-ink tracking-[-0.025em] leading-[1.08] mb-3">
                {feature.title}
              </h3>
              <p className="text-[19px] text-claude-ink2 leading-[1.47] max-w-[400px]">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
});
