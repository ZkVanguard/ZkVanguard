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
    <div className="glass-strong rounded-3xl p-6 border border-gray-200 dark:border-gray-800 shadow-ios">
      <h3 className="text-lg font-bold mb-4 text-white">How It Works</h3>
      <div className="space-y-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={index} className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-xl hover:bg-gray-800 transition-all">
              <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg flex items-center justify-center shadow-ios">
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-primary-500">Step {index + 1}</span>
                  <h4 className="text-sm font-semibold text-white">{step.title}</h4>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{step.description}</p>
                <code className="text-xs text-primary-500 bg-gray-800 px-2 py-0.5 rounded">{step.example}</code>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
