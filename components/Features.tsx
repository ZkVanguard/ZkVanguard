'use client';

import { Shield, Zap, Users, BarChart3, Clock, Lock } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'ZK-STARK Proofs',
    description: 'Every action verified with zero-knowledge proofs ensuring privacy and security.',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  {
    icon: Zap,
    title: 'Autonomous Agents',
    description: 'AI agents working 24/7 to analyze, hedge, and optimize your portfolio.',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
  },
  {
    icon: Users,
    title: 'Multi-Agent Coordination',
    description: 'Specialized agents collaborate to provide comprehensive risk management.',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  {
    icon: BarChart3,
    title: 'Real-time Analytics',
    description: 'Live monitoring of positions, risk metrics, and performance indicators.',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  {
    icon: Clock,
    title: 'Automated Settlements',
    description: 'Batch processing and gasless transactions for efficient payment routing.',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
  },
  {
    icon: Lock,
    title: 'Non-Custodial',
    description: 'You maintain full control of your assets at all times.',
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
];

export function Features() {
  return (
    <section className="py-24 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
              Enterprise-Grade Features
            </span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Built on cutting-edge technology to provide the most secure and efficient risk management
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="p-6 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-gray-600 transition-all hover:scale-105"
              >
                <div className={`inline-flex p-3 ${feature.bgColor} rounded-lg mb-4`}>
                  <Icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <h3 className="text-xl font-semibold mb-2 text-white">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
