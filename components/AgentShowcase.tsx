'use client';

import { Brain, FileText, DollarSign, TrendingUp, Activity } from 'lucide-react';

const agents = [
  {
    id: 'lead',
    name: 'Lead Agent',
    icon: Brain,
    description: 'Orchestrates multi-agent coordination and processes natural language commands',
    capabilities: ['Intent Recognition', 'Task Delegation', 'Workflow Orchestration'],
    color: 'from-purple-500 to-pink-500',
  },
  {
    id: 'risk',
    name: 'Risk Analysis Agent',
    icon: Activity,
    description: 'Monitors portfolio risk metrics and provides real-time alerts',
    capabilities: ['VaR Calculation', 'Volatility Analysis', 'Correlation Tracking'],
    color: 'from-red-500 to-orange-500',
  },
  {
    id: 'hedging',
    name: 'Hedging Agent',
    icon: TrendingUp,
    description: 'Executes automated hedging strategies on Moonlander perpetuals',
    capabilities: ['Position Management', 'Leverage Optimization', 'Rebalancing'],
    color: 'from-green-500 to-teal-500',
  },
  {
    id: 'settlement',
    name: 'Settlement Agent',
    icon: DollarSign,
    description: 'Processes batch payments and gasless transactions via x402',
    capabilities: ['Batch Processing', 'Gas Optimization', 'Priority Routing'],
    color: 'from-blue-500 to-cyan-500',
  },
  {
    id: 'reporting',
    name: 'Reporting Agent',
    icon: FileText,
    description: 'Generates comprehensive reports with ZK proof verification',
    capabilities: ['Multi-format Export', 'Audit Trails', 'Performance Analytics'],
    color: 'from-yellow-500 to-amber-500',
  },
];

export function AgentShowcase() {
  return (
    <section className="py-24 bg-gray-800">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
              Meet Your AI Team
            </span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Five specialized agents working together to protect and optimize your portfolio
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          {agents.map((agent) => {
            const Icon = agent.icon;
            return (
              <div
                key={agent.id}
                className="p-8 bg-gray-900 rounded-xl border border-gray-700 hover:border-gray-600 transition-all group"
              >
                <div className="flex items-start space-x-4">
                  <div className={`p-4 bg-gradient-to-br ${agent.color} rounded-lg`}>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-semibold mb-2 text-white group-hover:text-blue-400 transition-colors">
                      {agent.name}
                    </h3>
                    <p className="text-gray-400 mb-4">{agent.description}</p>
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-gray-500">Key Capabilities:</div>
                      <div className="flex flex-wrap gap-2">
                        {agent.capabilities.map((capability) => (
                          <span
                            key={capability}
                            className="px-3 py-1 bg-gray-800 rounded-full text-sm text-gray-300"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
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
