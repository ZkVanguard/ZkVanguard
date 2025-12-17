'use client';

import { DollarSign, TrendingUp, Activity } from 'lucide-react';

const agents = [
  {
    id: 'risk',
    name: 'Risk Agent',
    icon: Activity,
    description: 'Monitors portfolio risk & provides alerts',
    capabilities: ['VaR', 'Volatility', 'Correlation'],
    color: 'from-red-500 to-orange-500',
  },
  {
    id: 'hedging',
    name: 'Hedge Agent',
    icon: TrendingUp,
    description: 'Executes automated hedging strategies',
    capabilities: ['Positions', 'Leverage', 'Rebalancing'],
    color: 'from-green-500 to-teal-500',
  },
  {
    id: 'settlement',
    name: 'Settlement Agent',
    icon: DollarSign,
    description: 'Handles batch payments & transactions',
    capabilities: ['Batching', 'Gas Savings', 'Routing'],
    color: 'from-blue-500 to-cyan-500',
  },
];

export function AgentShowcase() {
  return (
    <div className="glass-strong rounded-3xl p-6 border border-gray-800 shadow-ios">
      <h3 className="text-lg font-bold mb-4 text-white">AI Agents</h3>
      <div className="space-y-3">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.id}
              className="p-4 bg-gray-800/50 rounded-xl hover:bg-gray-800 transition-all group"
            >
              <div className="flex items-start space-x-3">
                <div className={`p-2.5 bg-gradient-to-br ${agent.color} rounded-xl shadow-ios-lg flex-shrink-0`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-semibold mb-1 text-white">
                    {agent.name}
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{agent.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {agent.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="px-2 py-0.5 bg-gray-700 rounded-md text-xs text-gray-100 font-medium"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
