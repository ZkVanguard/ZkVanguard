'use client';

import { Shield, Zap, BarChart3, Lock } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'ZK Proofs',
    description: 'Zero-knowledge verification for privacy & security.',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  {
    icon: Zap,
    title: 'AI Agents',
    description: '24/7 automated portfolio optimization.',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
  },
  {
    icon: BarChart3,
    title: 'Live Analytics',
    description: 'Real-time risk metrics & insights.',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  {
    icon: Lock,
    title: 'Non-Custodial',
    description: 'Full control of your assets, always.',
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
];

export function Features() {
  return (
    <div className="glass-strong rounded-3xl p-6 border border-gray-800 shadow-ios">
      <h3 className="text-lg font-bold mb-4 text-white">Key Features</h3>
      <div className="grid grid-cols-1 gap-3">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-xl hover:bg-gray-800 transition-all"
              >
                <div className={`flex-shrink-0 p-2 ${feature.bgColor} rounded-lg`}>
                  <Icon className={`w-5 h-5 ${feature.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white">{feature.title}</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{feature.description}</p>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
