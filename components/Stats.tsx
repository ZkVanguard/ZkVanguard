'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export function Stats() {
  const t = useTranslations('stats');
  const [isVisible, setIsVisible] = useState(false);

  const stats = [
    { label: t('aiAgents'), value: '6', prefix: '' },
    { label: t('gasSavings'), value: '100%', prefix: '' },
    { label: t('zkProofs'), value: '2K+', prefix: '' },
    { label: 'Chains Supported', value: '2', prefix: '' },
  ];

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div>
      {/* Mobile */}
      <div className="lg:hidden space-y-16">
        {stats.map((stat, index) => (
          <div
            key={index}
            className={`text-center transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: `${index * 80}ms` }}
          >
            <div className="text-[72px] font-semibold text-[#1d1d1f] tracking-[-0.06em] leading-none mb-2">
              {stat.value}
            </div>
            <div className="text-[17px] text-[#86868b]">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Desktop - pure centered typography */}
      <div className="hidden lg:block">
        {/* Hero stat - 100% */}
        <div className="text-center mb-32">
          <div
            className={`transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: '80ms' }}
          >
            <div className="text-[180px] font-semibold text-[#1d1d1f] tracking-[-0.08em] leading-none mb-4">
              {stats[1].value}
            </div>
            <div className="text-[32px] font-semibold text-[#1d1d1f] mb-2">{stats[1].label}</div>
            <div className="text-[17px] text-[#86868b]">{t('batchingNote')}</div>
          </div>
        </div>

        {/* Supporting stats - horizontal line */}
        <div className="flex items-start justify-center gap-24">
          {[stats[0], stats[2], stats[3]].map((stat, index) => (
            <div
              key={index}
              className={`text-center transition-all duration-700 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: `${(index + 2) * 80}ms` }}
            >
              <div className="text-[80px] font-semibold text-[#1d1d1f] tracking-[-0.06em] leading-none mb-3">
                {stat.value}
              </div>
              <div className="text-[17px] text-[#86868b]">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
