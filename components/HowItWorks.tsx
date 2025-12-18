'use client';

import { MessageSquare, Brain, CheckCircle } from 'lucide-react';

const steps = [
  {
    icon: MessageSquare,
    title: 'Connect',
    description: 'Link your wallet & set preferences',
    example: 'Web3 wallet integration',
  },
  {
    icon: Brain,
    title: 'Monitor',
    description: 'AI agents analyze portfolio risk 24/7',
    example: 'Real-time risk analysis',
  },
  {
    icon: CheckCircle,
    title: 'Execute',
    description: 'Auto-hedge & settle transactions',
    example: 'Automated protection',
  },
];

export function HowItWorks() {
  return (
    <div className="glass-strong rounded-2xl p-8 border border-purple-500/20 shadow-lg shadow-purple-500/10 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-tl from-purple-500/10 via-transparent to-blue-500/10 opacity-50 group-hover:opacity-70 transition-opacity duration-500" />
      <h3 className="text-xl font-semibold mb-6 text-white tracking-tight relative z-10">How It Works</h3>
      <div className="space-y-4 relative z-10">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={index} className="flex items-start gap-4 p-4 bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 hover:bg-gray-800/70 hover:border-gray-600 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/5">
              <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-primary-500 to-accent-500 rounded-xl flex items-center justify-center shadow-lg">
                <Icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-primary-400">Step {index + 1}</span>
                  <h4 className="text-base font-semibold text-white">{step.title}</h4>
                </div>
                <p className="text-sm text-gray-400 mb-2">{step.description}</p>
                <code className="text-xs text-primary-400 bg-gray-900/50 px-2 py-1 rounded">{step.example}</code>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
