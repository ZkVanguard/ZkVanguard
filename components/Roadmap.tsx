'use client';

import { motion } from 'framer-motion';
import { Target, TrendingUp, Users, Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function Roadmap() {
  const t = useTranslations('roadmap');
  
  const milestones = [
    {
      icon: Target,
      title: t('q1Title'),
      description: t('q1Description'),
      status: t('inProgress'),
      color: 'text-blue-500',
    },
    {
      icon: Users,
      title: t('q2Title'),
      description: t('q2Description'),
      status: t('upcoming'),
      color: 'text-purple-500',
    },
    {
      icon: TrendingUp,
      title: t('q3Title'),
      description: t('q3Description'),
      status: t('planned'),
      color: 'text-green-500',
    },
    {
      icon: Rocket,
      title: t('q4Title'),
      description: t('q4Description'),
      status: t('planned'),
      color: 'text-yellow-500',
    },
  ];

  return (
    <section className="py-24 bg-white">
      <div className="container mx-auto px-4">
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {milestones.map((milestone, index) => {
            const Icon = milestone.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="p-6 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl hover:border-[#C6C6C8] transition-all"
              >
                <div className={`inline-flex p-3 ${milestone.color.replace('text-', 'bg-')}/10 rounded-lg mb-4`}>
                  <Icon className={`w-6 h-6 ${milestone.color}`} />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-[#1D1D1F]">{milestone.title}</h3>
                <p className="text-[#6E6E73] text-sm mb-4">{milestone.description}</p>
                <div className="text-xs px-3 py-1 bg-[#E5E5EA] rounded-full inline-block text-[#424245]">
                  {milestone.status}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
