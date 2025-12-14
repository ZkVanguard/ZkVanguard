'use client';

import { MessageSquare, Brain, Shield, CheckCircle } from 'lucide-react';

const steps = [
  {
    icon: MessageSquare,
    title: 'Natural Language Commands',
    description: 'Simply describe what you want to do in plain English. Our Lead Agent understands your intent.',
    example: '"Analyze my portfolio risk and hedge if volatility is high"',
  },
  {
    icon: Brain,
    title: 'Agent Coordination',
    description: 'Multiple specialized agents work together to analyze, execute, and optimize your strategy.',
    example: 'Risk → Hedging → Settlement → Reporting',
  },
  {
    icon: Shield,
    title: 'ZK Proof Generation',
    description: 'Every action is verified with zero-knowledge proofs for security and auditability.',
    example: 'STARK proofs validate all operations',
  },
  {
    icon: CheckCircle,
    title: 'Automated Execution',
    description: 'Agents execute trades, settlements, and generate reports automatically.',
    example: 'Set it and forget it',
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
              How It Works
            </span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            From intent to execution in four simple steps
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={index} className="relative">
                {/* Connector Line */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute left-8 top-20 w-0.5 h-24 bg-gradient-to-b from-blue-500 to-purple-600" />
                )}

                <div className="flex flex-col md:flex-row items-start md:items-center space-y-4 md:space-y-0 md:space-x-6 mb-12">
                  {/* Icon */}
                  <div className="flex-shrink-0 w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <Icon className="w-8 h-8 text-white" />
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-sm font-medium text-blue-500">Step {index + 1}</span>
                      <h3 className="text-2xl font-semibold text-white">{step.title}</h3>
                    </div>
                    <p className="text-gray-400 mb-3">{step.description}</p>
                    <div className="px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg inline-block">
                      <code className="text-sm text-blue-400">{step.example}</code>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
