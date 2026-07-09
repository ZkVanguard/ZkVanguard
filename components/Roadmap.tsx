'use client';

import { Target, TrendingUp, Users, Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function Roadmap() {
  const t = useTranslations('roadmap');

  const milestones = [
    {
      icon: Target,
      title: t('q1Title'),
      description: t('q1Description'),
      status: t('completed'),
      statusClass: 'bg-claude-border text-claude-ink2',
      iconColor: 'text-claude-ink3',
      iconBg: 'bg-claude-ink3/12',
    },
    {
      icon: Users,
      title: t('q2Title'),
      description: t('q2Description'),
      status: t('live'),
      statusClass: 'bg-[#7E9B6F]/20 text-[#5C7850]',
      iconColor: 'text-claude-ink3',
      iconBg: 'bg-claude-ink3/12',
    },
    {
      icon: TrendingUp,
      title: t('q3Title'),
      description: t('q3Description'),
      status: t('upcoming'),
      statusClass: 'bg-claude-border text-claude-ink2',
      iconColor: 'text-claude-ink3',
      iconBg: 'bg-claude-ink3/12',
    },
    {
      icon: Rocket,
      title: t('q4Title'),
      description: t('q4Description'),
      status: t('planned'),
      statusClass: 'bg-claude-border text-claude-ink2',
      iconColor: 'text-claude-ink3',
      iconBg: 'bg-claude-ink3/12',
    },
  ];

  return (
    <section className="py-16 sm:py-20 md:py-24 bg-claude-bg">
      <div className="container mx-auto px-4 max-w-full">
        <div className="text-center mb-10 sm:mb-12 md:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-semibold mb-3 sm:mb-4 text-claude-ink tracking-[-0.02em] px-2">
            {t('title')}
          </h2>
          <p className="text-base sm:text-lg md:text-xl text-claude-ink2 max-w-2xl mx-auto px-2 leading-relaxed">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-7xl mx-auto">
          {milestones.map((milestone, index) => {
            const Icon = milestone.icon;
            return (
              <div key={index} className="claude-card p-4 sm:p-6 min-w-0">
                <div className={`inline-flex p-2.5 sm:p-3 ${milestone.iconBg} rounded-[14px] mb-3 sm:mb-4`}>
                  <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${milestone.iconColor}`} />
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-2 text-claude-ink break-words">{milestone.title}</h3>
                <p className="text-claude-ink2 text-xs sm:text-sm mb-3 sm:mb-4 leading-relaxed break-words">{milestone.description}</p>
                <div className={`text-[11px] sm:text-xs px-2.5 sm:px-3 py-1 rounded-full inline-block font-medium ${milestone.statusClass}`}>
                  {milestone.status}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
