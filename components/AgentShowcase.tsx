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
    <div className="glass-strong rounded-2xl p-8 border border-blue-500/20 shadow-lg shadow-blue-500/10 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-purple-500/10 opacity-50 group-hover:opacity-70 transition-opacity duration-500" />
      <h3 className="text-xl font-semibold mb-6 text-white tracking-tight relative z-10">AI Agents</h3>
      <div className="space-y-4 relative z-10">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.id}
              className="p-4 bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 hover:bg-gray-800/70 hover:border-gray-600 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5"
            >
              <div className="flex items-start space-x-3">
                <div className={`p-2.5 bg-gradient-to-br ${agent.color} rounded-xl shadow-ios-lg flex-shrink-0`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-semibold mb-1 text-white">
                    {agent.name}
                  </h4>
                  <p className="text-sm text-gray-400 mb-2">{agent.description}</p>
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
