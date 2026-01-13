'use client';

import { motion } from 'framer-motion';
import { Target, TrendingUp, Users, Rocket } from 'lucide-react';

const milestones = [
  {
    icon: Target,
    title: 'Q1 2026: Testnet Launch',
    description: 'Full agent system live on Cronos zkEVM testnet',
    status: 'In Progress',
    color: 'text-blue-500',
  },
  {
    icon: Users,
    title: 'Q2 2026: Beta Users',
    description: '100+ institutional users managing $50M+ TVL',
    status: 'Upcoming',
    color: 'text-purple-500',
  },
  {
    icon: TrendingUp,
    title: 'Q3 2026: Mainnet',
    description: 'Production launch with institutional partnerships',
    status: 'Planned',
    color: 'text-green-500',
  },
  {
    icon: Rocket,
    title: 'Q4 2026: Scale',
    description: '$500M+ TVL across multiple chains',
    status: 'Planned',
    color: 'text-yellow-500',
  },
];

export function Roadmap() {
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
              Product Roadmap
            </span>
          </h2>
          <p className="text-xl text-[#6E6E73] max-w-2xl mx-auto">
            Our path to revolutionizing institutional RWA risk management
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
