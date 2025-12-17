import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';

/**
 * Agent Orchestrator Status API
 * Check real-time agent status and capabilities
 */
export async function GET() {
  try {
    const orchestrator = getAgentOrchestrator();
    const status = orchestrator.getStatus();

    return NextResponse.json({
      orchestrator: {
        initialized: status.initialized,
        signerAvailable: status.signerAvailable,
      },
      agents: {
        risk: {
          available: status.agents.risk,
          capabilities: ['portfolio_analysis', 'risk_assessment', 'var_calculation'],
        },
        hedging: {
          available: status.agents.hedging,
          capabilities: ['hedge_analysis', 'position_opening', 'moonlander_integration'],
        },
        settlement: {
          available: status.agents.settlement,
          capabilities: ['gasless_settlement', 'batch_processing', 'x402_integration'],
        },
        reporting: {
          available: status.agents.reporting,
          capabilities: ['daily_reports', 'weekly_reports', 'custom_analytics'],
        },
        lead: {
          available: status.agents.lead,
          capabilities: ['task_coordination', 'agent_orchestration'],
        },
      },
      integrations: {
        x402: {
          enabled: !!process.env.X402_API_KEY,
          facilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://api.x402.io',
        },
        moonlander: {
          enabled: !!process.env.NEXT_PUBLIC_MOONLANDER_API_KEY,
          apiUrl: process.env.NEXT_PUBLIC_MOONLANDER_API || 'https://api.moonlander.io',
        },
        cryptocomAI: {
          enabled: !!(process.env.CRYPTOCOM_DEVELOPER_API_KEY || process.env.CRYPTOCOM_AI_API_KEY),
          fallbackMode: !(process.env.CRYPTOCOM_DEVELOPER_API_KEY || process.env.CRYPTOCOM_AI_API_KEY),
        },
        mcp: {
          enabled: !!process.env.MCP_API_KEY,
          serverUrl: process.env.MCP_SERVER_URL || 'https://mcp.cronos.org',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Status check failed:', error);
    return NextResponse.json(
      { 
        error: 'Status check failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Initialize orchestrator manually
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { force = false } = body;

    const orchestrator = getAgentOrchestrator();
    
    if (force) {
      // Force re-initialization
      await orchestrator.initialize();
    }

    const status = orchestrator.getStatus();

    return NextResponse.json({
      success: true,
      message: 'Orchestrator initialized',
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Orchestrator initialization failed:', error);
    return NextResponse.json(
      { 
        error: 'Initialization failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
