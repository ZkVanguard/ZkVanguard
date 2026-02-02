'use client';

import { motion } from 'framer-motion';
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
      color: 'text-green-500',
    },
    {
      icon: TrendingUp,
      label: t('growthRate'),
      value: '50x',
      description: t('growthDescription'),
      color: 'text-blue-500',
    },
    {
      icon: Globe,
      label: t('targetMarket'),
      value: '$1.2T',
      description: t('targetDescription'),
      color: 'text-purple-500',
    },
    {
      icon: Users,
      label: t('potentialUsers'),
      value: '10K+',
      description: t('usersDescription'),
      color: 'text-yellow-500',
    },
  ];

  const competitors = [
    { name: t('traditionalTools'), gap: t('noAiAutomation') },
    { name: t('defiProtocols'), gap: t('limitedRwa') },
    { name: t('centralizedServices'), gap: t('custodialRisk') },
  ];

  return (
    <section className="py-24 bg-[#F5F5F7] relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-[#007AFF] to-[#5856D6] bg-clip-text text-transparent">
              {t('title')}
            </span>
          </h2>
          <p className="text-xl text-[#6E6E73] max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </motion.div>

        {/* Market Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {marketData.map((data, index) => {
            const Icon = data.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="p-6 bg-white border border-[#E5E5EA] rounded-xl text-center shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
              >
                <div className={`inline-flex p-3 ${data.color.replace('text-', 'bg-')}/10 rounded-lg mb-3`}>
                  <Icon className={`w-6 h-6 ${data.color}`} />
                </div>
                <div className="text-3xl font-bold mb-2 text-[#1D1D1F]">{data.value}</div>
                <div className="text-sm text-[#6E6E73] mb-1">{data.label}</div>
                <div className="text-xs text-[#86868B]">{data.description}</div>
              </motion.div>
            );
          })}
        </div>

        {/* Competitive Advantage */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto"
        >
          <h3 className="text-2xl font-bold text-center mb-8 text-[#1D1D1F]">{t('competitiveEdge')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {competitors.map((comp, index) => (
              <div key={index} className="p-6 bg-white border border-[#E5E5EA] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                <div className="text-lg font-semibold mb-2 text-[#1D1D1F]">{comp.name}</div>
                <div className="text-sm text-[#FF3B30] mb-3">❌ {comp.gap}</div>
                <div className="text-sm text-[#34C759]">✓ ZkVanguard</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Unique Value Props */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 p-8 bg-white border border-[#007AFF]/20 rounded-2xl max-w-4xl mx-auto shadow-[0_4px_12px_rgba(0,122,255,0.08)]"
        >
          <div className="flex items-center space-x-3 mb-6">
            <Shield className="w-8 h-8 text-[#007AFF]" />
            <h3 className="text-2xl font-bold text-[#1D1D1F]">{t('whyWins')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-[#34C759] rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-[#1D1D1F]">{t('aiPowered')}</div>
                <div className="text-sm text-[#6E6E73]">{t('aiDescription')}</div>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-[#34C759] rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-[#1D1D1F]">{t('zkVerificationFeature')}</div>
                <div className="text-sm text-[#6E6E73]">{t('zkDescription')}</div>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-[#34C759] rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-[#1D1D1F]">{t('nonCustodial')}</div>
                <div className="text-sm text-[#6E6E73]">{t('nonCustodialDescription')}</div>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-[#34C759] rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-[#1D1D1F]">{t('gasOptimization')}</div>
                <div className="text-sm text-[#6E6E73]">{t('gasDescription')}</div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
