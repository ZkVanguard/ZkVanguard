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
    title: 'Quantum-Proof ZK-STARK',
    description: 'Post-quantum cryptography for future security.',
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
  },
];

export function Features() {
  return (
    <div className="glass-light rounded-2xl p-8 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-tl from-purple-500/5 via-transparent to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <h3 className="text-xl font-semibold mb-6 text-gray-900 tracking-tight relative z-10">Key Features</h3>
      <div className="grid grid-cols-1 gap-4 relative z-10">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="flex items-center gap-4 p-4 bg-white/40 backdrop-blur-xl rounded-xl border border-black/5 hover:bg-white/60 hover:shadow-sm transition-all duration-300 hover:-translate-y-0.5"
              >
                <div className={`flex-shrink-0 p-3 ${feature.bgColor} rounded-xl`}>
                  <Icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-semibold text-gray-900 tracking-tight mb-0.5">{feature.title}</h4>
                  <p className="text-sm text-gray-500 font-light">{feature.description}</p>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
