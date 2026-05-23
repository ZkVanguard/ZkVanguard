'use client';

import { DollarSign, Users, TrendingUp, Globe, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function MarketOpportunity() {
  const t = useTranslations('marketOpportunity');

  const marketData = [
    {
      icon: DollarSign,
      label: t('rwaMarketSize'),
      value: '$16T',
      description: t('rwaDescription'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
    {
      icon: TrendingUp,
      label: t('growthRate'),
      value: '50x',
      description: t('growthDescription'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
    {
      icon: Globe,
      label: t('targetMarket'),
      value: '$1.2T',
      description: t('targetDescription'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
    {
      icon: Users,
      label: t('potentialUsers'),
      value: '10K+',
      description: t('usersDescription'),
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
  ];

  const competitors = [
    { name: t('traditionalTools'), gap: t('noAiAutomation') },
    { name: t('defiProtocols'), gap: t('limitedRwa') },
    { name: t('centralizedServices'), gap: t('custodialRisk') },
  ];

  const valueProps = [
    { title: t('aiPowered'), desc: t('aiDescription') },
    { title: t('zkVerificationFeature'), desc: t('zkDescription') },
    { title: t('nonCustodial'), desc: t('nonCustodialDescription') },
    { title: t('gasOptimization'), desc: t('gasDescription') },
  ];

  return (
    <section className="py-24 bg-claude-surface relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-semibold mb-4 text-claude-ink tracking-[-0.02em]">
            {t('title')}
          </h2>
          <p className="text-xl text-claude-ink2 max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </div>

        {/* Market Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {marketData.map((data, index) => {
            const Icon = data.icon;
            return (
              <div key={index} className="claude-card p-6 text-center">
                <div className={`inline-flex p-3 ${data.iconBg} rounded-[14px] mb-3`}>
                  <Icon className={`w-6 h-6 ${data.iconColor}`} />
                </div>
                <div className="text-3xl font-semibold mb-2 text-claude-ink">{data.value}</div>
                <div className="text-sm text-claude-ink2 mb-1">{data.label}</div>
                <div className="text-xs text-claude-ink3">{data.description}</div>
              </div>
            );
          })}
        </div>

        {/* Competitive Advantage */}
        <div className="max-w-4xl mx-auto">
          <h3 className="text-2xl font-semibold text-center mb-8 text-claude-ink">{t('competitiveEdge')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {competitors.map((comp, index) => (
              <div key={index} className="claude-card p-6">
                <div className="text-lg font-semibold mb-2 text-claude-ink">{comp.name}</div>
                <div className="text-sm text-[#C0654A] mb-3">✕ {comp.gap}</div>
                <div className="text-sm text-[#6E8C5E] font-medium">✓ ZkVanguard</div>
              </div>
            ))}
          </div>
        </div>

        {/* Unique Value Props */}
        <div className="mt-16 claude-card p-8 max-w-4xl mx-auto">
          <div className="flex items-center space-x-3 mb-6">
            <Shield className="w-8 h-8 text-claude-orange" />
            <h3 className="text-2xl font-semibold text-claude-ink">{t('whyWins')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {valueProps.map((vp, index) => (
              <div key={index} className="flex items-start space-x-3">
                <div className="w-6 h-6 bg-[#6E8C5E] rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-claude-ink">{vp.title}</div>
                  <div className="text-sm text-claude-ink2">{vp.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
