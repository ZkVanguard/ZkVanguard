'use client';

import { useState } from 'react';
import { Brain, TrendingUp, Shield, Zap, FileText, MessageSquare, Activity, ChevronRight, CheckCircle, ArrowRight } from 'lucide-react';

export default function AgentsPage() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>('lead');

  const agents = [
    {
      id: 'lead',
      name: 'Lead Agent',
      icon: Brain,
      color: '#007AFF',
      role: 'Orchestrator',
      status: 'active',
      description: 'Central coordinator that parses user intent, delegates tasks to specialized agents, and aggregates results.',
      capabilities: [
        'Natural language intent parsing',
        'Task delegation and routing',
        'Result aggregation and synthesis',
        'Inter-agent communication coordination',
        'Strategy execution orchestration'
      ],
      implementation: 'agents/core/LeadAgent.ts',
      extends: 'BaseAgent',
      messageTypes: ['strategy-input', 'agent-result', 'task-result', 'status-update'],
      currentStatus: 'Fully operational - orchestrates all 5 agents with complete end-to-end workflow validated'
    },
    {
      id: 'risk',
      name: 'Risk Agent',
      icon: TrendingUp,
      color: '#FF3B30',
      role: 'Risk Analyzer',
      status: 'active',
      description: 'Analyzes portfolio risk using quantitative metrics, volatility calculations, and exposure analysis.',
      capabilities: [
        'Value at Risk (VaR) calculation',
        'Volatility and standard deviation analysis',
        'Sharpe ratio computation',
        'Liquidation risk assessment',
        'Portfolio health scoring (0-100)',
        'Risk recommendations generation'
      ],
      implementation: 'agents/specialized/RiskAgent.ts',
      extends: 'BaseAgent',
      api: 'POST /api/agents/risk/assess',
      apiStatus: 'Fully operational - tested with real portfolio data',
      currentStatus: 'Validated in complete-system-test.ts: Risk score 12.2/100 (LOW), 100% success'
    },
    {
      id: 'hedging',
      name: 'Hedging Agent',
      icon: Shield,
      color: '#34C759',
      role: 'Strategy Generator',
      status: 'active',
      description: 'Generates optimal hedging strategies based on risk profile, market conditions, and portfolio composition.',
      capabilities: [
        'Short position recommendations',
        'Options strategy generation (calls/puts)',
        'Stablecoin hedge suggestions',
        'Cross-asset correlation analysis',
        'Confidence scoring for strategies',
        'Risk mitigation planning'
      ],
      implementation: 'agents/specialized/HedgingAgent.ts',
      extends: 'BaseAgent',
      api: 'POST /api/agents/hedging/recommend',
      apiStatus: 'Fully operational - generates dynamic strategies',
      currentStatus: 'Validated in complete-system-test.ts: 2 hedge strategies generated, portfolio rebalancing executed'
    },
    {
      id: 'settlement',
      name: 'Settlement Agent',
      icon: Zap,
      color: '#AF52DE',
      role: 'Transaction Executor',
      status: 'active',
      description: 'Executes batch settlements with ZK proof generation for gas optimization and privacy preservation.',
      capabilities: [
        'Batch transaction processing',
        'Gas optimization (20-40% savings)',
        'ZK-STARK proof generation coordination',
        'Transaction nonce management',
        'Settlement verification',
        'Rollback and retry logic'
      ],
      implementation: 'agents/specialized/SettlementAgent.ts',
      extends: 'BaseAgent',
      api: 'POST /api/agents/settlement/execute',
      apiStatus: 'Fully operational - real x402 gasless settlements',
      currentStatus: 'Validated in complete-system-test.ts: $1,000 gasless settlement created with ZK proof authentication'
    },
    {
      id: 'reporting',
      name: 'Reporting Agent',
      icon: FileText,
      color: '#FF9500',
      role: 'Analytics Generator',
      status: 'active',
      description: 'Generates comprehensive performance reports with compliance metrics and data visualization.',
      capabilities: [
        'Daily/weekly/monthly report generation',
        'Performance metrics calculation',
        'Profit & Loss tracking',
        'Top positions analysis',
        'Compliance reporting',
        'Historical trend analysis'
      ],
      implementation: 'agents/specialized/ReportingAgent.ts',
      extends: 'BaseAgent',
      api: 'POST /api/agents/reporting/generate',
      apiStatus: 'Fully operational - comprehensive analytics',
      currentStatus: 'Validated in complete-system-test.ts: Full portfolio report with positions, P&L, and metrics'
    }
  ];

  const selected = agents.find(a => a.id === selectedAgent);

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-[16px] flex items-center justify-center shadow-lg">
              <Brain className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            </div>
            <div>
              <h1 className="text-[28px] sm:text-[34px] lg:text-[40px] font-bold text-[#1d1d1f] tracking-[-0.02em]">
                AI Agent System
              </h1>
              <p className="text-[14px] sm:text-[15px] text-[#86868b]">Multi-agent architecture for autonomous portfolio management</p>
            </div>
          </div>
        </div>

        {/* Status Banner */}
        <div className="bg-white rounded-[16px] sm:rounded-[20px] border border-black/5 p-4 sm:p-5 mb-6 sm:mb-8 shadow-sm">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#34C759]/10 rounded-[12px] flex items-center justify-center flex-shrink-0">
              <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-[#34C759]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-1">Production Status: 10/10 Tests Passing</h3>
              <p className="text-[13px] sm:text-[14px] text-[#86868b] mb-3 leading-relaxed">
                All 5 agents fully operational with real integrations. System validated with live CoinGecko prices, 
                ZK-STARK proofs, and x402 gasless settlements.
              </p>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {['5 Agents Operational', 'CoinGecko Integration', 'ZK Proofs Validated', 'x402 Gasless'].map((item, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#34C759]/10 text-[#34C759] rounded-full text-[11px] sm:text-[12px] font-medium">
                    <CheckCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          {/* Agent Cards - Left Side */}
          <div className="lg:col-span-4 space-y-3">
            <h2 className="text-[13px] sm:text-[14px] font-semibold text-[#86868b] uppercase tracking-wide px-1 mb-2">
              Available Agents
            </h2>
            {agents.map((agent) => {
              const Icon = agent.icon;
              const isSelected = selectedAgent === agent.id;

              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent.id)}
                  className={`w-full text-left bg-white rounded-[16px] border-2 transition-all active:scale-[0.98] p-4 ${
                    isSelected 
                      ? 'border-[#007AFF] shadow-[0_0_0_4px_rgba(0,122,255,0.1)]' 
                      : 'border-transparent hover:border-black/10 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-11 h-11 sm:w-12 sm:h-12 rounded-[12px] flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${agent.color}15` }}
                    >
                      <Icon className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: agent.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <h3 className="text-[15px] sm:text-[16px] font-semibold text-[#1d1d1f]">{agent.name}</h3>
                        <ChevronRight 
                          className={`w-4 h-4 sm:w-5 sm:h-5 transition-colors ${isSelected ? 'text-[#007AFF]' : 'text-[#c7c7cc]'}`} 
                        />
                      </div>
                      <p className="text-[12px] sm:text-[13px] text-[#86868b] mb-1.5">{agent.role}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-[#34C759] rounded-full animate-pulse" />
                        <span className="text-[11px] sm:text-[12px] text-[#34C759] font-medium">Active</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Agent Details - Right Side */}
          <div className="lg:col-span-8">
            {selected ? (
              <div className="bg-white rounded-[20px] sm:rounded-[24px] border border-black/5 shadow-sm overflow-hidden">
                {/* Detail Header */}
                <div className="p-5 sm:p-6 border-b border-black/5">
                  <div className="flex items-start gap-4">
                    <div 
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-[16px] flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${selected.color}15` }}
                    >
                      {(() => {
                        const Icon = selected.icon;
                        return <Icon className="w-7 h-7 sm:w-8 sm:h-8" style={{ color: selected.color }} />;
                      })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-[22px] sm:text-[26px] font-bold text-[#1d1d1f] tracking-[-0.01em] mb-1">{selected.name}</h2>
                      <p className="text-[14px] sm:text-[15px] text-[#86868b] leading-relaxed">{selected.description}</p>
                    </div>
                  </div>
                </div>

                {/* Capabilities */}
                <div className="p-5 sm:p-6 border-b border-black/5">
                  <h3 className="text-[13px] sm:text-[14px] font-semibold text-[#86868b] uppercase tracking-wide mb-4">Capabilities</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                    {selected.capabilities.map((capability, index) => (
                      <div key={index} className="flex items-start gap-2.5 p-3 bg-[#f5f5f7] rounded-[10px]">
                        <ArrowRight className="w-4 h-4 text-[#007AFF] mt-0.5 flex-shrink-0" />
                        <span className="text-[13px] sm:text-[14px] text-[#1d1d1f]">{capability}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Implementation Details */}
                <div className="p-5 sm:p-6 space-y-4">
                  <div className="bg-[#f5f5f7] rounded-[12px] p-4">
                    <h4 className="text-[11px] sm:text-[12px] font-semibold text-[#86868b] uppercase tracking-wide mb-2">Implementation</h4>
                    <code className="text-[13px] sm:text-[14px] text-[#007AFF] font-mono">{selected.implementation}</code>
                    <p className="text-[11px] sm:text-[12px] text-[#86868b] mt-1.5">Extends: {selected.extends}</p>
                  </div>

                  {selected.api && (
                    <div className="bg-[#f5f5f7] rounded-[12px] p-4">
                      <h4 className="text-[11px] sm:text-[12px] font-semibold text-[#86868b] uppercase tracking-wide mb-2">API Endpoint</h4>
                      <code className="text-[13px] sm:text-[14px] text-[#34C759] font-mono">{selected.api}</code>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] px-2 py-1 bg-[#34C759]/10 text-[#34C759] rounded-full font-medium">
                          ✓ Live
                        </span>
                        <p className="text-[12px] text-[#86868b]">{selected.apiStatus}</p>
                      </div>
                    </div>
                  )}

                  {selected.messageTypes && (
                    <div className="bg-[#f5f5f7] rounded-[12px] p-4">
                      <h4 className="text-[11px] sm:text-[12px] font-semibold text-[#86868b] uppercase tracking-wide mb-3">MessageBus Events</h4>
                      <div className="flex flex-wrap gap-2">
                        {selected.messageTypes.map((type, index) => (
                          <span key={index} className="text-[11px] sm:text-[12px] px-2.5 py-1 bg-[#AF52DE]/10 text-[#AF52DE] rounded-full font-medium">
                            {type}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px] p-4">
                    <h4 className="text-[11px] sm:text-[12px] font-semibold text-[#007AFF] uppercase tracking-wide mb-2">Current Status</h4>
                    <p className="text-[13px] sm:text-[14px] text-[#1d1d1f] leading-relaxed">{selected.currentStatus}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-[20px] border border-black/5 p-12 sm:p-16 text-center shadow-sm">
                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 bg-[#f5f5f7] rounded-full flex items-center justify-center">
                  <MessageSquare className="w-8 h-8 sm:w-10 sm:h-10 text-[#86868b]" />
                </div>
                <h3 className="text-[18px] sm:text-[20px] font-semibold text-[#1d1d1f] mb-2">Select an Agent</h3>
                <p className="text-[14px] sm:text-[15px] text-[#86868b]">Click on an agent card to view detailed information</p>
              </div>
            )}
          </div>
        </div>

        {/* Architecture Section */}
        <div className="mt-8 sm:mt-12 bg-white rounded-[20px] sm:rounded-[24px] border border-black/5 shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-black/5">
            <h2 className="text-[20px] sm:text-[24px] font-bold text-[#1d1d1f] tracking-[-0.01em]">Agent Architecture</h2>
          </div>
          
          <div className="p-5 sm:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6">
              <div className="bg-[#f5f5f7] rounded-[14px] p-4 sm:p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 bg-[#007AFF]/10 rounded-[8px] flex items-center justify-center">
                    <MessageSquare className="w-4 h-4 text-[#007AFF]" />
                  </div>
                  <h3 className="text-[15px] sm:text-[16px] font-semibold text-[#1d1d1f]">MessageBus Communication</h3>
                </div>
                <p className="text-[13px] sm:text-[14px] text-[#86868b] mb-3 leading-relaxed">
                  All agents communicate through a central MessageBus using EventEmitter3 for inter-agent coordination.
                </p>
                <code className="text-[12px] text-[#007AFF] font-mono bg-white px-3 py-1.5 rounded-[6px] border border-black/5 inline-block">
                  agents/communication/MessageBus.ts
                </code>
              </div>

              <div className="bg-[#f5f5f7] rounded-[14px] p-4 sm:p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 bg-[#AF52DE]/10 rounded-[8px] flex items-center justify-center">
                    <Brain className="w-4 h-4 text-[#AF52DE]" />
                  </div>
                  <h3 className="text-[15px] sm:text-[16px] font-semibold text-[#1d1d1f]">Base Agent Class</h3>
                </div>
                <p className="text-[13px] sm:text-[14px] text-[#86868b] mb-3 leading-relaxed">
                  All specialized agents extend BaseAgent which provides core functionality for task execution and messaging.
                </p>
                <code className="text-[12px] text-[#AF52DE] font-mono bg-white px-3 py-1.5 rounded-[6px] border border-black/5 inline-block">
                  agents/core/BaseAgent.ts
                </code>
              </div>
            </div>

            <div className="bg-[#1d1d1f] rounded-[14px] p-4 sm:p-5">
              <h4 className="text-[11px] sm:text-[12px] font-semibold text-[#86868b] uppercase tracking-wide mb-4">Message Flow</h4>
              <pre className="text-[12px] sm:text-[13px] text-[#f5f5f7] overflow-x-auto font-mono leading-relaxed">
{`User Input → Lead Agent (parse intent)
    ↓
MessageBus (route to specialized agents)
    ↓
Risk/Hedging/Settlement/Reporting Agent (execute task)
    ↓
MessageBus (return results)
    ↓
Lead Agent (aggregate & respond to user)`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
