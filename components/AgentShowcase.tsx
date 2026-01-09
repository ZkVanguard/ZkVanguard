'use client';

const agents = [
  {
    id: 'lead',
    name: 'Lead Agent',
    role: 'Orchestrator',
    status: 'Active',
    bgColor: 'bg-[#007AFF]/[0.08]',
  },
  {
    id: 'risk',
    name: 'Risk Agent',
    role: 'Risk Analyzer',
    status: 'Active',
    bgColor: 'bg-[#FF9500]/[0.08]',
  },
  {
    id: 'hedging',
    name: 'Hedging Agent',
    role: 'Strategy Generator',
    status: 'Active',
    bgColor: 'bg-[#34C759]/[0.08]',
  },
  {
    id: 'settlement',
    name: 'Settlement Agent',
    role: 'Transaction Executor',
    status: 'Active',
    bgColor: 'bg-[#AF52DE]/[0.08]',
  },
  {
    id: 'reporting',
    name: 'Reporting Agent',
    role: 'Analytics Generator',
    status: 'Active',
    bgColor: 'bg-[#FF2D55]/[0.08]',
  },
];

export function AgentShowcase() {
  return (
    <div>
      <h2 className="text-[40px] lg:text-[48px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-3 text-center">AI Agents</h2>
      <p className="text-[19px] lg:text-[21px] text-[#86868b] leading-[1.47] text-center mb-12 lg:mb-16">24/7 autonomous portfolio management</p>
      
      {/* Mobile - vertical stack */}
      <div className="lg:hidden space-y-3">
        {agents.map((agent) => {
          return (
            <div
              key={agent.id}
              className={`${agent.bgColor} rounded-[20px] p-10`}
            >
              <h3 className="text-[32px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-2">
                {agent.name}
              </h3>
              <p className="text-[17px] text-[#86868b] leading-[1.47]">
                {agent.role}
              </p>
            </div>
          );
        })}
      </div>

      {/* Desktop - unique asymmetric layout */}
      <div className="hidden lg:block">
        {/* Hero Agent - Lead Agent takes full width */}
        <div className={`${agents[0].bgColor} rounded-[30px] px-16 pt-20 pb-16 mb-3 min-h-[320px] flex flex-col justify-end`}>
          <div>
            <h3 className="text-[64px] font-semibold text-[#1d1d1f] tracking-[-0.03em] leading-[1.05] mb-4">
              {agents[0].name}
            </h3>
            <p className="text-[28px] text-[#86868b] leading-[1.42] tracking-[-0.005em]">
              {agents[0].role}
            </p>
          </div>
        </div>

        {/* Grid layout for remaining 4 agents - 2 columns, varied heights */}
        <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
          {/* Left column - 2 agents stacked */}
          <div className="space-y-3">
            {/* Risk Agent */}
            <div className={`${agents[1].bgColor} rounded-[30px] p-12 min-h-[240px] flex flex-col justify-end`}>
              <div>
                <h3 className="text-[44px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-2">
                  {agents[1].name}
                </h3>
                <p className="text-[21px] text-[#86868b] leading-[1.47]">
                  {agents[1].role}
                </p>
              </div>
            </div>

            {/* Hedging Agent */}
            <div className={`${agents[2].bgColor} rounded-[30px] p-12 min-h-[240px] flex flex-col justify-end`}>
              <div>
                <h3 className="text-[44px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-2">
                  {agents[2].name}
                </h3>
                <p className="text-[21px] text-[#86868b] leading-[1.47]">
                  {agents[2].role}
                </p>
              </div>
            </div>
          </div>

          {/* Right column - 2 agents stacked, varied heights */}
          <div className="space-y-3">
            {/* Settlement Agent - taller */}
            <div className={`${agents[3].bgColor} rounded-[30px] p-10 min-h-[320px] flex flex-col justify-end`}>
              <div>
                <h3 className="text-[40px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.1] mb-2">
                  {agents[3].name}
                </h3>
                <p className="text-[19px] text-[#86868b] leading-[1.47]">
                  {agents[3].role}
                </p>
              </div>
            </div>

            {/* Reporting Agent - shorter */}
            <div className={`${agents[4].bgColor} rounded-[30px] p-10 min-h-[160px] flex flex-col justify-end`}>
              <div>
                <h3 className="text-[36px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.1] mb-2">
                  {agents[4].name}
                </h3>
                <p className="text-[17px] text-[#86868b] leading-[1.47]">
                  {agents[4].role}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
