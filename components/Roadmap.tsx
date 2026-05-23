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
      iconColor: 'text-[#6E8C5E]',
      iconBg: 'bg-[#7E9B6F]/15',
    },
    {
      icon: TrendingUp,
      title: t('q3Title'),
      description: t('q3Description'),
      status: t('upcoming'),
      statusClass: 'bg-claude-border text-claude-ink2',
      iconColor: 'text-claude-sky',
      iconBg: 'bg-claude-sky/15',
    },
    {
      icon: Rocket,
      title: t('q4Title'),
      description: t('q4Description'),
      status: t('planned'),
      statusClass: 'bg-claude-border text-claude-ink2',
      iconColor: 'text-claude-orange',
      iconBg: 'bg-claude-orange/12',
    },
  ];

  return (
    <section className="py-24 bg-claude-bg">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="font-serif text-4xl md:text-5xl font-semibold mb-4 text-claude-ink tracking-[-0.02em]">
            {t('title')}
          </h2>
          <p className="text-xl text-claude-ink2 max-w-2xl mx-auto">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {milestones.map((milestone, index) => {
            const Icon = milestone.icon;
            return (
              <div key={index} className="claude-card p-6">
                <div className={`inline-flex p-3 ${milestone.iconBg} rounded-[14px] mb-4`}>
                  <Icon className={`w-6 h-6 ${milestone.iconColor}`} />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-claude-ink">{milestone.title}</h3>
                <p className="text-claude-ink2 text-sm mb-4">{milestone.description}</p>
                <div className={`text-xs px-3 py-1 rounded-full inline-block font-medium ${milestone.statusClass}`}>
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
